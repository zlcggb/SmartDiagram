"""AI 视频总结路由（独立 APIRouter，由 main.py include_router 接入）。

新增文件，不改动既有下载/解析接口（开闭原则）。

接口：
  POST /api/upload           上传本地音视频，返回 {file_id}
  POST /api/summarize        创建总结任务（url 或 file_id 二选一）
  GET  /api/summary/{id}     查询总结进度与结果
  POST /api/quiz/generate    根据已完成总结生成学习测验
  POST /api/quiz/submit      提交答案并返回评分、解析与视频依据
"""
import json
import logging
import os
import uuid
from typing import Any, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from cloud_asr import _probe_duration
from downloader import classify_error
from url_normalize import canonical_video_key, extract_url_from_text
from llm_client import LLMConfigError, is_configured
from qa import ask as qa_ask, ask_routed as qa_ask_routed, ask_routed_stream as qa_ask_routed_stream, _now_time_str
from quiz_generator import generate_quiz
from quiz_scorer import score_quiz
from quiz_store import create_quiz, get_quiz, public_quiz
from summarizer import summarize, summarize_from_segments, summarize_upload
from translator import translate_segments
from summary_tasks import (
    SummaryCancelledError,
    create_summary_task,
    create_translate_task,
    get_summary_task,
    is_summary_cancelled,
    request_summary_cancel,
    update_summary_task,
)
from upload_auth import require_upload_auth
from upload_store import (
    ALLOWED_EXTENSIONS,
    UPLOAD_MAX_BYTES,
    UPLOAD_MAX_DURATION,
    cleanup_expired,
    get_upload,
    new_file_id,
    register_upload,
    remove_upload,
    upload_path,
)
from repo import (
    append_analysis_chat,
    clone_analysis_for_reuse,
    create_analysis,
    create_video,
    find_reusable_analysis_by_url,
    finish_analysis,
    get_analysis_for_user,
    get_latest_quiz_bundle_for_analysis,
    get_quiz_by_id,
    get_video,
    save_analysis_quiz_data,
    save_quiz,
    save_quiz_attempt,
)
from session_auth import optional_user, require_user
from guest_quota import (
    client_ip,
    consume_guest_ask_quota,
    consume_guest_quota,
    guest_ask_quota_status,
    guest_quota_status,
)
from transcoder import submit_transcode

router = APIRouter()


_ALLOWED_BROWSERS = {
    "brave",
    "chrome",
    "chromium",
    "edge",
    "firefox",
    "opera",
    "safari",
    "vivaldi",
}
_ALLOWED_LANGS = {"zh", "zh-Hant", "en", "ja", "ko"}
_ALLOWED_REPORT_STYLES = {"deep_report", "executive_brief", "tutorial_sop", "critical_review"}
_IN_FLIGHT_URL_TASKS: dict[str, str] = {}


def _normalize_browser(browser: Optional[str]) -> Optional[str]:
    if not browser:
        return None
    b = browser.strip().lower()
    if b not in _ALLOWED_BROWSERS:
        raise HTTPException(status_code=400, detail=f"不支持的浏览器：{browser}")
    return b


class SummarizeRequest(BaseModel):
    url: Optional[str] = None
    file_id: Optional[str] = None
    browser: Optional[str] = None
    target_lang: Optional[str] = "zh"
    prompt: Optional[str] = None
    report_style: Optional[str] = "deep_report"
    regenerate_mode: Optional[str] = None  # None | "report_only" | "full_reparse"
    source_task_id: Optional[str] = None

    @model_validator(mode="after")
    def _url_or_file(self):
        has_url = bool((self.url or "").strip())
        has_file = bool((self.file_id or "").strip())
        has_source = bool((self.source_task_id or "").strip())
        if not has_url and not has_file and not has_source:
            raise ValueError("请提供 url 或 file_id 之一")
        if has_url and has_file:
            raise ValueError("请勿同时提供 url 与 file_id")
        return self


class TranslateRequest(BaseModel):
    summary_task_id: str
    target_lang: Optional[str] = "zh"


