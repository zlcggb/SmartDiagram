"""yt-dlp extract_info 短时内存缓存。

仅缓存**成功**结果；leader 失败时不连坐 follower，避免 prepare 降级成功而 info 被误杀。
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Callable

from url_normalize import normalize_url

_TTL = int(os.environ.get("YTDLP_CACHE_TTL", "300"))
_WAIT_TIMEOUT = int(os.environ.get("YTDLP_CACHE_WAIT", "180"))
_MAX_RETRIES = 3
_store: dict[str, tuple[float, dict[str, Any]]] = {}
_inflight: dict[str, threading.Event] = {}
_lock = threading.Lock()


def _cache_key(url: str, browser: str | None, variant: str) -> str:
    return f"{variant}:{normalize_url(url)}|{browser or ''}"


def _purge_locked(now: float) -> None:
    expired = [k for k, (exp, _) in _store.items() if exp <= now]
    for k in expired:
        _store.pop(k, None)


def get(url: str, browser: str | None, *, variant: str = "default") -> dict[str, Any] | None:
    now = time.time()
    k = _cache_key(url, browser, variant)
    with _lock:
        entry = _store.get(k)
        if not entry:
            return None
        expires, info = entry
        if now >= expires:
            _store.pop(k, None)
            return None
        return info


def put(url: str, browser: str | None, info: dict[str, Any], *, variant: str = "default") -> None:
    k = _cache_key(url, browser, variant)
    with _lock:
        _purge_locked(time.time())
        _store[k] = (time.time() + _TTL, info)


def cached_extract(
    url: str,
    browser: str | None,
    fn: Callable[[], dict[str, Any]],
    *,
    variant: str = "default",
) -> dict[str, Any]:
    for _ in range(_MAX_RETRIES):
        hit = get(url, browser, variant=variant)
        if hit is not None:
            return hit

        k = _cache_key(url, browser, variant)
        leader = False
        with _lock:
            event = _inflight.get(k)
            if event is None:
                event = threading.Event()
                _inflight[k] = event
                leader = True

        if not leader:
            if not event.wait(timeout=_WAIT_TIMEOUT):
                raise TimeoutError(f"yt-dlp 解析等待超时：{url}")
            continue

        try:
            info = fn()
            put(url, browser, info, variant=variant)
            return info
        finally:
            event.set()
            with _lock:
                if _inflight.get(k) is event:
                    _inflight.pop(k, None)

    raise TimeoutError(f"yt-dlp 解析重试次数用尽：{url}")
