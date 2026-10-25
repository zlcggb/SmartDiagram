"""AI 视觉分析教练探索实验室（Coach Lab）API 路由。

挂载前缀：/api/coach-lab/*（前端通过 /video-api/api/coach-lab/* 访问）
"""
from __future__ import annotations

import datetime
import uuid
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ai_routes import _run_summary_from_segments
from coach_lab.presets import AVAILABLE_COACH_MODELS, COACH_SCENE_PRESETS
from coach_lab.service import (
    resolve_coach_model,
    run_ab_benchmark,
    stream_coach_window,
)
from llm_client import is_configured
from media_token import encode_short_share_code
from repo import create_analysis, create_video
from session_auth import optional_user
from summary_tasks import create_summary_task, update_summary_task

router = APIRouter(prefix="/api/coach-lab", tags=["coach-lab"])

# 算力风控配额常量（单位：秒）
GUEST_SINGLE_LIMIT_SEC = 60       # 访客单次最多连续分析 1 分钟 (60s)
GUEST_DAILY_LIMIT_SEC = 300       # 访客整天累计最多分析 5 分钟 (300s)
USER_IDLE_LIMIT_SEC = 120         # 登录用户单次无操作最多连续分析 2 分钟 (120s)，防止忘关浪费
USER_DAILY_LIMIT_SEC = 900        # 普通登录用户整天累计上限 15 分钟 (900s)

# 服务端按自然日 (YYYY-MM-DD, actor_key) 记录累计已消耗的分析秒数（防清空前端缓存绕过）
_DAILY_USAGE_SECONDS: dict[tuple[str, str], float] = {}


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class AnalyzeWindowRequest(BaseModel):
    mode: str = Field(default="grid_grounded", description="grid_grounded | baseline_multi")
    model: Optional[str] = Field(default="gemini-3.5-flash-lite")
    scene_id: str = Field(default="live_observer")
    custom_rubric: Optional[str] = None
    time_range_label: str = Field(default="00:00.0-00:04.0")
    window_index: int = Field(default=1, ge=1)
    grid_image: Optional[str] = None
    raw_frames: Optional[list[str]] = None
    pose_metrics: Optional[dict[str, Any]] = None
    rolling_memory: Optional[list[str]] = None


class BenchmarkWindowRequest(BaseModel):
    model: Optional[str] = Field(default="gemini-3.5-flash-lite")
    scene_id: str = Field(default="live_observer")
    custom_rubric: Optional[str] = None
    time_range_label: str = Field(default="00:00.0-00:04.0")
    grid_image: str
    raw_frames: list[str]
    pose_metrics: dict[str, Any] = Field(default_factory=dict)


class CoachWindowRecord(BaseModel):
    window_index: int
    start_sec: float = 0.0
    end_sec: float = 4.0
    text: str
    score: int = 85
    status: str = "normal"
    tag: str = "动作观察"
    angle_note: str = ""
    advice: str = ""


class FinalizeCoachSessionRequest(BaseModel):
    scene_id: str = Field(default="live_observer")
    title: Optional[str] = None
    windows: list[CoachWindowRecord]
    target_lang: str = "zh"
    report_style: str = "tutorial_sop"


@router.get("/config")
def get_coach_lab_config():
    return {
        "llm_configured": is_configured(),
        "default_model": resolve_coach_model(None),
        "models": AVAILABLE_COACH_MODELS,
        "scenes": list(COACH_SCENE_PRESETS.values()),
        "quota_rules": {
            "guest_single_limit_sec": GUEST_SINGLE_LIMIT_SEC,
            "guest_daily_limit_sec": GUEST_DAILY_LIMIT_SEC,
            "user_idle_limit_sec": USER_IDLE_LIMIT_SEC,
            "user_daily_limit_sec": USER_DAILY_LIMIT_SEC,
        },
    }