class HistoryMessage(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    summary_task_id: str
    question: str
    history: Optional[list[HistoryMessage]] = None


class QuizGenerateRequest(BaseModel):
    summary_task_id: str
    count: int = Field(default=6, ge=4, le=20)


class QuizAnswer(BaseModel):
    question_id: str
    answer: Any = None


class QuizSubmitRequest(BaseModel):
    quiz_id: str
    summary_task_id: Optional[str] = None
    answers: list[QuizAnswer]


class QuizStateSyncRequest(BaseModel):
    summary_task_id: str
    quiz_id: str
    answers: dict[str, Any] = Field(default_factory=dict)
    revealed: dict[str, bool] = Field(default_factory=dict)
    current_index: int = 0
    view_mode: str = "deck"
    score_result: Optional[dict[str, Any]] = None


def _summary_error_from_exception(exc: Exception) -> dict:
    """总结任务错误：区分 LLM JSON 异常与视频解析类错误。"""
    if isinstance(exc, json.JSONDecodeError):
        return {
            "code": "llm_json",
            "message": "AI 总结生成失败：模型返回格式异常，请点击「开始总结」重试",
        }
    msg = str(exc)
    if "无法从模型输出解析 JSON" in msg or "模型返回为空" in msg:
        return {"code": "llm_json", "message": f"AI 总结生成失败：{msg}，请重试"}
    return classify_error(exc)


def _run_summary_from_segments(
    task_id: str,
    segments: list,
    source_kind: str,
    target_lang: str,
    report_style: str = "deep_report",
    prompt: Optional[str] = None,
    preserved_quiz: Optional[dict] = None,
    user_id: Optional[str] = None,
) -> None:
    """复用已有字幕 segments，跳过音频下载与 ASR，仅按指定风格重新生成研报与导图。"""
    import time
    t0 = time.time()

    def progress(stage: str, percent: float | None = None, stage_message: str | None = None, **extra):
        if is_summary_cancelled(task_id):
            raise SummaryCancelledError()
        status = "done" if stage == "done" else stage
        payload = {"status": status, "stage": stage}
        if percent is not None:
            payload["percent"] = percent
        if stage_message is not None:
            payload["stage_message"] = stage_message
        if "partial_transcript" in extra:
            payload["partial_transcript"] = extra["partial_transcript"]
        if "partial_result" in extra and extra["partial_result"]:
            payload["result"] = extra["partial_result"]

        now = time.time()
        payload["timing"] = {
            "asr_ms": 0,
            "llm_ms": int((now - t0) * 1000),
            "total_ms": int((now - t0) * 1000),
            "reused_transcript": True,
        }
        update_summary_task(task_id, **payload)

    try:
        result = summarize_from_segments(
            segments=segments,
            source_kind=source_kind,
            task_id=task_id,
            target_lang=target_lang,
            progress=progress,
            report_style=report_style,
            custom_prompt=prompt,
        )
        if preserved_quiz and isinstance(preserved_quiz, dict) and preserved_quiz.get("questions"):
            new_quiz_id = uuid.uuid4().hex
            q_list = preserved_quiz["questions"]
            q_title = preserved_quiz.get("title") or "AI 视频学习测验"
            q_est = int(preserved_quiz.get("estimated_minutes") or 5)
            result["quiz"] = {
                "quiz_id": new_quiz_id,
                "summary_task_id": task_id,
                "title": q_title,
                "estimated_minutes": q_est,
                "question_count": len(q_list),
                "questions": q_list,
            }
            try:
                save_quiz(
                    analysis_id=task_id,
                    user_id=user_id,
                    title=q_title,
                    estimated_minutes=q_est,
                    questions=q_list,
                    quiz_id=new_quiz_id,
                )
            except Exception as qe:
                logger.warning("重生成研报时克隆测验异常: %s", qe)

        total_ms = int((time.time() - t0) * 1000)
        timing = {
            "asr_ms": 0,
            "llm_ms": total_ms,
            "total_ms": total_ms,
            "reused_transcript": True,
        }
        update_summary_task(
            task_id,
            status="done",
            stage="done",
            percent=100,
            result=result,
            timing=timing,
        )
        finish_analysis(
            task_id,
            status="done",
            result=result,
            timing=timing,
        )
    except SummaryCancelledError:
        update_summary_task(
            task_id,
            status="cancelled",
            stage="cancelled",
            error="已取消 AI 总结",
        )
        finish_analysis(task_id, status="cancelled", error="已取消 AI 总结")
    except LLMConfigError as e:
        update_summary_task(
            task_id,
            status="error",
            error=str(e),
            error_code="llm_not_configured",
        )
        finish_analysis(task_id, status="error", error=str(e), error_code="llm_not_configured")
    except Exception as e:  # noqa: BLE001
        info = _summary_error_from_exception(e)
        err_msg = info.get("message") or str(e)
        err_code = info.get("code") or "generic"
        update_summary_task(
            task_id,
            status="error",
            error=err_msg,
            error_code=err_code,
        )
        finish_analysis(task_id, status="error", error=err_msg, error_code=err_code)


def _run_summary(
    task_id: str,
    url: str,
    browser: Optional[str],
    target_lang: str,
    prompt: Optional[str] = None,
    report_style: str = "deep_report",
) -> None:
    import time
    t0 = time.time()
    asr_done_time = [None]

    def progress(stage: str, percent: float | None = None, stage_message: str | None = None, **extra):
        if is_summary_cancelled(task_id):
            raise SummaryCancelledError()
        status = "done" if stage == "done" else stage
        payload = {"status": status, "stage": stage}
        if percent is not None:
            payload["percent"] = percent
        if stage_message is not None:
            payload["stage_message"] = stage_message
        if "partial_transcript" in extra:
            payload["partial_transcript"] = extra["partial_transcript"]
        if "partial_result" in extra and extra["partial_result"]:
            payload["result"] = extra["partial_result"]
        
        now = time.time()
        timing = {
            "total_ms": int((now - t0) * 1000),
        }
        if stage == "summarizing" and asr_done_time[0] is None:
            asr_done_time[0] = now
            timing["asr_ms"] = int((now - t0) * 1000)
        payload["timing"] = timing
        update_summary_task(task_id, **payload)

    try:
        result = summarize(
            url, browser, task_id, target_lang, progress, prompt=prompt, report_style=report_style
        )
        total_ms = int((time.time() - t0) * 1000)
        asr_ms = int((asr_done_time[0] - t0) * 1000) if asr_done_time[0] else int(total_ms * 0.4)
        llm_ms = max(0, total_ms - asr_ms)
        timing = {
            "asr_ms": asr_ms,
            "llm_ms": llm_ms,
            "total_ms": total_ms,
        }
        update_summary_task(
            task_id,
            status="done",
            stage="done",
            percent=100,
            result=result,
            timing=timing,
        )
        finish_analysis(
            task_id,
            status="done",
            result=result,
            timing=timing,
        )
    except SummaryCancelledError:
        update_summary_task(
            task_id,
            status="cancelled",
            stage="cancelled",
            error="已取消 AI 总结",
        )
        finish_analysis(task_id, status="cancelled", error="已取消 AI 总结")
    except LLMConfigError as e:
        update_summary_task(
            task_id,
            status="error",
            error=str(e),
            error_code="llm_not_configured",
        )
        finish_analysis(task_id, status="error", error=str(e), error_code="llm_not_configured")
    except Exception as e:  # noqa: BLE001
        info = _summary_error_from_exception(e)
        err_msg = info.get("message") or str(e)
        err_code = info.get("code") or "generic"
        update_summary_task(
            task_id,
            status="error",
            error=err_msg,
            error_code=err_code,
        )
        finish_analysis(task_id, status="error", error=err_msg, error_code=err_code)



def _run_summary_upload(
    task_id: str,
    file_id: str,
    target_lang: str,
    prompt: Optional[str] = None,
    report_style: str = "deep_report",
) -> None:
    import time
    t0 = time.time()
    asr_done_time = [None]

    def progress(stage: str, percent: float | None = None, stage_message: str | None = None, **extra):
        if is_summary_cancelled(task_id):
            raise SummaryCancelledError()
        status = "done" if stage == "done" else stage
        payload = {"status": status, "stage": stage}
        if percent is not None:
            payload["percent"] = percent
        if stage_message is not None:
            payload["stage_message"] = stage_message
        if "partial_transcript" in extra:
            payload["partial_transcript"] = extra["partial_transcript"]
        if "partial_result" in extra and extra["partial_result"]:
            payload["result"] = extra["partial_result"]
        
        now = time.time()
        timing = {
            "total_ms": int((now - t0) * 1000),
        }
        if stage == "summarizing" and asr_done_time[0] is None:
            asr_done_time[0] = now
            timing["asr_ms"] = int((now - t0) * 1000)
        payload["timing"] = timing
        update_summary_task(task_id, **payload)

    meta = None
    try:
        meta = get_upload(file_id)
        if not meta:
            raise ValueError("上传文件不存在或已过期，请重新上传")
        result = summarize_upload(
            meta["path"],
            task_id,
            target_lang,
            progress,
            filename=meta.get("filename") or "",
            prompt=prompt,
            report_style=report_style,
        )
        total_ms = int((time.time() - t0) * 1000)
        asr_ms = int((asr_done_time[0] - t0) * 1000) if asr_done_time[0] else int(total_ms * 0.4)
        llm_ms = max(0, total_ms - asr_ms)
        timing = {
            "asr_ms": asr_ms,
            "llm_ms": llm_ms,
            "total_ms": total_ms,
        }
        update_summary_task(
            task_id,
            status="done",
            stage="done",
            percent=100,
            result=result,
            timing=timing,
        )
        finish_analysis(
            task_id,
            status="done",
            result=result,
            timing=timing,
        )
    except SummaryCancelledError:
        update_summary_task(
            task_id,
            status="cancelled",
            stage="cancelled",
            error="已取消 AI 总结",
        )
        finish_analysis(task_id, status="cancelled", error="已取消 AI 总结")
    except LLMConfigError as e:
        update_summary_task(
            task_id,
            status="error",
            error=str(e),
            error_code="llm_not_configured",
        )
        finish_analysis(task_id, status="error", error=str(e), error_code="llm_not_configured")
    except Exception as e:  # noqa: BLE001
        info = _summary_error_from_exception(e)
        err_msg = info.get("message") or str(e)
        err_code = info.get("code") or "generic"
        update_summary_task(
            task_id,
            status="error",
            error=err_msg,
            error_code=err_code,
        )
        finish_analysis(task_id, status="error", error=err_msg, error_code=err_code)

    # 上传文件保留至 TTL 过期，供工作台内对照播放；由 cleanup_expired 清理


def _check_llm_configured():
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "llm_not_configured",
                "message": (
                    "AI 总结未启用：服务端未配置大模型 API Key。"
                    "请在 local.env 中设置 LLM_API_KEY（或 DEEPSEEK_API_KEY / DASHSCOPE_API_KEY）后重启后端。"
                ),
            },
        )


