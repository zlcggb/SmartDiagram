"""解析可播放媒体源（直链 / 代理 / 嵌入）。"""
from __future__ import annotations

import glob
import mimetypes
import os
import re
import secrets
from typing import Any

import requests

from bilibili import extract_bilibili, extract_bvid, is_bilibili_url, parse_bilibili_qn
from douyin import extract_douyin, is_douyin_url
from downloader import (
    BILIBILI_HEADERS,
    DOUYIN_HEADERS,
    DOWNLOAD_DIR,
    FFMPEG_LOCATION,
    _TIKTOK_YTDLP_FORMAT,
    _apply_http_headers,
    _apply_js_runtime,
    _apply_player_clients,
    _apply_pot_provider,
    _apply_proxy_opts,
    _first_entry,
    _recover,
    get_video_info,
    is_weibo_url,
)
from embed_playback import (
    embed_bilibili_bvid,
    embed_facebook,
    embed_iqiyi,
    embed_twitch,
    embed_weibo,
    embed_x,
    embed_youku,
    extract_iqiyi_vid,
    extract_twitch_target,
    extract_youku_id,
    is_facebook_url,
    is_twitch_url,
    is_youku_url,
)
from media_proxy import PROXY_TTL_SECONDS, create_proxy_token
from playback_cache import PLAYBACK_CACHE_TTL_SECONDS, create_playback_cache
from piped_streams import fetch_piped_playback
from platform_cookies import get_anonymous_cookie_file, netscape_cookie_header
from proxy_config import get_overseas_proxy
from tiktok_playback import embed_tiktok, extract_tiktok_video_id, resolve_tiktok_page_url
from url_normalize import is_tiktok_url, normalize_url
from upload_store import get_upload
from video_normalize import ensure_h264_mp4
from weibo import extract_weibo
from iqiyi import extract_iqiyi, is_iqiyi_url, pick_iqiyi_stream
from x_twmd import (
    DOWNLOAD_HEADERS as X_HEADERS,
    canonical_x_url,
    extract_tweet_id,
    extract_x_public,
    is_x_url,
)
from xiaohongshu import extract_xiaohongshu, is_xhs_url
from yt_dlp import YoutubeDL

_YT_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{6,})"
)

_YT_CDN_HEADERS = {
    "Referer": "https://www.youtube.com/",
    "Origin": "https://www.youtube.com",
}

# YouTube 播放：优先 itag 18/22 等 muxed MP4，其次任意 best
_YT_PLAYBACK_FORMAT = (
    "18/22/"
    "b[ext=mp4][acodec!=none][vcodec!=none]/"
    "b[ext=mp4]/"
    "b[acodec!=none][vcodec!=none]/"
    "b"
)

_PLAYBACK_FORMAT = (
    "b[ext=mp4][acodec!=none][vcodec!=none]/"
    "b[ext=mp4]/"
    "b[acodec!=none][vcodec!=none]/"
    "b"
)

_TIKTOK_PLAYBACK_FORMAT = (
    "b[ext=mp4][vcodec^=avc1]/"
    "b[ext=mp4][vcodec^=avc]/"
    "b[ext=mp4]/"
    "b"
)

# 保留常量供测试引用；TikTok 播放已与下载共用 _TIKTOK_YTDLP_FORMAT

_EMBED_FALLBACK = "直链解析不可用，已切换官方嵌入页"


def _apply_service_cookies(opts: dict) -> None:
    """播放用服务端 Cookie 池（与下载匿名链路一致，不要求用户登录）。"""
    from downloader import _resolve_cookies_file

    cookies_file = _resolve_cookies_file()
    if cookies_file:
        opts["cookiefile"] = cookies_file
        return
    anon = get_anonymous_cookie_file()
    if anon:
        opts["cookiefile"] = anon


_HEVC_VCODEC_MARKERS = frozenset({"hevc", "h265", "hev1", "hvc1", "bytevc1"})


