"""各平台官方嵌入页兜底（无需用户登录 / Cookie）。

直链解析失败时，使用平台官方 iframe 或开源前端（Piped 等），不引导用户导出 Cookie。
"""
from __future__ import annotations

import re
from typing import Any

import requests

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_FALLBACK_HINT = "直链解析不可用，已切换官方嵌入页"


def _embed(
    provider: str,
    embed_url: str,
    page_url: str,
    *,
    source: str,
    reason: str = "",
    **extra: Any,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "mode": "embed",
        "stream_type": "embed",
        "provider": provider,
        "embed_url": embed_url,
        "page_url": page_url,
        "source": source,
        **extra,
    }
    if reason:
        out["fallback_reason"] = reason
    return out


# ── X / Twitter（官方 syndication 嵌入）────────────────────────────────────

def embed_x(tweet_id: str, page_url: str, *, reason: str = "") -> dict[str, Any]:
    return _embed(
        "x",
        f"https://platform.twitter.com/embed/Tweet.html?id={tweet_id}&hide_thread=1",
        page_url,
        source="x-embed",
        video_id=tweet_id,
        reason=reason or _FALLBACK_HINT,
    )


# ── 微博（tv/show 页 iframe）──────────────────────────────────────────────

def embed_weibo(page_url: str, *, reason: str = "") -> dict[str, Any]:
    return _embed(
        "weibo",
        page_url,
        page_url,
        source="weibo-embed",
        reason=reason or _FALLBACK_HINT,
    )


# ── 优酷官方播放器 ────────────────────────────────────────────────────────

_YOUKU_ID_RE = re.compile(r"id_([^/?#]+)", re.I)


def extract_youku_id(url: str) -> str | None:
    m = _YOUKU_ID_RE.search(url or "")
    return m.group(1) if m else None


def embed_youku(video_id: str, page_url: str, *, reason: str = "") -> dict[str, Any]:
    return _embed(
        "youku",
        f"https://player.youku.com/embed/{video_id}",
        page_url,
        source="youku-embed",
        video_id=video_id,
        reason=reason or _FALLBACK_HINT,
    )


# ── 爱奇艺 iframe ─────────────────────────────────────────────────────────

_IQIYI_VID_RE = re.compile(r"/v_([^.?#/]+)", re.I)


def extract_iqiyi_vid(url: str) -> str | None:
    m = _IQIYI_VID_RE.search(url or "")
    return m.group(1) if m else None


def embed_iqiyi(vid: str, page_url: str, *, reason: str = "") -> dict[str, Any]:
    return _embed(
        "iqiyi",
        f"https://www.iqiyi.com/iframe/{vid}.html",
        page_url,
        source="iqiyi-embed",
        video_id=vid,
        reason=reason or _FALLBACK_HINT,
    )


# ── Twitch 官方嵌入（parent 由前端填入当前域名）────────────────────────────

_TWITCH_VIDEO_RE = re.compile(r"twitch\.tv/videos/(\d+)", re.I)
_TWITCH_CLIP_RE = re.compile(r"clips\.twitch\.tv/([^/?#]+)", re.I)
_TWITCH_CLIP_ALT_RE = re.compile(r"twitch\.tv/\w+/clip/([^/?#]+)", re.I)


def extract_twitch_target(url: str) -> tuple[str, str] | None:
    low = (url or "").lower()
    for pat, kind in (
        (_TWITCH_VIDEO_RE, "video"),
        (_TWITCH_CLIP_RE, "clip"),
        (_TWITCH_CLIP_ALT_RE, "clip"),
    ):
        m = pat.search(low)
        if m:
            return kind, m.group(1)
    return None


def embed_twitch(kind: str, target_id: str, page_url: str, *, reason: str = "") -> dict[str, Any]:
    if kind == "clip":
        embed_url = (
            f"https://clips.twitch.tv/embed?clip={target_id}"
            f"&parent={{parent}}&autoplay=false"
        )
    else:
        embed_url = (
            f"https://player.twitch.tv/?video=v{target_id}"
            f"&parent={{parent}}&autoplay=false"
        )
    return _embed(
        "twitch",
        embed_url,
        page_url,
        source="twitch-embed",
        video_id=target_id,
        twitch_kind=kind,
        embed_parent_required=True,
        reason=reason or _FALLBACK_HINT,
    )


# ── Facebook 官方 video 插件 ───────────────────────────────────────────────

def embed_facebook(page_url: str, *, reason: str = "") -> dict[str, Any]:
    from urllib.parse import quote

    href = quote(page_url, safe="")
    return _embed(
        "facebook",
        f"https://www.facebook.com/plugins/video.php?href={href}&show_text=0&width=560",
        page_url,
        source="facebook-embed",
        reason=reason or _FALLBACK_HINT,
    )


# ── B 站：公开 API 取 cid 后嵌入（无需登录）──────────────────────────────

def embed_bilibili_bvid(bvid: str, page_url: str, *, reason: str = "") -> dict[str, Any]:
    cid = None
    try:
        r = requests.get(
            "https://api.bilibili.com/x/web-interface/view",
            params={"bvid": bvid},
            timeout=12,
            headers={"User-Agent": _UA, "Referer": "https://www.bilibili.com/"},
            proxies={"http": None, "https": None},
        )
        data = (r.json() or {}).get("data") or {}
        pages = data.get("pages") or []
        if pages:
            cid = pages[0].get("cid")
    except Exception:
        pass
    q = f"isOutside=true&autoplay=0&bvid={bvid}"
    if cid:
        q += f"&cid={cid}"
    return _embed(
        "bilibili",
        f"https://player.bilibili.com/player.html?{q}",
        page_url,
        source="bilibili-embed",
        bvid=bvid,
        cid=cid,
        reason=reason or _FALLBACK_HINT,
    )


def is_youku_url(url: str) -> bool:
    return "youku.com" in (url or "").lower()


def is_twitch_url(url: str) -> bool:
    low = (url or "").lower()
    return "twitch.tv" in low or "clips.twitch.tv" in low


def is_facebook_url(url: str) -> bool:
    low = (url or "").lower()
    return "facebook.com" in low or "fb.watch" in low or "fb.com" in low