@router.post("/api/upload")
async def api_upload(
    request: Request,
    file: UploadFile = File(...),
    user: Optional[dict] = Depends(optional_user),
):
    cleanup_expired()
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="请选择要上传的文件")

    user_id = user["id"] if user else None

    orig_name = os.path.basename(file.filename)
    ext = os.path.splitext(orig_name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式：{ext or '未知'}，允许：{', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # 1. 在数据库中创建视频记录
    video = create_video(
        user_id=user_id,
        source_type="upload",
        original_filename=orig_name,
        storage_status="pending",
    )
    file_id = str(video["id"])
    dest = upload_path(file_id, ext)
    size = 0
    try:
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > UPLOAD_MAX_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail={
                            "code": "file_too_large",
                            "message": f"文件超过上限（{UPLOAD_MAX_BYTES // (1024 * 1024)} MB）",
                        },
                    )
                out.write(chunk)
    except HTTPException:
        if os.path.isfile(dest):
            os.remove(dest)
        raise
    except Exception as e:  # noqa: BLE001
        if os.path.isfile(dest):
            os.remove(dest)
        raise HTTPException(status_code=500, detail=f"保存上传文件失败：{e}") from e

    duration = None
    try:
        duration = _probe_duration(dest)
        if duration and duration > UPLOAD_MAX_DURATION:
            os.remove(dest)
            hours = int(UPLOAD_MAX_DURATION // 3600)
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "duration_exceeded",
                    "message": f"视频时长超过 {hours} 小时上限",
                },
            )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        duration = None

    # 更新数据库视频元数据
    from repo import update_video
    update_video(file_id, original_bytes=size, duration_sec=duration, title=orig_name)

    # 注册进临时上传缓存供 AI 总结读取
    meta = register_upload(file_id, dest, orig_name, size, duration)

    # 游客上传仅保留在 TTL 临时缓存中，不做永久 Web 压缩归档
    if user_id:
        submit_transcode(file_id, dest, user_id)

    return {
        "file_id": meta["file_id"],
        "video_id": meta["file_id"],
        "filename": meta["filename"],
        "size": meta["size"],
        "duration": meta["duration"],
    }


