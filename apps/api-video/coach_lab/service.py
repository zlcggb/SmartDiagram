"""AI 视觉分析教练（Coach Lab）核心推理服务（100% 基于真实画面与真实 MediaPipe 检测结果）。"""
from __future__ import annotations

import concurrent.futures
import json
import re
import time
from typing import Any, Generator, Optional

from coach_lab.presets import AVAILABLE_COACH_MODELS, COACH_SCENE_PRESETS
from llm_client import chat_stream, get_llm_model

_META_TAG_RE = re.compile(r"<coach_meta>\s*(\{.*?\})\s*</coach_meta>", re.DOTALL)
_ALLOWED_MODEL_IDS = {m["id"] for m in AVAILABLE_COACH_MODELS}


def resolve_coach_model(requested_model: Optional[str] = None) -> str:
    req = (requested_model or "").strip()
    if req in _ALLOWED_MODEL_IDS:
        return req
    if req:
        return req
    default_env = (get_llm_model() or "").strip()
    if default_env in _ALLOWED_MODEL_IDS:
        return default_env
    return "gemini-3.5-flash-lite"


def _estimate_payload_kb(images: list[str]) -> float:
    total_chars = sum(len(img or "") for img in images)
    return round((total_chars * 0.75) / 1024.0, 1)


def _ensure_data_url(b64_or_url: str) -> str:
    s = (b64_or_url or "").strip()
    if s.startswith("data:image/"):
        return s
    return f"data:image/jpeg;base64,{s}"


def build_coach_messages(
    *,
    mode: str,
    scene_id: str,
    custom_rubric: Optional[str],
    time_range_label: str,
    window_index: int,
    grid_image: Optional[str] = None,
    raw_frames: Optional[list[str]] = None,
    pose_metrics: Optional[dict[str, Any]] = None,
    rolling_memory: Optional[list[str]] = None,
) -> tuple[list[dict[str, Any]], float, int]:
    preset = COACH_SCENE_PRESETS.get(scene_id) or COACH_SCENE_PRESETS["live_observer"]
    rubric_text = (custom_rubric or "").strip() or preset["user_rubric"]

    memory_block = ""
    if rolling_memory:
        recent = [m.strip() for m in rolling_memory[-3:] if m and m.strip()]
        if recent:
            memory_block = "\n【前序片段真实记录（供对比变化，不要重复）】\n" + "\n".join(
                f"- {m}" for m in recent
            )

    meta_instruction = (
        "\n\n【输出格式要求】\n"
        "第一部分：直接用自然、好懂的中文（可附1句英文）输出 2~3 句真实画面观察与建议，画面里有什么就说什么，绝不编造看不见的身体部位。\n"
        "第二部分：在正文最后换行附加一行 <coach_meta> JSON（不要用代码块），格式：\n"
        '<coach_meta>{"status":"good|normal|warning","score":88,"tag":"真实动作简述(8字内)","apex_cell":3,"angle_note":"真实入镜部位与实测角度说明","advice":"一句话建议"}</coach_meta>'
    )

    if mode == "baseline_multi":
        frames = [f for f in (raw_frames or []) if f]
        if not frames and grid_image:
            frames = [grid_image]
        payload_kb = _estimate_payload_kb(frames)
        vision_tokens = max(258, len(frames) * 258)

        user_text = (
            f"【第 {window_index} 段 · 时间 {time_range_label}（共 {len(frames)} 帧独立画面）】\n"
            f"{rubric_text}"
            f"{memory_block}"
            f"{meta_instruction}"
        )
        content_items: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
        for f_url in frames[:4]:
            content_items.append(
                {
                    "type": "image_url",
                    "image_url": {"url": _ensure_data_url(f_url)},
                }
            )
        return (
            [
                {"role": "system", "content": preset["system_prompt"]},
                {"role": "user", "content": content_items},
            ],
            payload_kb,
            vision_tokens,
        )

    img_str = grid_image or ((raw_frames or [""])[0])
    payload_kb = _estimate_payload_kb([img_str])
    vision_tokens = 258

    pose_block = ""
    if pose_metrics:
        pose_json_str = json.dumps(pose_metrics, ensure_ascii=False)
        pose_block = (
            "\n【前端 MediaPipe 三合一高精度检测数据（全身33点Full + 双手42指关节 + 面部478点3D朝向与表情）】\n"
            f"{pose_json_str}\n"
            "注意：请积极引用上述实测到的头部3D朝向（转头/低头/歪头角度）、面部状态、双手手指张开/握拳/位置状态、以及肩肘夹角变化来给出专业教练级反馈；同时绝对禁止提及未入镜的部位（如未入镜的膝盖或腿部）！"
        )

    user_text = (
        f"【第 {window_index} 段 · 时间段 {time_range_label}】\n"
        f"图像说明：这是一张按时间顺序拼合的 2×2 连续画面（左上#1 → 右上#2 → 左下#3 → 右下#4）。\n"
        f"【分析要求】\n{rubric_text}"
        f"{pose_block}"
        f"{memory_block}"
        f"{meta_instruction}"
    )

    content_items = [
        {"type": "text", "text": user_text},
        {
            "type": "image_url",
            "image_url": {"url": _ensure_data_url(img_str)},
        },
    ]
    return (
        [
            {"role": "system", "content": preset["system_prompt"]},
            {"role": "user", "content": content_items},
        ],
        payload_kb,
        vision_tokens,
    )


