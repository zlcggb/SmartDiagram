"""小红书解析：服务端 activate 匿名 Cookie + feed API（ReaJason 思路），XHS-Downloader 兜底。"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from platform_cookies import prepare_session_cookies

from xhs_session import (
    cookie_header,
    create_anonymous_session,
    fetch_note_card,
    parse_xhs_url,
    video_url_from_note,
)

_BACKEND_DIR = Path(__file__).resolve().parent
for _cand_vendor in (
    _BACKEND_DIR / "vendor" / "XHS-Downloader",
    _BACKEND_DIR.parent / "vendor" / "XHS-Downloader",
):
    if _cand_vendor.is_dir() and str(_cand_vendor) not in sys.path:
        sys.path.insert(0, str(_cand_vendor))

DOWNLOAD_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.xiaohongshu.com/",
}

_XHS_HOSTS = ("xiaohongshu.com", "xhslink.com", "rednote.com")


def is_xhs_url(url: str) -> bool:
    low = (url or "").lower()
    return any(h in low for h in _XHS_HOSTS)


def _user_cookie_header(browser: str | None = None) -> str | None:
    import requests

    session = requests.Session()
    session.trust_env = False
    prepare_session_cookies(session, browser)
    parts = [
        f"{c.name}={c.value}"
        for c in session.cookies
        if "xiaohongshu" in (c.domain or "") or "rednote" in (c.domain or "")
    ]
    return "; ".join(parts) if parts else None


def _pick_video_url(download_addrs) -> str | None:
    if not download_addrs:
        return None
    if isinstance(download_addrs, str):
        urls = [u for u in download_addrs.split() if u.startswith("http")]
        return urls[0] if urls else None
    if isinstance(download_addrs, (list, tuple)):
        for item in download_addrs:
            if isinstance(item, str) and item.startswith("http"):
                return item
    return None


def _extract_via_api(url: str, browser: str | None = None) -> dict:
    note_id, xsec_token, xsec_source = parse_xhs_url(url)
    if not xsec_token:
        raise ValueError("链接缺少 xsec_token，请用 App/网页「分享」复制完整链接。")
    extra = _user_cookie_header(browser)
    session = create_anonymous_session(extra_cookie=extra)
    note = fetch_note_card(session, note_id, xsec_token, xsec_source)
    if (note.get("type") or "").lower() not in ("video",):
        raise ValueError(f"该笔记为「{note.get('type') or '非视频'}」，当前仅支持视频。")
    video_url = video_url_from_note(note)
    if not video_url:
        raise ValueError("小红书 API 未返回视频地址。")
    user = note.get("user") or {}
    cover = note.get("cover") or {}
    thumb = cover.get("url_default") or cover.get("url")
    return {
        "note_id": note_id,
        "title": note.get("title") or note.get("desc") or "小红书视频",
        "thumbnail": thumb,
        "video_url": video_url,
        "webpage_url": url,
        "uploader": user.get("nickname") or user.get("nick_name"),
    }


async def _extract_via_xhs_downloader(url: str, cookie: str) -> dict:
    from source import XHS  # type: ignore[import-not-found]

    async with XHS(
        download_record=False,
        record_data=False,
        video_download=False,
        image_download=False,
        cookie=cookie,
        timeout=15,
        max_retry=2,
    ) as xhs:
        rows = await xhs.extract(url, download=False)
    if not rows or not (rows[0] or {}).get("作品ID"):
        raise ValueError("XHS-Downloader 未返回数据")
    item = rows[0]
    if item.get("作品类型") != "视频":
        raise ValueError(f"该笔记为「{item.get('作品类型') or '非视频'}」。")
    video_url = _pick_video_url(item.get("下载地址"))
    if not video_url:
        raise ValueError("XHS-Downloader 未返回视频地址")
    return {
        "note_id": item.get("作品ID"),
        "title": item.get("作品标题") or item.get("作品描述") or "小红书视频",
        "thumbnail": item.get("作品封面"),
        "video_url": video_url,
        "webpage_url": url,
        "uploader": item.get("作者昵称"),
    }


_XHS_CACHE: dict[str, tuple[float, dict]] = {}
_XHS_CACHE_TTL = 300.0


def extract_xiaohongshu(url: str, browser: str | None = None) -> dict:
    """解析小红书视频笔记（带 5 分钟 TTL 内存缓存）。"""
    import time
    cache_key = f"{url}::{browser or ''}"
    cached = _XHS_CACHE.get(cache_key)
    if cached and (time.monotonic() - cached[0]) < _XHS_CACHE_TTL:
        return dict(cached[1])
    try:
        info = _extract_via_api(url, browser=browser)
        _XHS_CACHE[cache_key] = (time.monotonic(), info)
        return dict(info)
    except Exception as api_err:
        try:
            session = create_anonymous_session(_user_cookie_header(browser))
            cookie = cookie_header(session)
            info = asyncio.run(_extract_via_xhs_downloader(url, cookie))
            _XHS_CACHE[cache_key] = (time.monotonic(), info)
            return dict(info)
        except Exception:
            raise api_err from None


def resolve_xhs_share_url(url: str, browser: str | None = None) -> str:
    """xhslink 短链跟跳（保留 query）。"""
    low = url.lower()
    if "xhslink.com" not in low:
        return url
    import requests

    session = requests.Session()
    session.trust_env = False
    extra = _user_cookie_header(browser)
    if extra:
        for part in extra.split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                session.cookies.set(k, v, domain=".xiaohongshu.com")
    resp = session.get(
        url,
        headers=DOWNLOAD_HEADERS,
        timeout=15,
        allow_redirects=True,
        proxies={"http": None, "https": None},
    )
    final = resp.url or url
    qs = parse_qs(urlparse(final).query)
    if "xsec_token" not in qs and "xsec_token" in parse_qs(urlparse(url).query):
        token = parse_qs(urlparse(url).query)["xsec_token"][0]
        sep = "&" if "?" in final else "?"
        final = f"{final}{sep}xsec_token={token}"
    return final