@router.post("/api/summarize")
def api_summarize(
    req: SummarizeRequest,
    background: BackgroundTasks,
    request: Request,
    user: Optional[dict] = Depends(optional_user),
):
    _check_llm_configured()
    user_id = user["id"] if user else None
    target_lang = req.target_lang if req.target_lang in _ALLOWED_LANGS else "zh"
    report_style = (req.report_style or "deep_report").strip()
    if report_style not in _ALLOWED_REPORT_STYLES:
        report_style = "deep_report"
    regen_mode = (req.regenerate_mode or "").strip() or None
    source_task_id = (req.source_task_id or "").strip() or None
    task_id = uuid.uuid4().hex

    raw_url = (req.url or "").strip()
    extracted = extract_url_from_text(raw_url) if raw_url else None
    url = extracted or (raw_url if raw_url.lower().startswith(("http://", "https://")) else "")

    # 分支 1：仅重生成研报（复用已提取的字幕，跳过 40 秒音轨下载与 ASR）
    if regen_mode == "report_only":
        src_record = None
        src_res = None
        if source_task_id:
            mem_t = get_summary_task(source_task_id)
            src_record = get_analysis_for_user(
                source_task_id,
                user_id=user_id,
                is_admin=user.get("role") == "admin" if user else False,
                allow_public_read=True,
            )
            if mem_t and isinstance(mem_t.get("result"), dict):
                src_res = mem_t["result"]
            elif src_record and isinstance(src_record.get("result"), dict):
                src_res = src_record["result"]
        if not src_res and url:
            src_record = find_reusable_analysis_by_url(url, target_lang)
            if src_record and isinstance(src_record.get("result"), dict):
                src_res = src_record["result"]

        segments = (src_res or {}).get("transcript") if isinstance(src_res, dict) else None
        if isinstance(segments, list) and len(segments) > 0:
            src_kind = (src_res or {}).get("transcript_source") or "cloud_asr"
            preserved_quiz = (src_res or {}).get("quiz") if isinstance(src_res, dict) else None
            src_video_id = str((src_record or {}).get("video_id") or "")
            src_url = (src_record or {}).get("source_url") or url
            src_type = (src_record or {}).get("source_type") or ("url" if src_url else "upload")
            if not src_video_id:
                v_row = create_video(
                    user_id=user_id,
                    source_type=src_type,
                    source_url=src_url or None,
                    storage_status="link_only",
                )
                src_video_id = str(v_row["id"])

            create_analysis(
                task_id=task_id,
                video_id=src_video_id,
                user_id=user_id,
                target_lang=target_lang,
                prompt=req.prompt,
            )
            create_summary_task(
                task_id,
                target_lang,
                url=src_url or None,
                source_type=src_type,
                video_id=src_video_id,
            )
            update_summary_task(
                task_id,
                status="summarizing",
                stage="summarizing",
                percent=55,
                stage_message="已复用字幕，正在按所选风格重新生成研报...",
                partial_transcript=segments,
            )
            background.add_task(
                _run_summary_from_segments,
                task_id,
                segments,
                src_kind,
                target_lang,
                report_style=report_style,
                prompt=req.prompt,
                preserved_quiz=preserved_quiz,
                user_id=user_id,
            )
            return {"task_id": task_id, "reused_transcript": True}

    file_id = (req.file_id or "").strip()
    if file_id:
        cleanup_expired()
        meta = get_upload(file_id)
        if not meta:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "upload_not_found",
                    "message": "上传文件不存在或已过期，请重新上传",
                },
            )
        video = get_video(file_id)
        if not video:
            video = create_video(
                user_id=user_id,
                source_type="upload",
                title=meta.get("filename"),
                video_id=file_id,
            )
        # 未登录游客：按 IP 消耗每日免费分析配额（默认 3 次，GUEST_DAILY_LIMIT 可调）
        if not user:
            consume_guest_quota(client_ip(request))
        create_analysis(
            task_id=task_id,
            video_id=video["id"],
            user_id=user_id,
            target_lang=target_lang,
            prompt=req.prompt,
        )
        create_summary_task(
            task_id,
            target_lang,
            file_id=file_id,
            filename=meta.get("filename"),
            source_type="upload",
            video_id=str(video["id"]),
        )
        background.add_task(
            _run_summary_upload,
            task_id,
            file_id,
            target_lang,
            prompt=req.prompt,
            report_style=report_style,
        )
        return {"task_id": task_id}

    if not url:
        raise HTTPException(status_code=400, detail="请输入合法的视频链接")

    canon_key = f"{canonical_video_key(url)}::{target_lang}"

    # 分支 2：默认首次解析（未指定强制重解析 regen_mode != "full_reparse"）-> 命中哈希指纹秒级复用
    if regen_mode != "full_reparse":
        # 2a. 若当前正好有相同 URL 在并发解析中，直接复用进行中的任务（Singleflight）
        in_flight_id = _IN_FLIGHT_URL_TASKS.get(canon_key)
        if in_flight_id:
            in_flight_task = get_summary_task(in_flight_id)
            if in_flight_task and in_flight_task.get("status") in (
                "queued",
                "transcribing",
                "local_asr",
                "analyzing_frames",
                "summarizing",
            ):
                return {"task_id": in_flight_id, "in_flight_reused": True}

        # 2b. 查找数据库是否已有该 URL 指纹的已完成分析记录，0.1 秒克隆返回（并附带空白测验卷）
        cached_record = find_reusable_analysis_by_url(url, target_lang)
        if cached_record:
            cloned = clone_analysis_for_reuse(
                source_record=cached_record,
                new_task_id=task_id,
                user_id=user_id,
                source_url=url,
                target_lang=target_lang,
                prompt=req.prompt,
            )
            create_summary_task(
                task_id,
                target_lang,
                url=url,
                source_type="url",
                video_id=cloned["video_id"],
            )
            update_summary_task(
                task_id,
                status="done",
                stage="done",
                percent=100,
                result=cloned["result"],
                timing=cloned["timing"],
                partial_transcript=(cloned["result"] or {}).get("transcript") or [],
            )
            return {"task_id": task_id, "cached": True}

    browser = _normalize_browser(req.browser)
    # 未登录游客：按 IP 消耗每日免费分析配额（默认 3 次，GUEST_DAILY_LIMIT 可调）
    if not user:
        consume_guest_quota(client_ip(request))
    video = create_video(
        user_id=user_id,
        source_type="url",
        source_url=url,
        storage_status="link_only",
    )
    create_analysis(
        task_id=task_id,
        video_id=video["id"],
        user_id=user_id,
        target_lang=target_lang,
        prompt=req.prompt,
    )
    create_summary_task(
        task_id,
        target_lang,
        url=url,
        source_type="url",
        video_id=str(video["id"]),
    )
    _IN_FLIGHT_URL_TASKS[canon_key] = task_id
    background.add_task(
        _run_summary,
        task_id,
        url,
        browser,
        target_lang,
        prompt=req.prompt,
        report_style=report_style,
    )
    return {"task_id": task_id}