def _tiktok_proxy_headers(headers: dict[str, str] | None) -> dict[str, str]:
    hdrs = dict(headers or {})
    cookie = netscape_cookie_header()
    if cookie:
        hdrs["Cookie"] = cookie
    return hdrs


def _vcodec_from_info(info: dict) -> str:
    for key in ("vcodec",):
        v = (info.get(key) or "").lower()
        if v and v != "none":
            return v
    req = info.get("requested_formats")
    if isinstance(req, list):
        for f in req:
            v = (f.get("vcodec") or "").lower()
            if v and v != "none":
                return v
    for f in reversed(info.get("formats") or []):
        if f.get("acodec") not in (None, "none") and f.get("vcodec") not in (None, "none"):
            return (f.get("vcodec") or "").lower()
    return ""


def _is_hevc_vcodec(vcodec: str) -> bool:
    low = (vcodec or "").lower()
    return any(m in low for m in _HEVC_VCODEC_MARKERS)


def _probe_tiktok_upstream(url: str, headers: dict[str, str]) -> bool:
    """探测 TikTok CDN 是否可通过代理拉流（无 Cookie 时常 403）。"""
    proxies = None
    proxy = get_overseas_proxy()
    if proxy:
        proxies = {"http": proxy, "https": proxy}
    try:
        resp = requests.get(
            url,
            headers=headers,
            stream=True,
            timeout=20,
            proxies=proxies,
            allow_redirects=True,
        )
    except requests.RequestException:
        return False
    try:
        if resp.status_code not in (200, 206):
            return False
        ct = (resp.headers.get("Content-Type") or "").lower()
        if "video" in ct or "octet-stream" in ct:
            chunk = resp.raw.read(12)
            return bool(chunk) and chunk[4:8] == b"ftyp"
        return False
    finally:
        resp.close()


def _download_tiktok_playback_file(page_url: str, work_id: str) -> str:
    prefix = f"play_{work_id}"
    outtmpl = os.path.join(DOWNLOAD_DIR, f"{prefix}.%(ext)s")
    opts: dict = {
        "format": _TIKTOK_YTDLP_FORMAT,
        "outtmpl": outtmpl,
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 60,
    }
    if FFMPEG_LOCATION:
        opts["ffmpeg_location"] = FFMPEG_LOCATION
    _apply_pot_provider(opts)
    _apply_js_runtime(opts)
    _apply_http_headers(opts, page_url)
    _apply_proxy_opts(opts, page_url)
    _apply_service_cookies(opts)

    def _run(clients: list | None = None) -> dict:
        o = dict(opts)
        _apply_player_clients(o, clients)
        with YoutubeDL(o) as ydl:
            return ydl.extract_info(page_url, download=True)

    try:
        _run()
    except Exception as e:  # noqa: BLE001
        _recover(_run, None, e)
    matches = glob.glob(os.path.join(DOWNLOAD_DIR, f"{prefix}.*"))
    if not matches:
        raise ValueError("TikTok 视频下载失败，无法准备播放")
    matches.sort(key=lambda p: (not p.lower().endswith(".mp4"), len(p)))
    return matches[0]


def _tiktok_h264_cached_playback(page_url: str) -> dict[str, Any]:
    """下载 + H.264 转码后同源缓存播放（解决 CDN 403 与浏览器不支持 HEVC）。"""
    work_id = secrets.token_urlsafe(8)
    raw_path = _download_tiktok_playback_file(page_url, work_id)
    play_path = raw_path
    try:
        play_path = ensure_h264_mp4(raw_path)
        token = create_playback_cache(play_path)
        return {
            "mode": "video",
            "stream_type": "progressive",
            "src": f"/api/media/cache/{token}",
            "mime": "video/mp4",
            "expires_in": PLAYBACK_CACHE_TTL_SECONDS,
            "source": "tiktok-h264",
        }
    finally:
        if raw_path != play_path and os.path.isfile(raw_path):
            try:
                os.remove(raw_path)
            except OSError:
                pass


