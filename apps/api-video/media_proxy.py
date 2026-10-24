"""短时媒体代理令牌（防盗链 / 跨域播放，支持磁盘持久化防重载丢失）。"""
from __future__ import annotations

import json
import os
import re
import secrets
import tempfile
import threading
import time
from typing import Any
from urllib.parse import urljoin

PROXY_TTL_SECONDS = int(os.environ.get("MEDIA_PROXY_TTL_SECONDS", "7200"))
_STORE_PATH = os.path.join(tempfile.gettempdir(), "vidgrab_media_proxy_store.json")

_entries: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()
_loaded_from_disk = False

_URI_ATTR_RE = re.compile(r'URI="([^"]+)"', re.I)


def _load_disk_locked() -> None:
    global _loaded_from_disk
    if _loaded_from_disk:
        return
    _loaded_from_disk = True
    if not os.path.isfile(_STORE_PATH):
        return
    try:
        with open(_STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            now = time.time()
            for k, v in data.items():
                if isinstance(v, dict) and v.get("expires_at", 0) > now:
                    _entries[k] = v
    except Exception:
        pass


def _save_disk_locked() -> None:
    try:
        tmp_path = f"{_STORE_PATH}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(_entries, f, ensure_ascii=False)
        os.replace(tmp_path, _STORE_PATH)
    except Exception:
        pass


def create_proxy_token(
    url: str,
    headers: dict[str, str] | None = None,
    *,
    source_url: str | None = None,
) -> str:
    token = secrets.token_urlsafe(18)
    now = time.time()
    with _lock:
        _load_disk_locked()
        _purge_locked(now)
        _entries[token] = {
            "url": url,
            "headers": dict(headers or {}),
            "source_url": source_url or "",
            "expires_at": now + PROXY_TTL_SECONDS,
        }
        _save_disk_locked()
    return token


def update_proxy_entry(
    token: str,
    url: str,
    headers: dict[str, str] | None = None,
) -> None:
    now = time.time()
    with _lock:
        _load_disk_locked()
        entry = _entries.get(token) or {}
        entry["url"] = url
        if headers is not None:
            entry["headers"] = dict(headers)
        entry["expires_at"] = now + PROXY_TTL_SECONDS
        _entries[token] = entry
        _save_disk_locked()


def get_proxy_entry(token: str) -> dict[str, Any] | None:
    now = time.time()
    with _lock:
        _load_disk_locked()
        _purge_locked(now)
        entry = _entries.get(token)
        if not entry and os.path.isfile(_STORE_PATH):
            # 兼容多进程或外部更新后重新读取磁盘
            _loaded_from_disk_reset()
            _load_disk_locked()
            entry = _entries.get(token)
        if not entry:
            return None
        if entry.get("expires_at", 0) < now:
            _entries.pop(token, None)
            _save_disk_locked()
            return None
        return dict(entry)


def _loaded_from_disk_reset() -> None:
    global _loaded_from_disk
    _loaded_from_disk = False


def _purge_locked(now: float) -> None:
    expired = [k for k, v in _entries.items() if v.get("expires_at", 0) < now]
    for k in expired:
        _entries.pop(k, None)


def _proxy_line_url(raw: str, base_url: str, headers: dict[str, str], public_prefix: str = "/video-api") -> str:
    target = raw if raw.startswith(("http://", "https://")) else urljoin(base_url, raw)
    token = create_proxy_token(target, headers)
    prefix = public_prefix.rstrip("/") if public_prefix else ""
    return f"{prefix}/api/media/proxy/{token}"


def rewrite_m3u8_playlist(text: str, base_url: str, headers: dict[str, str] | None, public_prefix: str = "/video-api") -> str:
    """将 m3u8 内分片 URL 改写为同源代理，供 hls.js 播放。"""
    hdrs = dict(headers or {})
    out: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            out.append(line)
            continue
        if stripped.startswith("#"):
            def _repl(m: re.Match) -> str:
                uri = m.group(1)
                return f'URI="{_proxy_line_url(uri, base_url, hdrs, public_prefix)}"'

            out.append(_URI_ATTR_RE.sub(_repl, line))
            continue
        out.append(_proxy_line_url(stripped, base_url, hdrs, public_prefix))
    return "\n".join(out) + "\n"


def looks_like_m3u8(url: str, content_type: str | None, body_head: bytes) -> bool:
    if content_type and "mpegurl" in content_type.lower():
        return True
    if url and (".m3u8" in url.lower() or "hls_playlist" in url.lower()):
        return True
    head = body_head[:256].lstrip()
    return head.startswith(b"#EXTM3U") or b"#EXTM3U" in head[:200]
