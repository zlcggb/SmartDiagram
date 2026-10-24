"""微博视频解析：yt-dlp 提取 + CDN 直链（与 downloader 共用同一提取器）。

微博无独立 play API；公开视频通过 yt-dlp Weibo/WeiboVideo 拿 f.video.weibocdn.com 直链。
"""
from __future__ import annotations

from yt_dlp import YoutubeDL

from url_normalize import is_weibo_url, normalize_url

DOWNLOAD_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://weibo.com/",
}


def _pick_video_url(info: dict) -> str | None:
    direct = info.get("url")
    if direct:
        return direct
    formats = info.get("formats") or []
    for f in reversed(formats):
        if f.get("url") and f.get("vcodec") not in (None, "none"):
            return f["url"]
    for f in reversed(formats):
        if f.get("url"):
            return f["url"]
    return None


def extract_weibo(url: str, browser: str | None = None) -> dict:
    """解析微博视频，返回 CDN 直链（供下载 / AI 转写复用）。"""
    from downloader import (
        _apply_cookies,
        _apply_http_headers,
        _apply_proxy_opts,
        _first_entry,
        _recover,
    )

    url = normalize_url(url)

    def _extract(use_browser: str | None, clients: list | None = None) -> dict:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            "socket_timeout": 30,
        }
        _apply_http_headers(opts, url)
        _apply_proxy_opts(opts, url)
        _apply_cookies(opts, use_browser)
        with YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False)

    try:
        try:
            info = _extract(browser)
        except TypeError as e:
            raise ValueError(
                "微博视频不可用（可能已删除、仅文字微博或链接失效）。"
                "请换用含视频的博文链接（weibo.com/用户ID/博文ID）后重试。"
            ) from e
        except Exception as e:  # noqa: BLE001
            info = _recover(_extract, browser, e)
    except TypeError as e:
        raise ValueError(
            "微博视频不可用（可能已删除、仅文字微博或链接失效）。"
            "请换用含视频的博文链接后重试。"
        ) from e

    info = _first_entry(info)
    video_url = _pick_video_url(info)
    if not video_url:
        raise ValueError("该微博不含可下载视频（可能仅为图片或文字）。")

    return {
        "title": (info.get("title") or "").strip() or "微博视频",
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader") or info.get("channel"),
        "video_url": video_url,
        "webpage_url": info.get("webpage_url") or url,
    }


__all__ = ["DOWNLOAD_HEADERS", "extract_weibo", "is_weibo_url"]