@router.get("/api/quota")
def api_quota(request: Request, user: Optional[dict] = Depends(optional_user)):
    """查询当前访客/用户的分析额度。登录用户不限量，游客按 IP 每日限量。"""
    if user:
        return {"guest": False, "unlimited": True}
    ip = client_ip(request)
    return {"guest": True, **guest_quota_status(ip), "ask": guest_ask_quota_status(ip)}


def _hydrate_quiz_if_missing(task_id: str, res_obj: Any) -> Any:
    """若 analyses.result 中尚未内嵌 quiz，自动从 quizzes / quiz_attempts 表回填并持久化。"""
    if not isinstance(res_obj, dict) or res_obj.get("quiz"):
        return res_obj
    bundle = get_latest_quiz_bundle_for_analysis(task_id)
    if not bundle or not bundle.get("quiz"):
        return res_obj
    updated = dict(res_obj)
    updated["quiz"] = bundle["quiz"]
    if bundle.get("quiz_state"):
        updated["quiz_state"] = bundle["quiz_state"]
    save_analysis_quiz_data(
        task_id,
        quiz_data=bundle["quiz"],
        quiz_state=bundle.get("quiz_state"),
    )
    t = get_summary_task(task_id)
    if t and isinstance(t.get("result"), dict):
        update_summary_task(task_id, result=updated)
    return updated


