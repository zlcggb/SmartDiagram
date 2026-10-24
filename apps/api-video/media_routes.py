"""工作台内播放：prepare / 上传 Range / 代理 Range。"""
from __future__ import annotations

import os
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, model_validator

from downloader import BILIBILI_HEADERS, DOUYIN_HEADERS, classify_error
from douyin import extract_douyin, is_douyin_url
from media_playback import resolve_upload_playback, resolve_url_playback
from media_proxy import (
    get_proxy_entry,
    looks_like_m3u8,
    rewrite_m3u8_playlist,
    update_proxy_entry,
)
from playback_cache import get_playback_cache_path
from proxy_config import get_overseas_proxy
from upload_store import get_upload
from url_normalize import needs_overseas_proxy

router = APIRouter()

_ALLOWED_BROWSERS = {
    "brave",
    "chrome",
    "chromium",
    "edge",
    "firefox",
    "opera",
    "safari",
    "vivaldi",
}


def _normalize_browser(browser: Optional[str]) -> Optional[str]:
    if not browser:
        return None
    b = browser.strip().lower()
    if b not in _ALLOWED_BROWSERS:
        raise HTTPException(status_code=400, detail=f"不支持的浏览器：{browser}")
    return b


class MediaPrepareRequest(BaseModel):
    url: Optional[str] = None
    file_id: Optional[str] = None
    format_id: Optional[str] = None
    browser: Optional[str] = None

    @model_validator(mode="after")
    def _url_or_file(self):
        has_url = bool((self.url or "").strip())
        has_file = bool((self.file_id or "").strip())
        if has_url == has_file:
            raise ValueError("请提供 url 或 file_id 之一（不能同时提供或同时为空）")
        return self


@router.post("/api/media/prepare")
def api_media_prepare(req: MediaPrepareRequest):
    browser = _normalize_browser(req.browser)
    try:
        if req.file_id:
            return resolve_upload_playback(req.file_id.strip())
        return resolve_url_playback(
            req.url or "",
            format_id=req.format_id,
            browser=browser,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        info = classify_error(e)
        raise HTTPException(
            status_code=400,
            detail=info.get("message") or str(e),
        ) from e


@router.get("/api/media/upload/{file_id}")
def api_media_upload(file_id: str):
    meta = get_upload(file_id)
    if not meta:
        raise HTTPException(status_code=404, detail="上传文件不存在或已过期")
    path = meta.get("path")
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="上传文件已失效")
    filename = meta.get("filename") or os.path.basename(path)
    return FileResponse(path, filename=filename, media_type=None)


@router.get("/api/media/cache/{token}")
def api_media_cache(token: str):
    """TikTok 等转码后的短时本地缓存（支持浏览器 Range）。"""
    path = get_playback_cache_path(token)
    if not path:
        raise HTTPException(status_code=404, detail="播放缓存已过期，请刷新页面重试")
    return FileResponse(path, media_type="video/mp4", filename="playback.mp4")


def _refresh_expired_upstream(token: str, entry: dict) -> tuple[str, dict] | None:
    """当上游防盗链/临时 CDN 地址过期（403/410）时，利用原始 source_url 自动刷新直链。"""
    source_url = (entry.get("source_url") or "").strip()
    if not source_url:
        return None
    try:
        if is_douyin_url(source_url):
            d = extract_douyin(source_url, force_refresh=True)
            new_url = d.get("play_url")
            if new_url:
                hdrs = dict(DOUYIN_HEADERS)
                update_proxy_entry(token, new_url, hdrs)
                return new_url, hdrs
        refreshed = resolve_url_playback(source_url)
        new_src = str(refreshed.get("src") or "")
        if new_src.startswith("/api/media/proxy/"):
            new_token = new_src.rsplit("/", 1)[-1]
            new_entry = get_proxy_entry(new_token)
            if new_entry and new_entry.get("url"):
                new_url = new_entry["url"]
                hdrs = dict(new_entry.get("headers") or {})
                update_proxy_entry(token, new_url, hdrs)
                return new_url, hdrs
    except Exception:
        return None
    return None


def _open_upstream_stream(
    upstream_url: str,
    base_headers: dict,
    range_header: str | None,
):
    headers = dict(base_headers or {})
    if range_header:
        headers["Range"] = range_header
    proxies = {"http": None, "https": None}
    if needs_overseas_proxy(upstream_url):
        proxy = get_overseas_proxy()
        proxies = {"http": proxy, "https": proxy} if proxy else None
    return requests.get(
        upstream_url,
        headers=headers,
        stream=True,
        timeout=90,
        allow_redirects=True,
        proxies=proxies,
    )


@router.get("/api/media/proxy/{token}")
def api_media_proxy(token: str, request: Request):
    entry = get_proxy_entry(token)
    if not entry:
        raise HTTPException(status_code=404, detail="播放链接已过期，请刷新页面重试")

    range_header = request.headers.get("range")
    upstream_url = entry["url"]
    base_headers = dict(entry.get("headers") or {})

    upstream = None
    try:
        upstream = _open_upstream_stream(upstream_url, base_headers, range_header)
    except requests.RequestException:
        upstream = None

    if upstream is None or upstream.status_code not in (200, 206):
        if upstream is not None:
            upstream.close()
        refreshed = _refresh_expired_upstream(token, entry)
        if refreshed:
            upstream_url, base_headers = refreshed
            try:
                upstream = _open_upstream_stream(upstream_url, base_headers, range_header)
            except requests.RequestException as e:
                raise HTTPException(status_code=502, detail="无法连接视频源") from e
        else:
            raise HTTPException(status_code=502, detail="视频源返回错误，暂无法播放")

    if upstream.status_code not in (200, 206):
        upstream.close()
        raise HTTPException(status_code=502, detail="视频源返回错误，暂无法播放")

    content_type = upstream.headers.get("Content-Type", "")

    if not range_header:
        first = upstream.raw.read(4096)
        if looks_like_m3u8(upstream_url, content_type, first):
            rest = upstream.raw.read()
            upstream.close()
            text = (first + rest).decode("utf-8", errors="replace")
            rewritten = rewrite_m3u8_playlist(
                text, upstream_url, entry.get("headers")
            )
            return Response(
                content=rewritten,
                media_type="application/vnd.apple.mpegurl",
            )

        passthrough = {"Accept-Ranges": "bytes"}
        for key in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
            val = upstream.headers.get(key)
            if val:
                passthrough[key] = val

        def body_iter_prefixed():
            try:
                if first:
                    yield first
                for chunk in upstream.iter_content(chunk_size=256 * 1024):
                    if chunk:
                        yield chunk
            finally:
                upstream.close()

        return StreamingResponse(
            body_iter_prefixed(),
            status_code=upstream.status_code,
            headers=passthrough,
            media_type=upstream.headers.get("Content-Type", "video/mp4"),
        )

    passthrough = {"Accept-Ranges": "bytes"}
    for key in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
        val = upstream.headers.get(key)
        if val:
            passthrough[key] = val

    def body_iter():
        try:
            for chunk in upstream.iter_content(chunk_size=256 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=passthrough,
        media_type=upstream.headers.get("Content-Type", "video/mp4"),
    )
