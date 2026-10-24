"""海外站代理：环境变量优先，否则探测本机常见代理端口（Clash 等）。"""
from __future__ import annotations

import os
import socket
from functools import lru_cache
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
_PROXY_FILE = _BACKEND_DIR / "overseas_proxy.txt"

# Clash / Clash Verge / v2rayN 等常见本地 HTTP 代理端口
_COMMON_PROXY_PORTS = (10808, 7890, 7897, 1080, 8080)

_DEFAULT_NO_PROXY = "127.0.0.1,localhost,douyin.com,iesdouyin.com,bilibili.com,b23.tv"


def _normalize_proxy_url(value: str) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = f"http://{raw}"
    return raw


def _read_proxy_file() -> str | None:
    if not _PROXY_FILE.is_file():
        return None
    try:
        for line in _PROXY_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                return _normalize_proxy_url(line)
    except OSError:
        return None
    return None


def _port_open(host: str, port: int, timeout: float = 0.25) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


@lru_cache(maxsize=1)
def detect_local_proxy() -> str | None:
    """探测本机是否在常见端口提供 HTTP 代理。"""
    for port in _COMMON_PROXY_PORTS:
        if _port_open("127.0.0.1", port):
            return f"http://127.0.0.1:{port}"
    return None


def get_overseas_proxy() -> str | None:
    """解析海外站代理：HTTPS_PROXY > HTTP_PROXY > overseas_proxy.txt > 本机端口探测。"""
    for key in ("HTTPS_PROXY", "HTTP_PROXY", "OVERSEAS_PROXY"):
        url = _normalize_proxy_url(os.environ.get(key, ""))
        if url:
            return url
    file_url = _read_proxy_file()
    if file_url:
        return file_url
    return detect_local_proxy()


def ensure_proxy_env() -> str | None:
    """启动时写入进程环境变量，供 yt-dlp / requests 使用。"""
    proxy = get_overseas_proxy()
    if proxy:
        os.environ.setdefault("HTTP_PROXY", proxy)
        os.environ.setdefault("HTTPS_PROXY", proxy)
    no_proxy = os.environ.get("NO_PROXY") or _DEFAULT_NO_PROXY
    os.environ["NO_PROXY"] = no_proxy
    return proxy