@router.get("/api/summary/{task_id}")
def api_summary(
    task_id: str,
    share: Optional[str] = None,
    user: Optional[dict] = Depends(optional_user),
):
    from media_token import decode_short_share_code, sign_share_token, verify_share_token
    from repo import resolve_analysis_id_by_prefix

    raw_id = (task_id or "").strip()
    is_shared = False

    # 支持直接传入 10 位极简分享短码（如 /video?s=1aB2cD3eF4 -> GET /api/summary/1aB2cD3eF4）
    if len(raw_id) == 10 and "." not in raw_id:
        prefix = decode_short_share_code(raw_id)
        if prefix:
            resolved_id = resolve_analysis_id_by_prefix(prefix)
            if resolved_id:
                task_id = resolved_id
                is_shared = True

    if not is_shared:
        is_shared = verify_share_token(task_id, share or "")

    t = get_summary_task(task_id)
    if t:
        record = get_analysis_for_user(
            task_id,
            user_id=user["id"] if user else None,
            is_admin=user.get("role") == "admin" if user else False,
            allow_public_read=is_shared,
        )
        res_obj = t.get("result") or (record.get("result") if record else None)
        if t.get("status") == "done" and isinstance(res_obj, dict):
            res_obj = _hydrate_quiz_if_missing(task_id, res_obj)
        return {
            "task_id": task_id,
            "status": t["status"],
            "stage": t["stage"],
            "percent": t["percent"],
            "stage_message": t.get("stage_message"),
            "result": res_obj,
            "error": t["error"],
            "error_code": t["error_code"],
            "partial_transcript": t.get("partial_transcript") or [],
            "timing": t.get("timing") or {},
            "video_id": str((record and record.get("video_id")) or t.get("video_id") or t.get("file_id") or ""),
            "video_title": (
                (record and record.get("video_title"))
                or (res_obj.get("title") if isinstance(res_obj, dict) else None)
                or t.get("filename")
                or ""
            ),
            "webpage_url": (record and record.get("source_url")) or t.get("url") or "",
            "source_type": (record and record.get("source_type")) or t.get("source_type") or "",
            "duration": record.get("duration_sec") if record else None,
            "cover_url": (record and record.get("cover_url")) or "",
            "share_token": sign_share_token(task_id),
            "readonly_share": bool(is_shared),
        }

    # 内存未命中（服务重启或历史回看）：从 PostgreSQL 回落读取
    record = get_analysis_for_user(
        task_id,
        user_id=user["id"] if user else None,
        is_admin=user.get("role") == "admin" if user else False,
        allow_public_read=is_shared,
    )
    if not record:
        raise HTTPException(status_code=404, detail="任务不存在或无权访问")

    res_obj = record.get("result")
    if record.get("status") == "done" and isinstance(res_obj, dict):
        res_obj = _hydrate_quiz_if_missing(task_id, res_obj)

    return {
        "task_id": task_id,
        "status": record["status"],
        "stage": "done" if record["status"] == "done" else record["status"],
        "percent": 100.0 if record["status"] == "done" else 0.0,
        "stage_message": None,
        "result": res_obj,
        "error": record["error"],
        "error_code": record["error_code"],
        "partial_transcript": (res_obj or {}).get("transcript") or [] if isinstance(res_obj, dict) else [],
        "timing": record.get("timing") or {},
        "video_id": str(record.get("video_id") or ""),
        "video_title": record.get("video_title") or "",
        "webpage_url": record.get("source_url") or "",
        "source_type": record.get("source_type"),
        "duration": record.get("duration_sec"),
        "cover_url": record.get("cover_url") or "",
        "share_token": sign_share_token(task_id),
        "readonly_share": bool(is_shared),
    }



@router.post("/api/summary/{task_id}/cancel")
def api_summary_cancel(task_id: str):
    t = get_summary_task(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    if t.get("kind") == "translate":
        raise HTTPException(status_code=400, detail="翻译任务不支持此接口")
    if not request_summary_cancel(task_id):
        if t["status"] == "cancelled":
            return {"ok": True, "status": "cancelled"}
        raise HTTPException(status_code=409, detail="任务已结束，无法取消")
    update_summary_task(task_id, status="cancelled", stage="cancelled", error="已取消 AI 总结")
    return {"ok": True, "status": "cancelled"}


def _run_translate(task_id: str, segments: list, target_lang: str) -> None:
    def progress(percent: float):
        update_summary_task(task_id, status="translating", percent=percent)

    try:
        result = translate_segments(segments, target_lang, progress)
        update_summary_task(
            task_id, status="done", percent=100, result=result
        )
    except LLMConfigError as e:
        update_summary_task(
            task_id, status="error", error=str(e), error_code="llm_not_configured"
        )
    except Exception as e:  # noqa: BLE001
        info = _summary_error_from_exception(e)
        update_summary_task(
            task_id,
            status="error",
            error=info.get("message") or str(e),
            error_code=info.get("code") or "generic",
        )


def _load_analysis_result(task_id: str, user: dict | None = None) -> dict | None:
    t = get_summary_task(task_id)
    if t and t.get("status") == "done" and t.get("result"):
        return t["result"]
    record = get_analysis_for_user(
        task_id,
        user_id=user["id"] if user else None,
        is_admin=user.get("role") == "admin" if user else False,
    )
    if not record and user:
        from community_repo import analysis_visible_in_community

        if analysis_visible_in_community(task_id):
            record = get_analysis_for_user(task_id, is_admin=True)
    if record and record.get("status") == "done" and record.get("result"):
        return record["result"]
    return None


@router.post("/api/translate")
def api_translate(
    req: TranslateRequest,
    background: BackgroundTasks,
    user: dict = Depends(require_user),
):
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "llm_not_configured",
                "message": "字幕翻译未启用：服务端未配置大模型 API Key。",
            },
        )
    result = _load_analysis_result(req.summary_task_id, user)
    if not result:
        raise HTTPException(status_code=404, detail="请先完成 AI 总结以获取字幕转写")
    segments = result.get("transcript") or []
    if not segments:
        raise HTTPException(status_code=409, detail="该视频没有可翻译的字幕转写")
    target_lang = req.target_lang if req.target_lang in _ALLOWED_LANGS else "zh"
    task_id = uuid.uuid4().hex
    create_translate_task(task_id, target_lang)
    background.add_task(_run_translate, task_id, segments, target_lang)
    return {"task_id": task_id}


