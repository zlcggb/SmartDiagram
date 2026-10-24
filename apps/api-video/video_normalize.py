"""视频兼容性：检测 HEVC 并自动转 H.264（TikTok 等场景）。"""
from __future__ import annotations

import os
import shutil
import subprocess

from downloader import _ffmpeg_bin

_HEVC_NAMES = frozenset({"hevc", "h265", "hev1", "hvc1", "bytevc1"})


def _ffprobe_bin() -> str:
    ff = _ffmpeg_bin()
    if ff.lower().endswith("ffmpeg.exe"):
        candidate = ff[: -len("ffmpeg.exe")] + "ffprobe.exe"
        if os.path.isfile(candidate):
            return candidate
    if ff.endswith("ffmpeg"):
        candidate = ff[: -len("ffmpeg")] + "ffprobe"
        if os.path.isfile(candidate):
            return candidate
    return shutil.which("ffprobe") or "ffprobe"


def probe_video_codec(path: str) -> str | None:
    """返回首个视频流的 codec_name（小写），失败返回 None。"""
    if not path or not os.path.isfile(path):
        return None
    try:
        r = subprocess.run(
            [
                _ffprobe_bin(),
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    if r.returncode != 0:
        return None
    name = (r.stdout or "").strip().lower()
    return name or None


def is_hevc_codec(codec: str | None) -> bool:
    if not codec:
        return False
    low = codec.lower()
    if low in _HEVC_NAMES:
        return True
    return low.startswith("hev") or low.startswith("hvc")


def ensure_h264_mp4(path: str) -> str:
    """若非 HEVC 则原样返回；否则转码为 H.264+AAC 的 .mp4 并替换原文件。"""
    if not path or not os.path.isfile(path):
        return path

    codec = probe_video_codec(path)
    if not is_hevc_codec(codec):
        return path

    base, _ext = os.path.splitext(path)
    out_path = f"{base}.mp4"
    tmp = f"{base}._h264_tmp.mp4"

    cmd = [
        _ffmpeg_bin(),
        "-y",
        "-i",
        path,
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-crf",
        "23",
        "-preset",
        "fast",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        tmp,
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=600)

    try:
        os.remove(path)
    except OSError:
        pass
    os.replace(tmp, out_path)
    return out_path