def _guess_mime(path: str) -> str:
    mime, _ = mimetypes.guess_type(path)
    if mime and mime.startswith(("video/", "audio/")):
        return mime
    ext = os.path.splitext(path)[1].lower()
    if ext in {".mp3", ".m4a", ".wav", ".flac", ".aac"}:
        return "audio/mpeg" if ext == ".mp3" else f"audio/{ext.lstrip('.')}"
    return "video/mp4"


def _detect_stream_type(url: str) -> str:
    low = (url or "").lower()
    if "m3u8" in low or "hls_playlist" in low or "manifest.googlevideo" in low:
        return "hls"
    return "progressive"


def _merge_headers(base: dict | None, extra: dict | None) -> dict[str, str]:
    out = dict(extra or {})
    for k, v in (base or {}).items():
        out.setdefault(k, v)
    return out


def _proxy_playback_src(
    url: str,
    headers: dict[str, str] | None,
    stream_type: str,
    *,
    source: str = "proxy",
    source_url: str | None = None,
) -> dict[str, Any]:
    hdrs = dict(headers or {})
    if "googlevideo.com" in url or "youtube.com" in url:
        hdrs = _merge_headers(hdrs, _YT_CDN_HEADERS)
    token = create_proxy_token(url, hdrs, source_url=source_url)
    mime = (
        "application/vnd.apple.mpegurl"
        if stream_type == "hls"
        else "video/mp4"
    )
    return {
        "mode": "video",
        "stream_type": stream_type,
        "src": f"/api/media/proxy/{token}",
        "mime": mime,
        "expires_in": PROXY_TTL_SECONDS,
        "source": source,
    }


def _with_orientation(payload: dict[str, Any], *, portrait: bool = False) -> dict[str, Any]:
    if portrait:
        payload["orientation"] = "portrait"
    return payload


def _youtube_id(url: str) -> str | None:
    m = _YT_ID_RE.search(url or "")
    return m.group(1) if m else None


def _embed_youtube(url: str, *, reason: str = "") -> dict[str, Any]:
    vid = _youtube_id(url)
    if not vid:
        raise ValueError("无法识别 YouTube 视频 ID")
    out: dict[str, Any] = {
        "mode": "embed",
        "stream_type": "embed",
        "provider": "youtube",
        "video_id": vid,
        "page_url": url,
    }
    if reason:
        out["fallback_reason"] = reason
    return out


def _embed_bilibili(d: dict) -> dict[str, Any]:
    return {
        "mode": "embed",
        "stream_type": "embed",
        "provider": "bilibili",
        "bvid": d.get("bvid"),
        "cid": d.get("cid"),
        "page_url": d.get("webpage_url"),
    }


def _playback_from_info(info: dict) -> tuple[str, dict[str, str], str]:
    url = info.get("url")
    if url:
        return url, dict(info.get("http_headers") or {}), _detect_stream_type(url)

    req = info.get("requested_formats")
    if isinstance(req, list) and len(req) == 1 and req[0].get("url"):
        f = req[0]
        u = f["url"]
        return u, dict(f.get("http_headers") or {}), _detect_stream_type(u)

    formats = info.get("formats") or []
    muxed = [
        f
        for f in formats
        if f.get("url")
        and f.get("vcodec") not in (None, "none")
        and f.get("acodec") not in (None, "none")
    ]
    if not muxed:
        muxed = [f for f in formats if f.get("url")]
    if not muxed:
        raise ValueError("无法取得可播放地址")
    best = max(muxed, key=lambda f: (f.get("height") or 0, f.get("tbr") or 0))
    u = best["url"]
    return u, dict(best.get("http_headers") or {}), _detect_stream_type(u)