@router.get("/api/translate/{task_id}")
def api_translate_status(task_id: str):
    t = get_summary_task(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {
        "status": t["status"],
        "percent": t["percent"],
        "result": t["result"],
        "error": t["error"],
        "error_code": t["error_code"],
    }


@router.post("/api/ask")
def api_ask(
    req: AskRequest,
    request: Request,
    user: Optional[dict] = Depends(optional_user),
):
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "llm_not_configured",
                "message": "AI 问答未启用：服务端未配置大模型 API Key。",
            },
        )
    question = (req.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    if len(question) > 2000:
        raise HTTPException(status_code=400, detail="问题过长（最多 2000 字）")

    result = _load_analysis_result(req.summary_task_id, user)
    if not result:
        raise HTTPException(status_code=404, detail="请先完成 AI 总结后再提问")

    # 未登录游客：按 IP 消耗每日免费提问配额（默认 15 次，GUEST_DAILY_ASK_LIMIT 可调）
    if not user:
        consume_guest_ask_quota(client_ip(request))

    history = None
    if req.history:
        history = [{"role": h.role, "content": h.content} for h in req.history]

    try:
        routed_res = qa_ask_routed(
            result=result,
            question=question,
            history=history,
            summary_task_id=req.summary_task_id,
        )
    except LLMConfigError as e:
        raise HTTPException(
            status_code=503,
            detail={"code": "llm_not_configured", "message": str(e)},
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        info = classify_error(e)
        raise HTTPException(
            status_code=500,
            detail=info.get("message") or str(e),
        ) from e

    # 持久化本轮问答记录至内存任务与 PostgreSQL analyses.result.chat_history
    asked_at = _now_time_str()
    user_msg = {"role": "user", "content": question, "created_at": asked_at}
    if isinstance(routed_res, dict):
        assistant_msg = {
            "role": "assistant",
            "content": routed_res.get("answer") or "",
            "action": routed_res.get("action"),
            "router": routed_res.get("router"),
            "created_at": routed_res.get("created_at") or _now_time_str(),
        }
    else:
        assistant_msg = {"role": "assistant", "content": str(routed_res), "created_at": _now_time_str()}

    _persist_qa_turn(req.summary_task_id, user_msg, assistant_msg)

    return routed_res


def _persist_qa_turn(task_id: str, user_msg: dict, assistant_msg: dict) -> None:
    t = get_summary_task(task_id)
    if t and isinstance(t.get("result"), dict):
        res_copy = dict(t["result"])
        chat_hist = list(res_copy.get("chat_history") or [])
        chat_hist.extend([user_msg, assistant_msg])
        res_copy["chat_history"] = chat_hist
        update_summary_task(task_id, result=res_copy)

    append_analysis_chat(task_id, user_msg, assistant_msg)


@router.post("/api/ask/stream")
def api_ask_stream(
    req: AskRequest,
    request: Request,
    user: Optional[dict] = Depends(optional_user),
):
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "llm_not_configured",
                "message": "AI 问答未启用：服务端未配置大模型 API Key。",
            },
        )
    question = (req.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    if len(question) > 2000:
        raise HTTPException(status_code=400, detail="问题过长（最多 2000 字）")

    result = _load_analysis_result(req.summary_task_id, user)
    if not result:
        raise HTTPException(status_code=404, detail="请先完成 AI 总结后再提问")

    # 未登录游客：按 IP 消耗每日免费提问配额（默认 15 次，GUEST_DAILY_ASK_LIMIT 可调）
    if not user:
        consume_guest_ask_quota(client_ip(request))

    history = None
    if req.history:
        history = [{"role": h.role, "content": h.content} for h in req.history]

    asked_at = _now_time_str()

    def event_gen():
        try:
            for item in qa_ask_routed_stream(
                result=result,
                question=question,
                history=history,
                summary_task_id=req.summary_task_id,
            ):
                if item.get("event") == "done":
                    user_msg = {"role": "user", "content": question, "created_at": asked_at}
                    assistant_msg = {
                        "role": "assistant",
                        "content": item.get("answer") or "",
                        "action": item.get("action"),
                        "router": item.get("router"),
                        "created_at": item.get("created_at") or _now_time_str(),
                    }
                    _persist_qa_turn(req.summary_task_id, user_msg, assistant_msg)
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        except Exception as e:  # noqa: BLE001
            info = classify_error(e)
            err_payload = {
                "event": "error",
                "message": info.get("message") or str(e),
            }
            yield f"data: {json.dumps(err_payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _persist_quiz_to_analysis(
    task_id: str,
    quiz_data: dict | None = None,
    quiz_state: dict | None = None,
    reset_state: bool = False,
) -> None:
    """同步更新内存 summary_tasks 与 PostgreSQL analyses.result 中的 quiz / quiz_state。"""
    if not task_id:
        return
    t = get_summary_task(task_id)
    if t and isinstance(t.get("result"), dict):
        res_copy = dict(t["result"])
        if quiz_data is not None:
            res_copy["quiz"] = quiz_data
        if reset_state:
            res_copy.pop("quiz_state", None)
        elif quiz_state is not None:
            res_copy["quiz_state"] = quiz_state
        update_summary_task(task_id, result=res_copy)

    save_analysis_quiz_data(
        task_id,
        quiz_data=quiz_data,
        quiz_state=quiz_state,
        reset_state=reset_state,
    )


