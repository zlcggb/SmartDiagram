"""无旁白 / 弱旁白视频：PySceneDetect 抽帧 + 视觉大模型画面描述 → 伪字幕 segments。

方案 A：旁白不足时纯画面总结（source=vision）
方案 E：旁白充足时音画融合（source=multimodal，VISION_FUSION 默认开启）
"""
from __future__ import annotations

import base64
import glob
import os
import subprocess
from typing import Callable

from downloader import (
    DOWNLOAD_DIR,
    FFMPEG_LOCATION,
    _TIKTOK_YTDLP_FORMAT,
    _apply_cookies,
    _apply_http_headers,
    _apply_js_runtime,
    _apply_player_clients,
    _apply_pot_provider,
    _apply_proxy_opts,
    _ffmpeg_bin,
    _first_entry,
    _recover,
)
from llm_client import LLMConfigError, get_vision_model, is_configured
from summary_tasks import ensure_not_cancelled
from url_normalize import is_tiktok_url, normalize_url
from yt_dlp import YoutubeDL


class VisionAnalysisError(RuntimeError):
    """画面分析失败（由 transcript 层转为 TranscriptError 展示给用户）。"""

VISION_MODEL = get_vision_model()
VISION_MAX_FRAMES = int(os.environ.get("VISION_MAX_FRAMES", "24"))
VISION_MIN_SPEECH_CHARS = int(os.environ.get("VISION_MIN_SPEECH_CHARS", "80"))
VISION_SCENE_THRESHOLD = float(os.environ.get("VISION_SCENE_THRESHOLD", "27.0"))
VISION_FUSION_ENABLED = os.environ.get("VISION_FUSION", "0").strip().lower() not in (
    "0",
    "false",
    "no",
)

_COMPACT_FORMAT = (
    "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/"
    "bestvideo[height<=480]+bestaudio/"
    "best[height<=480]/"
    "best"
)


def _safe_remove(path: str) -> None:
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def is_vision_configured() -> bool:
    return is_configured() and bool((VISION_MODEL or "").strip())


def speech_char_count(segments: list | None) -> int:
    return sum(len((s.get("text") or "").strip()) for s in (segments or []))


from video_normalize import _ffprobe_bin


def _probe_duration(path: str) -> float:
    probe = _ffprobe_bin()
    try:
        out = subprocess.run(
            [
                probe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=60,
        )
        return float((out.stdout or "").strip() or 0)
    except (subprocess.SubprocessError, ValueError):
        return 0.0


def _uniform_scene_times(duration: float, max_frames: int) -> list[tuple[float, float]]:
    if duration <= 0:
        return [(0.0, 1.0)]
    n = min(max_frames, max(1, int(duration / 4) + 1))
    step = duration / n
    return [(i * step, min(duration, (i + 1) * step)) for i in range(n)]


def extract_scene_times(video_path: str, max_frames: int) -> list[tuple[float, float]]:
    """返回 (时间点秒, 场景结束秒) 列表，用于抽帧与 segments 时间轴。"""
    try:
        from scenedetect import SceneManager, open_video
        from scenedetect.detectors import ContentDetector

        video = open_video(video_path)
        manager = SceneManager()
        manager.add_detector(ContentDetector(threshold=VISION_SCENE_THRESHOLD))
        manager.detect_scenes(video)
        scene_list = manager.get_scene_list()
    except Exception:
        scene_list = []

    if not scene_list:
        return _uniform_scene_times(_probe_duration(video_path), max_frames)

    times: list[tuple[float, float]] = []
    for start, end in scene_list:
        s0 = start.get_seconds()
        s1 = end.get_seconds()
        mid = s0 + max(0.0, (s1 - s0) / 2)
        times.append((mid, s1))

    if len(times) > max_frames:
        step = len(times) / max_frames
        times = [times[int(i * step)] for i in range(max_frames)]
    return times[:max_frames]


def extract_frame_jpeg(video_path: str, timestamp: float, out_path: str) -> None:
    cmd = [
        _ffmpeg_bin(),
        "-y",
        "-ss",
        str(max(0.0, timestamp)),
        "-i",
        video_path,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        out_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=120)


def _caption_frame(image_path: str, *, lang: str = "中文（简体）") -> str:
    from llm_client import chat_vision

    with open(image_path, "rb") as f:
        b64 = base64.standard_b64encode(f.read()).decode("ascii")
    messages = [
        {
            "role": "system",
            "content": (
                f"你是视频画面分析助手。用{lang}简洁描述这一帧：主体、动作、场景、"
                "镜头类型、画面上可见的文字（如有）。1～3 句，不要寒暄。"
            ),
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请描述这一帧画面。"},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                },
            ],
        },
    ]
    return chat_vision(messages, model=VISION_MODEL, max_tokens=512)


def build_vision_segments(
    video_path: str,
    work_id: str,
    *,
    progress: Callable[[str, float], None] | None = None,
    lang: str = "中文（简体）",
) -> list[dict]:
    if not is_vision_configured():
        raise VisionAnalysisError(
            "该视频旁白极少，需要画面分析，但未配置视觉模型。"
            "请设置 VISION_MODEL（如 Qwen/Qwen3-VL-8B-Instruct）与 LLM_API_KEY。"
        )

    times = extract_scene_times(video_path, VISION_MAX_FRAMES)
    segments: list[dict] = []
    prefix = f"vis_{work_id}"

    for i, (t, end_t) in enumerate(times):
        ensure_not_cancelled(work_id)
        frame_path = os.path.join(DOWNLOAD_DIR, f"{prefix}_{i}.jpg")
        try:
            extract_frame_jpeg(video_path, t, frame_path)
            text = _caption_frame(frame_path, lang=lang).strip()
            if text:
                segments.append(
                    {
                        "start": float(t),
                        "end": float(end_t),
                        "text": text,
                    }
                )
        except LLMConfigError:
            raise
        except Exception as e:  # noqa: BLE001
            if not segments:
                raise VisionAnalysisError(f"画面分析失败：{e}") from e
        finally:
            _safe_remove(frame_path)
        if progress:
            progress(
                "analyzing_frames",
                22 + int(28 * (i + 1) / max(len(times), 1)),
            )

    if not segments:
        raise VisionAnalysisError("画面分析未得到有效描述，请换片或稍后重试。")
    return segments


