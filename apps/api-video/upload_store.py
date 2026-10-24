"""本地上传文件暂存（方案 B：先 upload 得 file_id，再 summarize）。

文件落在 backend/downloads/upload_{file_id}.* ，默认 1 小时未使用自动清理。
"""
from __future__ import annotations

import os
import threading
import time
import uuid

from downloader import DOWNLOAD_DIR

UPLOAD_MAX_BYTES = int(os.environ.get("UPLOAD_MAX_MB", "500")) * 1024 * 1024
UPLOAD_MAX_DURATION = float(os.environ.get("UPLOAD_MAX_DURATION", "7200"))
UPLOAD_TTL_SECONDS = int(os.environ.get("UPLOAD_TTL_SECONDS", "3600"))

ALLOWED_EXTENSIONS = frozenset(
    {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".mp3", ".m4a", ".wav", ".flac", ".aac"}
)

_entries: dict[str, dict] = {}
_lock = threading.Lock()


def new_file_id() -> str:
    return uuid.uuid4().hex


def upload_path(file_id: str, ext: str) -> str:
    ext = ext if ext.startswith(".") else f".{ext}"
    return os.path.join(DOWNLOAD_DIR, f"upload_{file_id}{ext.lower()}")


def register_upload(
    file_id: str,
    path: str,
    filename: str,
    size: int,
    duration: float | None,
) -> dict:
    now = time.time()
    meta = {
        "file_id": file_id,
        "path": path,
        "filename": filename,
        "size": size,
        "duration": duration,
        "created_at": now,
        "expires_at": now + UPLOAD_TTL_SECONDS,
    }
    with _lock:
        _entries[file_id] = meta
    return dict(meta)


def get_upload(file_id: str) -> dict | None:
    cleanup_expired()
    with _lock:
        meta = _entries.get(file_id)
        return dict(meta) if meta else None


def remove_upload(file_id: str) -> None:
    with _lock:
        meta = _entries.pop(file_id, None)
    if not meta:
        return
    path = meta.get("path")
    if path and os.path.isfile(path):
        try:
            os.remove(path)
        except OSError:
            pass


def cleanup_expired() -> None:
    now = time.time()
    expired: list[str] = []
    with _lock:
        for fid, meta in _entries.items():
            if meta.get("expires_at", 0) < now:
                expired.append(fid)
    for fid in expired:
        remove_upload(fid)