def _extract_playback_info(
    url: str,
    *,
    youtube: bool = False,
    tiktok: bool = False,
    browser: str | None = None,
) -> dict:
    """播放专用 yt-dlp 提取；YouTube 等可走 browser Cookie + PO Token。"""
    if youtube:
        fmt = _YT_PLAYBACK_FORMAT
    elif tiktok:
        fmt = _TIKTOK_YTDLP_FORMAT
    else:
        fmt = _PLAYBACK_FORMAT

    variant = "tiktok" if tiktok else ("youtube" if youtube else "default")
    use_browser = None if tiktok else browser

    def _run() -> dict:
        def _extract(use_browser: str | None = None, clients: list | None = None) -> dict:
            opts: dict = {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "noplaylist": True,
                "socket_timeout": 30,
                "format": fmt,
            }
            _apply_pot_provider(opts)
            _apply_player_clients(opts, clients)
            _apply_js_runtime(opts)
            _apply_http_headers(opts, url)
            _apply_proxy_opts(opts, url)
            if tiktok:
                _apply_service_cookies(opts)
            else:
                from downloader import _apply_cookies

                _apply_cookies(opts, use_browser)
            with YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=False)

        try:
            info = _extract(use_browser)
        except Exception as e:  # noqa: BLE001
            info = _recover(_extract, use_browser, e)
        return _first_entry(info)

    from ytdlp_cache import cached_extract

    return cached_extract(url, use_browser, _run, variant=variant)


def _ytdlp_playback_url(
    url: str,
    *,
    youtube: bool = False,
    tiktok: bool = False,
    browser: str | None = None,
) -> tuple[str, dict[str, str], str]:
    info = _extract_playback_info(
        url, youtube=youtube, tiktok=tiktok, browser=browser
    )
    return _playback_from_info(info)


def _resolve_bilibili_playback(url: str, format_id: str | None) -> dict[str, Any]:
    try:
        d = extract_bilibili(url, qn=parse_bilibili_qn(format_id), browser=None)
        if d.get("audio_url"):
            return _embed_bilibili(d)
        if d.get("video_url"):
            return _proxy_playback_src(
                d["video_url"], BILIBILI_HEADERS, "progressive", source="bilibili"
            )
        raise ValueError("B 站未返回可播放地址")
    except Exception:
        bvid = extract_bvid(url)
        if bvid:
            return embed_bilibili_bvid(bvid, url, reason=_EMBED_FALLBACK)
        raise


def _resolve_x_playback(url: str) -> dict[str, Any]:
    page_url = canonical_x_url(url)
    meta = extract_x_public(url)
    if meta and meta.get("video_url"):
        return _proxy_playback_src(
            meta["video_url"], X_HEADERS, "progressive", source="x"
        )
    tid = extract_tweet_id(url)
    if tid:
        return embed_x(tid, page_url, reason=_EMBED_FALLBACK)
    raise ValueError("无法识别 X/Twitter 推文链接（需要含 /status/数字）。")


def _resolve_weibo_playback(url: str) -> dict[str, Any]:
    try:
        d = extract_weibo(url, browser=None)
        if d.get("video_url"):
            return _proxy_playback_src(d["video_url"], {}, "progressive", source="weibo")
        raise ValueError("微博未返回播放地址")
    except Exception:
        return embed_weibo(url, reason=_EMBED_FALLBACK)


def _resolve_iqiyi_playback(url: str, format_id: str | None) -> dict[str, Any]:
    try:
        d = extract_iqiyi(url, browser=None)
        stream = pick_iqiyi_stream(d, format_id)
        st = (
            "hls"
            if "m3u8" in stream.lower() or stream.strip().startswith("#EXTM3U")
            else "progressive"
        )
        return _proxy_playback_src(stream, {}, st, source="iqiyi")
    except Exception:
        vid = extract_iqiyi_vid(url)
        if vid:
            return embed_iqiyi(vid, url, reason=_EMBED_FALLBACK)
        raise


