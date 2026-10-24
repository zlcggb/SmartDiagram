"""TikTok 工作台播放：yt-dlp 直链优先，失败则官方 embed 兜底。"""
from __future__ import annotations

import re
from typing import Any

import requests

from proxy_config import get_overseas_proxy

_TIKTOK_VIDEO_ID_RE = re.compile(r"/video/(\d+)")
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def extract_tiktok_video_id(url: str) -> str | None:
    """从完整链接或短链跳转结果中解析 video id。"""
    m = _TIKTOK_VIDEO_ID_RE.search(url or "")
    return m.group(1) if m else None


def resolve_tiktok_page_url(url: str) -> str:
    """短链 vm/vt.tiktok.com 跟随跳转到含 video id 的页面 URL。"""
    if extract_tiktok_video_id(url):
        return url
    proxy = get_overseas_proxy()
    proxies = {"http": proxy, "https": proxy} if proxy else None
    try:
        r = requests.get(
            url,
            allow_redirects=True,
            proxies=proxies,
            headers={"User-Agent": _UA},
            timeout=20,
        )
        return r.url or url
    except requests.RequestException:
        return url


def embed_tiktok(
    video_id: str,
    page_url: str,
    *,
    reason: str = "",
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "mode": "embed",
        "stream_type": "embed",
        "provider": "tiktok",
        "video_id": video_id,
        "embed_url": f"https://www.tiktok.com/embed/v2/{video_id}",
        "page_url": page_url,
        "source": "tiktok-embed",
    }
    if reason:
        out["fallback_reason"] = reason
    out["orientation"] = "portrait"
    return out