def _merge_speech_vision(speech: list, vision: list) -> list[dict]:
    merged: list[dict] = []
    for s in speech:
        merged.append(
            {
                "start": float(s.get("start", 0)),
                "end": float(s.get("end", s.get("start", 0))),
                "text": (s.get("text") or "").strip(),
                "kind": "speech",
            }
        )
    for v in vision:
        txt = (v.get("text") or "").strip()
        if not txt:
            continue
        merged.append(
            {
                "start": float(v.get("start", 0)),
                "end": float(v.get("end", v.get("start", 0))),
                "text": f"【画面】{txt}",
                "kind": "vision",
            }
        )
    merged.sort(key=lambda x: x["start"])
    return merged


def _download_compact_video(url: str, browser: str | None, work_id: str) -> str:
    """为画面分析下载低码率整段视频（临时文件）。"""
    url = normalize_url(url)
    prefix = f"vid_{work_id}"
    outtmpl = os.path.join(DOWNLOAD_DIR, f"{prefix}.%(ext)s")
    fmt = _TIKTOK_YTDLP_FORMAT if is_tiktok_url(url) else _COMPACT_FORMAT

    def _run(use_browser: str | None, clients: list | None = None) -> dict:
        opts = {
            "format": fmt,
            "outtmpl": outtmpl,
            "merge_output_format": "mp4",
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "socket_timeout": 60,
        }
        if FFMPEG_LOCATION:
            opts["ffmpeg_location"] = FFMPEG_LOCATION
        _apply_pot_provider(opts)
        _apply_player_clients(opts, clients)
        _apply_js_runtime(opts)
        _apply_http_headers(opts, url)
        _apply_proxy_opts(opts, url)
        _apply_cookies(opts, use_browser)
        with YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=True)

    try:
        info = _run(browser)
    except Exception as e:  # noqa: BLE001
        info = _recover(_run, browser, e)
    info = _first_entry(info)
    matches = glob.glob(os.path.join(DOWNLOAD_DIR, f"{prefix}.*"))
    if not matches:
        raise VisionAnalysisError("无法下载视频用于画面分析。")
    matches.sort(key=lambda p: (not p.lower().endswith(".mp4"), len(p)))
    return matches[0]


def _acquire_video_path(
    *,
    url: str | None,
    file_path: str | None,
    browser: str | None,
    work_id: str,
) -> str:
    if file_path and os.path.isfile(file_path):
        from video_normalize import ensure_h264_mp4

        return ensure_h264_mp4(file_path)
    if url:
        return _download_compact_video(url, browser, work_id)
    raise VisionAnalysisError("无法定位视频文件以进行画面分析。")


def enrich_transcript_with_vision(
    transcript: dict,
    *,
    url: str | None = None,
    file_path: str | None = None,
    browser: str | None = None,
    work_id: str,
    progress: Callable[[str, float], None] | None = None,
    lang: str = "中文（简体）",
) -> dict:
    """在 ASR/字幕结果上按需追加画面分析（方案 A + E）。"""
    segments = list(transcript.get("segments") or [])
    source = transcript.get("source") or "asr"
    chars = speech_char_count(segments)

    # 平台字幕已足够做总结，跳过极慢的画面下载 + VLM（需显式 VISION_FUSION=1 才融合）
    if source == "subtitle":
        return transcript

    need_vision_only = chars < VISION_MIN_SPEECH_CHARS
    need_fusion = VISION_FUSION_ENABLED and not need_vision_only and chars >= VISION_MIN_SPEECH_CHARS

    if not need_vision_only and not need_fusion:
        return transcript

    if not is_vision_configured():
        if need_vision_only:
            raise VisionAnalysisError(
                "该视频几乎无旁白/字幕，无法仅靠语音总结。"
                "请配置 VISION_MODEL（视觉大模型；硅基流动 DeepSeek 文本系不能看图，可用 Qwen3-VL 等）后重试。"
            )
        return transcript

    temp_video = None
    video_path = None
    try:
        if file_path and os.path.isfile(file_path):
            video_path = _acquire_video_path(file_path=file_path, url=None, browser=browser, work_id=work_id)
        elif url:
            video_path = _acquire_video_path(url=url, file_path=None, browser=browser, work_id=work_id)
            if not file_path:
                temp_video = video_path
        else:
            raise VisionAnalysisError("缺少视频来源，无法进行画面分析。")

        vision_segments = build_vision_segments(
            video_path, work_id, progress=progress, lang=lang
        )

        if need_vision_only:
            return {"source": "vision", "segments": vision_segments}

        merged = _merge_speech_vision(segments, vision_segments)
        return {"source": "multimodal", "segments": merged}
    finally:
        if temp_video:
            _safe_remove(temp_video)
        for f in glob.glob(os.path.join(DOWNLOAD_DIR, f"vid_{work_id}.*")):
            _safe_remove(f)