@router.post("/analyze-stream")
def api_coach_analyze_stream(
    req: AnalyzeWindowRequest,
    request: Request,
    user: Optional[dict] = Depends(optional_user),
):
    if not is_configured():
        raise HTTPException(status_code=503, detail="服务端未配置大模型 API Key")
    if not req.grid_image and not req.raw_frames:
        raise HTTPException(status_code=400, detail="请至少提供 grid_image 或 raw_frames")

    # 算力配额风控校验：区分访客 (IP) 与已登录用户
    today_str = datetime.date.today().isoformat()
    is_admin = bool(user and user.get("role") in ("admin", "super_admin"))
    actor_key = f"user:{user['id']}" if user else f"guest:{_get_client_ip(request)}"
    daily_limit_sec = USER_DAILY_LIMIT_SEC if user else GUEST_DAILY_LIMIT_SEC

    used_sec = _DAILY_USAGE_SECONDS.get((today_str, actor_key), 0.0)
    if not is_admin and used_sec >= daily_limit_sec:
        msg = (
            "访客今日免费 AI 视觉分析额度（5 分钟/天）已用完，请登录账号解锁更高额度"
            if not user
            else "今日 AI 视觉分析额度已用完，请明日再来"
        )
        raise HTTPException(status_code=429, detail=msg)

    # 每次窗口抽帧约折算 3.5 秒分析消耗
    _DAILY_USAGE_SECONDS[(today_str, actor_key)] = used_sec + 3.5

    gen = stream_coach_window(
        mode=req.mode,
        model=req.model,
        scene_id=req.scene_id,
        custom_rubric=req.custom_rubric,
        time_range_label=req.time_range_label,
        window_index=req.window_index,
        grid_image=req.grid_image,
        raw_frames=req.raw_frames,
        pose_metrics=req.pose_metrics,
        rolling_memory=req.rolling_memory,
    )
    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/benchmark")
def api_coach_ab_benchmark(req: BenchmarkWindowRequest):
    if not is_configured():
        raise HTTPException(status_code=503, detail="服务端未配置大模型 API Key")
    return run_ab_benchmark(
        model=req.model,
        scene_id=req.scene_id,
        custom_rubric=req.custom_rubric,
        time_range_label=req.time_range_label,
        grid_image=req.grid_image,
        raw_frames=req.raw_frames,
        pose_metrics=req.pose_metrics,
    )


@router.post("/finalize")
def api_finalize_coach_session(
    req: FinalizeCoachSessionRequest,
    background: BackgroundTasks,
    user: Optional[dict] = Depends(optional_user),
):
    """将连续视觉教练观察记录一键转化为 /video 标准学习闭环（研报 + 导图 + 测验 + 免登录短链分享）。"""
    if not req.windows:
        raise HTTPException(status_code=400, detail="请先至少完成 1 段视觉教练分析再生成复盘闭环")

    preset = COACH_SCENE_PRESETS.get(req.scene_id) or COACH_SCENE_PRESETS["live_observer"]
    user_id = user["id"] if user else None
    task_id = uuid.uuid4().hex
    session_title = (req.title or "").strip() or f"【AI视觉教练复盘】{preset['name']}（共 {len(req.windows)} 段动作评估）"

    segments: list[dict[str, Any]] = []
    for w in req.windows:
        badge = "⚠️风险/待纠偏" if w.status == "warning" else ("✨标准示范" if w.status == "good" else "👁️持续观察")
        parts = [f"【{badge} · {w.tag} · 评分 {w.score}/100】{w.text.strip()}"]
        if w.angle_note:
            parts.append(f"（骨骼量化：{w.angle_note}）")
        if w.advice:
            parts.append(f"【教练处方】{w.advice}")
        segments.append(
            {
                "start": float(w.start_sec),
                "end": float(max(w.end_sec, w.start_sec + 1.0)),
                "text": " ".join(parts),
            }
        )

    v_row = create_video(
        user_id=user_id,
        source_type="upload",
        title=session_title,
        duration_sec=max((w.end_sec for w in req.windows), default=12.0),
        storage_status="ready",
    )
    video_id = str(v_row["id"])

    coach_prompt = (
        f"这是一份由「{preset['name']}」采集的具身视觉动作与姿态评估记录（包含骨骼关键点角度测量、各时间窗口动作观察与教练纠偏处方）。"
        "请生成一份专业的《AI 视觉教练深度诊断与训练复盘报告》，重点提炼：整体表现评分、关键问题动作定格复盘、生物力学/体态原因剖析，以及分阶段可执行训练处方。"
    )

    create_analysis(
        task_id=task_id,
        video_id=video_id,
        user_id=user_id,
        target_lang=req.target_lang,
        prompt=coach_prompt,
    )
    create_summary_task(
        task_id,
        req.target_lang,
        url=None,
        source_type="upload",
        video_id=video_id,
    )
    update_summary_task(
        task_id,
        status="summarizing",
        stage="summarizing",
        percent=58,
        stage_message="正在汇总视觉教练分段评估，生成深度复盘研报与动作拆解导图...",
        partial_transcript=segments,
    )

    background.add_task(
        _run_summary_from_segments,
        task_id,
        segments,
        "vision",
        req.target_lang,
        report_style=req.report_style or "tutorial_sop",
        prompt=coach_prompt,
        preserved_quiz=None,
        user_id=user_id,
    )

    share_code = encode_short_share_code(task_id)
    return {
        "task_id": task_id,
        "video_id": video_id,
        "title": session_title,
        "share_code": share_code,
        "share_path": f"/video?s={share_code}" if share_code else f"/video?analysis={task_id}",
    }