def _resolve_youku_playback(url: str) -> dict[str, Any]:
    try:
        direct, headers, stream_type = _ytdlp_playback_url(url)
        return _proxy_playback_src(direct, headers, stream_type, source="yt-dlp")
    except Exception:
        yid = extract_youku_id(url)
        if yid:
            return embed_youku(yid, url, reason=_EMBED_FALLBACK)
        raise


def _resolve_twitch_playback(url: str) -> dict[str, Any]:
    try:
        direct, headers, stream_type = _ytdlp_playback_url(url)
        return _proxy_playback_src(direct, headers, stream_type, source="yt-dlp")
    except Exception:
        target = extract_twitch_target(url)
        if target:
            kind, tid = target
            return embed_twitch(kind, tid, url, reason=_EMBED_FALLBACK)
        raise


def _resolve_facebook_playback(url: str) -> dict[str, Any]:
    try:
        direct, headers, stream_type = _ytdlp_playback_url(url)
        return _proxy_playback_src(direct, headers, stream_type, source="yt-dlp")
    except Exception:
        return embed_facebook(url, reason=_EMBED_FALLBACK)


def _resolve_xhs_playback(url: str) -> dict[str, Any]:
    try:
        d = extract_xiaohongshu(url, browser=None)
        if d.get("video_url"):
            return _proxy_playback_src(d["video_url"], {}, "progressive", source="xhs")
        raise ValueError("小红书未返回播放地址")
    except Exception as e:
        msg = str(e)
        if "xsec_token" in msg:
            raise ValueError(
                "小红书链接不完整。请用 App「分享」复制完整链接（含 xsec_token），"
                "无需登录账号。"
            ) from e
        raise


def _resolve_tiktok_playback(url: str) -> dict[str, Any]:
    """TikTok：直链代理（带 Cookie）→ H.264 缓存 → 官方 embed。"""
    page_url = resolve_tiktok_page_url(url)
    vid = extract_tiktok_video_id(page_url)
    if not vid:
        raise ValueError(
            "无法识别 TikTok 视频 ID。请粘贴含 /video/数字 的完整链接，"
            "或从 App 分享后复制短链再试。"
        )

    try:
        info = _extract_playback_info(page_url, tiktok=True)
        direct, headers, stream_type = _playback_from_info(info)
        headers = _tiktok_proxy_headers(headers)
        vcodec = _vcodec_from_info(info)
        upstream_ok = _probe_tiktok_upstream(direct, headers)

        if _is_hevc_vcodec(vcodec) or not upstream_ok:
            return _with_orientation(
                _tiktok_h264_cached_playback(page_url),
                portrait=True,
            )

        return _with_orientation(
            _proxy_playback_src(direct, headers, stream_type, source="yt-dlp"),
            portrait=True,
        )
    except Exception:
        return embed_tiktok(
            vid,
            page_url,
            reason="直链解析受限（常见于代理 IP 被 TikTok 封禁），已切换 TikTok 官方嵌入页",
        )


def _resolve_youtube_playback(
    url: str, format_id: str | None, browser: str | None = None
) -> dict[str, Any]:
    """YouTube：yt-dlp 直链 → Piped API → 官方嵌入（不用 piped.video 嵌入，国内常打不开）。"""
    _ = format_id
    vid = _youtube_id(url)
    if not vid:
        raise ValueError("无法识别 YouTube 视频 ID")

    try:
        direct, headers, stream_type = _ytdlp_playback_url(
            url, youtube=True, browser=browser
        )
        return _proxy_playback_src(direct, headers, stream_type, source="yt-dlp")
    except Exception:
        pass

    try:
        piped = fetch_piped_playback(vid)
        return _proxy_playback_src(
            piped["stream_url"],
            piped.get("headers"),
            piped["stream_type"],
            source="piped",
        )
    except Exception:
        pass

    return _embed_youtube(url)