@router.post("/api/quiz/generate")
def api_quiz_generate(
    req: QuizGenerateRequest,
    request: Request,
    user: Optional[dict] = Depends(optional_user),
):
    _check_llm_configured()
    result = _load_analysis_result(req.summary_task_id, user)
    if not result:
        raise HTTPException(status_code=404, detail="请先完成 AI 总结后再生成测验")

    # 生成测验依附于已完成的视频分析，不再额外扣减游客每日视频分析配额
    user_id = user["id"] if user else None

    try:
        generated = generate_quiz(result, req.count)
        # 持久化到 PostgreSQL quizzes 表
        db_quiz = save_quiz(
            analysis_id=req.summary_task_id,
            user_id=user_id,
            title=generated["title"],
            estimated_minutes=generated["estimated_minutes"],
            questions=generated["questions"],
        )
        # 同时写入内存字典缓存
        mem_quiz = create_quiz(
            req.summary_task_id,
            generated["questions"],
            title=generated["title"],
            estimated_minutes=generated["estimated_minutes"],
            quiz_id=db_quiz["id"],
        )
        pub_quiz = public_quiz(mem_quiz)
        # 同步持久化到 analyses.result.quiz，确保刷新或重新打开视频时立即可见
        _persist_quiz_to_analysis(req.summary_task_id, quiz_data=pub_quiz, reset_state=True)
        return pub_quiz
    except LLMConfigError as e:
        raise HTTPException(
            status_code=503,
            detail={"code": "llm_not_configured", "message": str(e)},
        ) from e
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail={"code": "quiz_invalid", "message": str(e)},
        ) from e
    except Exception as e:  # noqa: BLE001
        info = classify_error(e)
        raise HTTPException(
            status_code=500,
            detail={
                "code": info.get("code") or "quiz_generate_failed",
                "message": info.get("message") or f"生成测验失败：{e}",
            },
        ) from e


@router.post("/api/quiz/submit")
def api_quiz_submit(req: QuizSubmitRequest, user: Optional[dict] = Depends(optional_user)):
    quiz = get_quiz(req.quiz_id) or get_quiz_by_id(req.quiz_id)
    if not quiz:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "quiz_not_found",
                "message": "测验不存在或已过期，请重新生成",
            },
        )
    submitted = [
        {"question_id": answer.question_id, "answer": answer.answer}
        for answer in req.answers
    ]
    scored = score_quiz(quiz, submitted)

    # 持久化作答进度与评测成绩单至 analyses.result.quiz_state（无论登录用户还是游客回看均可恢复）
    analysis_id = (
        req.summary_task_id
        or str(quiz.get("summary_task_id") or "")
        or str(quiz.get("analysis_id") or "")
    )
    if analysis_id:
        ans_map = {str(a.question_id): a.answer for a in req.answers}
        rev_map = {str(q.get("id")): True for q in (quiz.get("questions") or []) if q.get("id")}
        for k in ans_map:
            rev_map[k] = True
        quiz_state = {
            "quiz_id": str(quiz.get("id") or quiz.get("quiz_id") or req.quiz_id),
            "answers": ans_map,
            "revealed": rev_map,
            "current_index": 0,
            "view_mode": "summary",
            "score_result": scored,
            "updated_at": _now_time_str(),
        }
        _persist_quiz_to_analysis(analysis_id, quiz_state=quiz_state)

    if user:
        try:
            save_quiz_attempt(
                quiz_id=quiz.get("id") or quiz.get("quiz_id"),
                user_id=user["id"],
                answers=submitted,
                result=scored,
                score=float(scored.get("score") or 0.0),
            )
        except Exception as e:
            logger.warning("保存测验成绩记录异常: %s", e)
    return scored


@router.post("/api/quiz/state")
def api_quiz_state(req: QuizStateSyncRequest):
    """实时同步保存用户的卡片答题进度与评测状态到 analyses.result.quiz_state。"""
    if not req.summary_task_id or not req.quiz_id:
        raise HTTPException(status_code=400, detail="缺少 summary_task_id 或 quiz_id")
    quiz_state = {
        "quiz_id": req.quiz_id,
        "answers": req.answers or {},
        "revealed": req.revealed or {},
        "current_index": req.current_index,
        "view_mode": req.view_mode or "deck",
        "score_result": req.score_result,
        "updated_at": _now_time_str(),
    }
    _persist_quiz_to_analysis(req.summary_task_id, quiz_state=quiz_state)
    return {"ok": True}

