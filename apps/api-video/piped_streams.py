"""YouTube 播放：Piped API（NewPipeExtractor 生态）+ 多实例容错。

参考开源项目 TeamPiped/Piped：https://github.com/TeamPiped/Piped
API 文档：https://docs.piped.video/docs/api-documentation/
"""
from __future__ import annotations

import os
import time
from typing import Any
from urllib.parse import urljoin

import requests

from proxy_config import get_overseas_proxy

_INSTANCES_CACHE: tuple[float, list[str]] = (0.0, [])
_CACHE_TTL = 600

_DEFAULT_INSTANCES = [
    "https://api.piped.private.coffee",
    "https://pipedapi.kavin.rocks",
]

_YT_HEADERS = {
    "Referer": "https://www.youtube.com/",
    "Origin": "https://www.youtube.com",
}


def _env_instances() -> list[str]:
    raw = (os.environ.get("PIPED_API_URL") or "").strip()
    if not raw:
        return []
    return [u.strip().rstrip("/") for u in raw.split(",") if u.strip()]


def _fetch_public_instances() -> list[str]:
    global _INSTANCES_CACHE
    now = time.time()
    if _INSTANCES_CACHE[1] and now - _INSTANCES_CACHE[0] < _CACHE_TTL:
        return _INSTANCES_CACHE[1]
    urls: list[str] = []
    try:
        proxy = get_overseas_proxy()
        proxies = {"http": proxy, "https": proxy} if proxy else None
        r = requests.get(
            "https://piped-instances.kavin.rocks/",
            timeout=12,
            proxies=proxies,
        )
        if r.status_code == 200:
            for item in r.json():
                api = (item or {}).get("api_url")
                if api:
                    urls.append(str(api).rstrip("/"))
    except Exception:
        pass
    if not urls:
        urls = list(_DEFAULT_INSTANCES)
    _INSTANCES_CACHE = (now, urls)
    return urls


def _instance_list() -> list[str]:
    env = _env_instances()
    if env:
        return env
    return _fetch_public_instances()


def _abs_stream_url(stream_url: str, proxy_base: str | None, api_base: str) -> str:
    if stream_url.startswith(("http://", "https://")):
        return stream_url
    base = (proxy_base or api_base).rstrip("/")
    return urljoin(base + "/", stream_url.lstrip("/"))


def _pick_stream(data: dict, api_base: str) -> tuple[str, str]:
    """返回 (url, stream_type progressive|hls)。"""
    video_streams = data.get("videoStreams") or []
    audio_streams = data.get("audioStreams") or []
    proxy_base = data.get("proxyUrl")

    candidates: list[tuple[int, str, str]] = []

    def score_mime(mime: str, quality: str) -> int:
        m = (mime or "").lower()
        q = (quality or "").lower()
        s = 0
        if "mp4" in m:
            s += 100
        if "video" in m:
            s += 50
        if "720" in q:
            s += 30
        if "480" in q:
            s += 20
        if "360" in q:
            s += 10
        if "m3u8" in m or "mpegurl" in m:
            s += 5
        return s

    for vs in video_streams:
        url = vs.get("url")
        if not url:
            continue
        mime = vs.get("mimeType") or ""
        quality = vs.get("quality") or ""
        abs_url = _abs_stream_url(url, proxy_base, api_base)
        st = "hls" if "m3u8" in mime.lower() or "mpegurl" in mime.lower() else "progressive"
        candidates.append((score_mime(mime, quality), abs_url, st))

    if not candidates and audio_streams:
        for au in audio_streams:
            url = au.get("url")
            if url:
                abs_url = _abs_stream_url(url, proxy_base, api_base)
                candidates.append((1, abs_url, "progressive"))

    if not candidates:
        raise ValueError("Piped 未返回可播放流")

    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1], candidates[0][2]


def fetch_piped_playback(video_id: str) -> dict[str, Any]:
    """从 Piped 实例拉取 YouTube 可播放地址。"""
    errors: list[str] = []
    proxy = get_overseas_proxy()
    proxies = {"http": proxy, "https": proxy} if proxy else None

    for api_base in _instance_list():
        try:
            r = requests.get(
                f"{api_base}/streams/{video_id}",
                timeout=35,
                proxies=proxies,
                headers={"User-Agent": "VidGrab/1.0"},
            )
            if r.status_code != 200:
                errors.append(f"{api_base}: HTTP {r.status_code}")
                continue
            data = r.json()
            stream_url, stream_type = _pick_stream(data, api_base)
            return {
                "stream_url": stream_url,
                "stream_type": stream_type,
                "headers": dict(_YT_HEADERS),
                "source": "piped",
                "piped_api": api_base,
            }
        except Exception as e:  # noqa: BLE001
            errors.append(f"{api_base}: {e}")
            continue

    brief = "; ".join(errors[:3])
    raise ValueError(f"Piped 实例均不可用（{brief}）")


def embed_piped(video_id: str) -> dict[str, Any]:
    """Piped 官方嵌入页（比 youtube.com/embed 更易在受限网络访问）。"""
    return {
        "mode": "embed",
        "stream_type": "embed",
        "provider": "piped",
        "video_id": video_id,
        "embed_url": f"https://piped.video/embed/{video_id}",
        "source": "piped",
    }