def parse_coach_output(raw_text: str) -> tuple[str, dict[str, Any]]:
    default_meta = {
        "status": "normal",
        "score": 85,
        "tag": "实时画面观察",
        "apex_cell": 3,
        "angle_note": "",
        "advice": "",
    }
    if not raw_text:
        return "", default_meta

    match = _META_TAG_RE.search(raw_text)
    if not match:
        clean = re.sub(r"<coach_meta>.*$", "", raw_text, flags=re.DOTALL).strip()
        return clean, default_meta

    clean = (raw_text[: match.start()] + raw_text[match.end() :]).strip()
    raw_json = match.group(1).strip()
    try:
        parsed = json.loads(raw_json)
        if isinstance(parsed, dict):
            status = str(parsed.get("status") or "normal").lower()
            if status not in ("good", "normal", "warning"):
                status = "normal"
            score = max(0, min(100, int(parsed.get("score") or 85)))
            return clean, {
                "status": status,
                "score": score,
                "tag": str(parsed.get("tag") or "实时画面观察")[:18],
                "apex_cell": int(parsed.get("apex_cell") or 3),
                "angle_note": str(parsed.get("angle_note") or ""),
                "advice": str(parsed.get("advice") or ""),
            }
    except Exception:
        pass
    return clean, default_meta


def stream_coach_window(
    *,
    mode: str = "grid_grounded",
    model: Optional[str] = None,
    scene_id: str = "live_observer",
    custom_rubric: Optional[str] = None,
    time_range_label: str = "00:00.0-00:04.0",
    window_index: int = 1,
    grid_image: Optional[str] = None,
    raw_frames: Optional[list[str]] = None,
    pose_metrics: Optional[dict[str, Any]] = None,
    rolling_memory: Optional[list[str]] = None,
) -> Generator[str, None, None]:
    resolved_model = resolve_coach_model(model)
    messages, payload_kb, vision_tokens = build_coach_messages(
        mode=mode,
        scene_id=scene_id,
        custom_rubric=custom_rubric,
        time_range_label=time_range_label,
        window_index=window_index,
        grid_image=grid_image,
        raw_frames=raw_frames,
        pose_metrics=pose_metrics,
        rolling_memory=rolling_memory,
    )

    t0 = time.perf_counter()
    ttft_ms: Optional[int] = None

    start_event = {
        "type": "start",
        "window_index": window_index,
        "mode": mode,
        "model": resolved_model,
        "payload_kb": payload_kb,
        "estimated_vision_tokens": vision_tokens,
    }
    yield f"data: {json.dumps(start_event, ensure_ascii=False)}\n\n"

    full_buf = ""
    emitted_len = 0

    try:
        for delta in chat_stream(
            messages,
            model=resolved_model,
            temperature=0.2,
            max_tokens=600,
        ):
            if ttft_ms is None:
                ttft_ms = int((time.perf_counter() - t0) * 1000)
            full_buf += delta

            tag_idx = full_buf.find("<coach_meta")
            safe_limit = tag_idx if tag_idx != -1 else max(0, len(full_buf) - 12)
            if safe_limit > emitted_len:
                chunk_to_emit = full_buf[emitted_len:safe_limit]
                emitted_len = safe_limit
                evt = {
                    "type": "delta",
                    "content": chunk_to_emit,
                    "ttft_ms": ttft_ms,
                }
                yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"

        total_ms = int((time.perf_counter() - t0) * 1000)
        if ttft_ms is None:
            ttft_ms = total_ms

        clean_text, meta = parse_coach_output(full_buf)
        if len(clean_text) > emitted_len:
            tail = clean_text[emitted_len:]
            if tail:
                yield f"data: {json.dumps({'type': 'delta', 'content': tail, 'ttft_ms': ttft_ms}, ensure_ascii=False)}\n\n"

        done_event = {
            "type": "done",
            "window_index": window_index,
            "text": clean_text,
            "meta": meta,
            "telemetry": {
                "model": resolved_model,
                "mode": mode,
                "ttft_ms": ttft_ms,
                "total_ms": total_ms,
                "payload_kb": payload_kb,
                "estimated_vision_tokens": vision_tokens,
            },
        }
        yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"
    except Exception as exc:  # noqa: BLE001
        err_event = {
            "type": "error",
            "message": f"视觉模型分析异常：{exc}",
        }
        yield f"data: {json.dumps(err_event, ensure_ascii=False)}\n\n"


