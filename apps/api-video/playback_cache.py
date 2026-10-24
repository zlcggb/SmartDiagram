"""短时本地播放缓存（TikTok H.264 转码等，供浏览器 Range 播放）。"""
from __future__ import annotations

import os
import secrets
import threading
import time
from typing import Any

PLAYBACK_CACHE_TTL_SECONDS = int(
    os.environ.get("PLAYBACK_CACHE_TTL_SECONDS", "3600")
)

_entries: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


def create_playback_cache(path: str) -> str:
    """注册本地视频文件，返回短时访问 token。"""
    token = secrets.token_urlsafe(18)
    now = time.time()
    with _lock:
        _purge_locked(now)
        _entries[token] = {
            "path": path,
            "expires_at": now + PLAYBACK_CACHE_TTL_SECONDS,
        }
    return token


def get_playback_cache_path(token: str) -> str | None:
    now = time.time()
    with _lock:
        _purge_locked(now)
        entry = _entries.get(token)
        if not entry:
            return None
        if entry.get("expires_at", 0) < now:
            _remove_entry_locked(token, entry)
            return None
        path = entry.get("path")
        if not path or not os.path.isfile(path):
            _entries.pop(token, None)
            return None
        return path


def _remove_entry_locked(token: str, entry: dict[str, Any]) -> None:
    _entries.pop(token, None)
    path = entry.get("path")
    if path and os.path.isfile(path):
        try:
            os.remove(path)
        except OSError:
            pass


def _purge_locked(now: float) -> None:
    expired = [k for k, v in _entries.items() if v.get("expires_at", 0) < now]
    for k in expired:
        _remove_entry_locked(k, _entries[k])