def resolve_upload_playback(file_id: str) -> dict[str, Any]:
    meta = get_upload(file_id)
    if meta:
        path = meta.get("path")
        if path and os.path.isfile(path):
            return {
                "mode": "video",
                "stream_type": "progressive",
                "src": f"/api/media/upload/{file_id}",
                "mime": _guess_mime(path),
                "expires_in": max(0, int(meta.get("expires_at", 0) - __import__("time").time())),
                "source": "upload",
            }

    # 上传临时文件不存在或已失效：回落到 PostgreSQL 归档视频表
    try:
        from repo import get_video
        from media_token import sign_playback_token
        video = get_video(str(file_id))
        if video:
            status = video.get("storage_status")
            if status == "ready" and video.get("storage_path"):
                storage_path = video["storage_path"]
                if os.path.isfile(storage_path):
                    token = sign_playback_token(str(video["id"]), ttl_seconds=7200)
                    is_audio = storage_path.endswith(".m4a")
                    return {
                        "mode": "audio" if is_audio else "video",
                        "stream_type": "progressive",
                        "src": f"/api/videos/{video['id']}/stream?token={token}",
                        "mime": "audio/mp4" if is_audio else "video/mp4",
                        "expires_in": 7200,
                        "source": "archive",
                    }
            elif status in ("pending", "transcoding"):
                raise ValueError("视频正在后台压缩转码中，转码完成后即可回看播放")
            else:
                raise ValueError("该视频未保留本地源文件（已仅留存 AI 认知研报与测验）")
    except ValueError:
        raise
    except Exception:
        pass

    raise ValueError("上传文件不存在或已过期，请重新上传")


def _resolve_url_playback_inner(
    url: str,
    format_id: str | None = None,
    browser: str | None = None,
) -> dict[str, Any]:
    if _youtube_id(url):
        return _resolve_youtube_playback(url, format_id, browser=browser)

    if is_bilibili_url(url):
        return _resolve_bilibili_playback(url, format_id)

    if is_tiktok_url(url):
        return _resolve_tiktok_playback(url)

    if is_douyin_url(url):
        d = extract_douyin(url)
        play_url = d.get("play_url")
        if not play_url:
            raise ValueError("抖音未返回播放地址")
        return _with_orientation(
            _proxy_playback_src(
                play_url,
                DOUYIN_HEADERS,
                "progressive",
                source="douyin",
                source_url=url,
            ),
            portrait=True,
        )

    if is_weibo_url(url):
        return _resolve_weibo_playback(url)

    if is_x_url(url):
        return _resolve_x_playback(url)

    if is_xhs_url(url):
        return _resolve_xhs_playback(url)

    if is_iqiyi_url(url):
        return _resolve_iqiyi_playback(url, format_id)

    if is_youku_url(url):
        return _resolve_youku_playback(url)

    if is_twitch_url(url):
        return _resolve_twitch_playback(url)

    if is_facebook_url(url):
        return _resolve_facebook_playback(url)

    try:
        direct, headers, stream_type = _ytdlp_playback_url(url, browser=browser)
        return _proxy_playback_src(direct, headers, stream_type, source="yt-dlp", source_url=url)
    except Exception:
        page = url
        try:
            info = get_video_info(url, browser=browser)
            page = info.get("webpage_url") or url
        except Exception:
            pass
        if _youtube_id(page):
            return _resolve_youtube_playback(page, format_id, browser=browser)
        raise


def resolve_url_playback(
    url: str,
    format_id: str | None = None,
    browser: str | None = None,
) -> dict[str, Any]:
    url = normalize_url((url or "").strip())
    if not url:
        raise ValueError("URL 不能为空")
    res = _resolve_url_playback_inner(url, format_id=format_id, browser=browser)
    src = str(res.get("src") or "")
    if src.startswith("/api/media/proxy/"):
        token = src.rsplit("/", 1)[-1]
        entry = __import__("media_proxy").get_proxy_entry(token)
        if entry and not entry.get("source_url"):
            from media_proxy import _entries, _lock, _save_disk_locked

            with _lock:
                if token in _entries:
                    _entries[token]["source_url"] = url
                    _save_disk_locked()
    return res