def _run_single_sync(
    *,
    mode: str,
    model: str,
    scene_id: str,
    custom_rubric: Optional[str],
    time_range_label: str,
    grid_image: Optional[str],
    raw_frames: Optional[list[str]],
    pose_metrics: Optional[dict[str, Any]],
) -> dict[str, Any]:
    messages, payload_kb, vision_tokens = build_coach_messages(
        mode=mode,
        scene_id=scene_id,
        custom_rubric=custom_rubric,
        time_range_label=time_range_label,
        window_index=1,
        grid_image=grid_image,
        raw_frames=raw_frames,
        pose_metrics=pose_metrics,
        rolling_memory=None,
    )
    t0 = time.perf_counter()
    ttft_ms: Optional[int] = None
    buf = ""
    for delta in chat_stream(messages, model=model, temperature=0.2, max_tokens=600):
        if ttft_ms is None:
            ttft_ms = int((time.perf_counter() - t0) * 1000)
        buf += delta
    total_ms = int((time.perf_counter() - t0) * 1000)
    if ttft_ms is None:
        ttft_ms = total_ms
    clean_text, meta = parse_coach_output(buf)
    return {
        "mode": mode,
        "model": model,
        "ttft_ms": ttft_ms,
        "total_ms": total_ms,
        "payload_kb": payload_kb,
        "estimated_vision_tokens": vision_tokens,
        "text": clean_text,
        "meta": meta,
    }


def run_ab_benchmark(
    *,
    model: Optional[str],
    scene_id: str,
    custom_rubric: Optional[str],
    time_range_label: str,
    grid_image: str,
    raw_frames: list[str],
    pose_metrics: dict[str, Any],
) -> dict[str, Any]:
    resolved_model = resolve_coach_model(model)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        fut_baseline = pool.submit(
            _run_single_sync,
            mode="baseline_multi",
            model=resolved_model,
            scene_id=scene_id,
            custom_rubric=custom_rubric,
            time_range_label=time_range_label,
            grid_image=grid_image,
            raw_frames=raw_frames,
            pose_metrics=None,
        )
        fut_ours = pool.submit(
            _run_single_sync,
            mode="grid_grounded",
            model=resolved_model,
            scene_id=scene_id,
            custom_rubric=custom_rubric,
            time_range_label=time_range_label,
            grid_image=grid_image,
            raw_frames=None,
            pose_metrics=pose_metrics,
        )
        res_base = fut_baseline.result()
        res_ours = fut_ours.result()

    base_total = max(1, res_base["total_ms"])
    base_ttft = max(1, res_base["ttft_ms"])
    base_kb = max(0.1, res_base["payload_kb"])
    base_tok = max(1, res_base["estimated_vision_tokens"])

    return {
        "model": resolved_model,
        "scene_id": scene_id,
        "baseline": res_base,
        "ours": res_ours,
        "comparison": {
            "ttft_reduction_pct": round((base_ttft - res_ours["ttft_ms"]) / base_ttft * 100, 1),
            "total_latency_reduction_pct": round((base_total - res_ours["total_ms"]) / base_total * 100, 1),
            "payload_reduction_pct": round((base_kb - res_ours["payload_kb"]) / base_kb * 100, 1),
            "token_reduction_pct": round((base_tok - res_ours["estimated_vision_tokens"]) / base_tok * 100, 1),
            "queue_safe_baseline": res_base["total_ms"] < 4000,
            "queue_safe_ours": res_ours["total_ms"] < 4000,
        },
    }
