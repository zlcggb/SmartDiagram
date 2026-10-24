"""Web 视频压缩转码 Worker：自适应压制 720p H.264 + AAC + faststart 边下边播。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import logging
import os
from pathlib import Path
import shutil
import subprocess

from db import db_cursor
from repo import get_video, update_video

logger = logging.getLogger(__name__)

# 单线程后台执行队列，防止转码争抢系统 CPU 导致 ASR/API 卡顿
_transcode_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vidgrab_transcoder")


def get_storage_base_dir() -> Path:
    raw = (
        os.environ.get("VIDEO_STORAGE_DIR")
        or os.environ.get("VIDEO_STORAGE_ROOT")
        or ""
    ).strip()
    if raw:
        p = Path(raw)
    else:
        p = Path(__file__).resolve().parent / "data" / "videos"
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_total_storage_bytes() -> int:
    with db_cursor() as cur:
        cur.execute("SELECT COALESCE(SUM(storage_bytes), 0) as total FROM videos")
        row = cur.fetchone()
        return int(row["total"]) if row else 0


def is_storage_quota_exceeded() -> bool:
    max_gb = float(os.environ.get("VIDEO_STORAGE_MAX_GB", "50"))
    if max_gb <= 0:
        return False
    current_bytes = get_total_storage_bytes()
    return current_bytes >= max_gb * 1024 * 1024 * 1024


def _is_audio_only(filepath: str) -> bool:
    ext = os.path.splitext(filepath)[1].lower()
    return ext in {".mp3", ".m4a", ".wav", ".flac", ".aac"}


def _do_transcode(video_id: str, input_path: str, user_id: str) -> None:
    video = get_video(video_id)
    if not video:
        logger.warning("转码跳过：视频记录不存在 %s", video_id)
        return

    if not os.path.isfile(input_path):
        logger.warning("转码跳过：源文件不存在 %s", input_path)
        update_video(video_id, storage_status="failed")
        return

    # 1. 检查存储配额
    if is_storage_quota_exceeded():
        logger.warning("转码跳过：视频归档存储空间已达上限 (VIDEO_STORAGE_MAX_GB)")
        update_video(video_id, storage_status="skipped")
        return

    # 2. 标记状态为 transcoding
    update_video(video_id, storage_status="transcoding")

    ffmpeg_bin = shutil.which("ffmpeg") or os.environ.get("FFMPEG_LOCATION") or "ffmpeg"
    user_dir = get_storage_base_dir() / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    is_audio = _is_audio_only(input_path)
    ext = ".m4a" if is_audio else ".mp4"
    output_path = str(user_dir / f"{video_id}{ext}")
    temp_output_path = output_path + ".tmp"

    if os.path.isfile(temp_output_path):
        try:
            os.remove(temp_output_path)
        except OSError:
            pass

    try:
        logger.info("开始视频 Web 压缩转码: %s -> %s", input_path, output_path)
        if is_audio:
            # 纯音频转码压缩为 96kbps AAC
            cmd = [
                ffmpeg_bin,
                "-y",
                "-i",
                input_path,
                "-vn",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                "-movflags",
                "+faststart",
                temp_output_path,
            ]
        else:
            # 视频转码：最大 720p，CRF 28，H.264+AAC，关键帧前置 faststart
            cmd = [
                ffmpeg_bin,
                "-y",
                "-i",
                input_path,
                "-vf",
                "scale='min(1280,iw)':-2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "28",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                "-ac",
                "2",
                "-movflags",
                "+faststart",
                temp_output_path,
            ]

        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=1800)
        if res.returncode != 0:
            logger.error("FFmpeg 转码失败 (code=%d): %s", res.returncode, res.stderr[-500:])
            update_video(video_id, storage_status="failed")
            if os.path.isfile(temp_output_path):
                os.remove(temp_output_path)
            return

        if os.path.isfile(temp_output_path):
            os.replace(temp_output_path, output_path)
            size = os.path.getsize(output_path)
            update_video(
                video_id,
                storage_status="ready",
                storage_path=output_path,
                storage_bytes=size,
            )
            logger.info("视频转码压缩完成: %s, 产实体积: %d 字节", video_id, size)
    except Exception as e:
        logger.error("转码异常 (%s): %s", video_id, e)
        update_video(video_id, storage_status="failed")
        if os.path.isfile(temp_output_path):
            try:
                os.remove(temp_output_path)
            except OSError:
                pass


def submit_transcode(video_id: str, input_path: str, user_id: str) -> None:
    """提交后台异步压制任务。"""
    _transcode_executor.submit(_do_transcode, video_id, input_path, user_id)
