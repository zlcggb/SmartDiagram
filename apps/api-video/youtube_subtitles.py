"""YouTube 字幕：零登录优先链（与方案设计 / B+ 稳态一致）。

顺序：
  1. youtube-transcript-api（轻量，带代理）
  2. Piped /streams 字幕（与播放同生态）
  3. 复用 yt-dlp 解析缓存中的字幕 URL
  4. yt-dlp + PO Token 元数据 VTT
  5. （外层 fetch_subtitles 还有 yt-dlp writesubtitles 下载兜底）

浏览器 Cookie 仅在上述均失败时静默尝试，不要求用户勾选登录态。
"""
from __future__ import annotations

import os
import re
import tempfile
import xml.etree.ElementTree as ET

import requests

from downloader import _extract_with_ytdlp
from proxy_config import get_overseas_proxy
from transcript import SUBTITLE_LANGS, parse_subtitle_file

_YT_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{6,})"
)
_YT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.youtube.com/",
}

# 与 transcript.SUBTITLE_LANGS 对齐
_YTA_LANGS = [
    "zh-Hans",
    "zh-CN",
    "zh",
    "zh-Hant",
    "zh-TW",
    "en",
    "en-US",
    "ja",
    "ko",
]


def _safe_remove(path: str) -> None:
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def youtube_video_id(url: str) -> str | None:
    m = _YT_ID_RE.search(url or "")
    return m.group(1) if m else None


def is_youtube_url(url: str) -> bool:
    low = (url or "").lower()
    return "youtube.com" in low or "youtu.be" in low


def _browser_attempts(browser: str | None):
    """免登录优先；browser 仅作静默兜底。"""
    seen: set[str | None] = set()
    for b in (None, browser):
        if b not in seen:
            seen.add(b)
            yield b


def _items_to_segments(fetched) -> list | None:
    segments: list[dict] = []
    try:
        items = list(fetched)
    except TypeError:
        items = fetched
    for item in items:
        if isinstance(item, dict):
            start = float(item.get("start", 0))
            dur = float(item.get("duration", 0) or 0)
            text = (item.get("text") or "").strip()
        else:
            start = float(getattr(item, "start", 0))
            dur = float(getattr(item, "duration", 0) or 0)
            text = (getattr(item, "text", "") or "").strip()
        text = re.sub(r"\s+", " ", text)
        if not text:
            continue
        end = start + max(dur, 0.3)
        if segments and segments[-1]["text"] == text:
            segments[-1]["end"] = end
            continue
        segments.append({"start": start, "end": end, "text": text})
    return segments or None


def _segments_from_transcript_api(video_id: str) -> list | None:
    """开源 youtube-transcript-api：轻量拉字幕，不走 yt-dlp 全量 extract。"""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api.proxies import GenericProxyConfig
    except ImportError:
        return None

    proxy = get_overseas_proxy()
    cfg = GenericProxyConfig(http_url=proxy, https_url=proxy) if proxy else None
    api = YouTubeTranscriptApi(proxy_config=cfg)

    try:
        tl = api.list(video_id)
        for finder in (
            lambda: tl.find_transcript(_YTA_LANGS),
            lambda: tl.find_generated_transcript(_YTA_LANGS),
        ):
            try:
                tr = finder()
                segs = _items_to_segments(tr.fetch())
                if segs:
                    return segs
            except Exception:
                continue
        for tr in tl:
            try:
                segs = _items_to_segments(tr.fetch())
                if segs:
                    return segs
            except Exception:
                continue
    except Exception:
        pass

    try:
        fetched = api.fetch(video_id, languages=_YTA_LANGS)
        return _items_to_segments(fetched)
    except Exception:
        return None


def _piped_lang_score(code: str) -> int:
    c = (code or "").lower().replace("_", "-")
    for i, lang in enumerate(_YTA_LANGS):
        if c == lang.lower() or c.startswith(lang.lower()):
            return i
    return len(_YTA_LANGS) + 10


def _segments_from_piped(video_id: str) -> list | None:
    """Piped /streams 返回的字幕列表（免登录，与播放链路同源）。"""
    from piped_streams import _instance_list

    proxy = get_overseas_proxy()
    proxies = {"http": proxy, "https": proxy} if proxy else None
    errors: list[str] = []

    for api_base in _instance_list():
        try:
            r = requests.get(
                f"{api_base.rstrip('/')}/streams/{video_id}",
                timeout=35,
                proxies=proxies,
                headers={"User-Agent": "VidGrab/1.0"},
            )
            if r.status_code != 200:
                errors.append(f"{api_base}: HTTP {r.status_code}")
                continue
            subs = (r.json() or {}).get("subtitles") or []
            if not subs:
                errors.append(f"{api_base}: no subtitles")
                continue
            subs = sorted(subs, key=lambda s: _piped_lang_score(s.get("code") or ""))
            for sub in subs:
                sub_url = sub.get("url")
                if not sub_url:
                    continue
                segs = _fetch_and_parse_sub_url(sub_url)
                if segs:
                    return segs
        except Exception as e:  # noqa: BLE001
            errors.append(f"{api_base}: {e}")
            continue
    return None


def _segments_from_cached_info(url: str, browser: str | None) -> list | None:
    """用户刚解析过链接时，复用 yt-dlp 缓存里的 subtitles / automatic_captions。"""
    from ytdlp_cache import get

    for b in _browser_attempts(browser):
        info = get(url, b, variant="default")
        if not info:
            continue
        sub_url = _pick_subtitle_url(info)
        if not sub_url:
            continue
        segs = _fetch_and_parse_sub_url(sub_url)
        if segs:
            return segs
    return None


def _pick_subtitle_url(info: dict) -> str | None:
    pools = [info.get("subtitles") or {}, info.get("automatic_captions") or {}]
    for pool in pools:
        for lang in SUBTITLE_LANGS:
            entries = pool.get(lang) or pool.get(lang.replace("-", "_"))
            if not entries:
                continue
            for fmt in entries:
                url = fmt.get("url")
                if url:
                    return url
            if entries and entries[0].get("url"):
                return entries[0]["url"]
        for entries in pool.values():
            if entries and entries[0].get("url"):
                return entries[0]["url"]
    return None


def _fetch_and_parse_sub_url(sub_url: str) -> list | None:
    proxy = get_overseas_proxy()
    proxies = {"http": proxy, "https": proxy} if proxy else None
    try:
        resp = requests.get(
            sub_url, headers=_YT_HEADERS, timeout=45, proxies=proxies
        )
        resp.raise_for_status()
    except requests.RequestException:
        return None

    text = resp.text or ""
    if "fmt=srv3" in sub_url or "json3" in sub_url or text.lstrip().startswith("{"):
        return _parse_json3_subtitle(text)
    if "ttml" in sub_url.lower() or text.lstrip().startswith("<?xml"):
        return _parse_ttml_subtitle(text)

    ext = ".srt" if ".srt" in sub_url.lower() else ".vtt"
    path = None
    try:
        fd, path = tempfile.mkstemp(suffix=ext)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        return parse_subtitle_file(path) or None
    except OSError:
        return None
    finally:
        if path:
            _safe_remove(path)


def _fetch_vtt_from_info(url: str, browser: str | None) -> list | None:
    try:
        info = _extract_with_ytdlp(url, browser)
    except Exception:
        return None

    sub_url = _pick_subtitle_url(info)
    if not sub_url:
        return None
    return _fetch_and_parse_sub_url(sub_url)


def fetch_youtube_subtitles(url: str, browser: str | None) -> list | None:
    """YouTube 字幕统一入口（总结专用，免登录优先）。"""
    if not is_youtube_url(url):
        return None
    vid = youtube_video_id(url)
    if not vid:
        return None

    segs = _segments_from_transcript_api(vid)
    if segs:
        return segs

    segs = _segments_from_piped(vid)
    if segs:
        return segs

    for b in _browser_attempts(browser):
        segs = _segments_from_cached_info(url, b)
        if segs:
            return segs

    for b in _browser_attempts(browser):
        segs = _fetch_vtt_from_info(url, b)
        if segs:
            return segs

    return None


fetch_youtube_subtitles_from_info = _fetch_vtt_from_info


def _parse_json3_subtitle(raw: str) -> list | None:
    import json

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    events = data.get("events") or []
    segments: list[dict] = []
    for ev in events:
        if not ev.get("segs"):
            continue
        start_ms = ev.get("tStartMs", 0)
        dur_ms = ev.get("dDurationMs") or 0
        text = "".join(s.get("utf8", "") for s in ev["segs"]).strip()
        text = re.sub(r"\s+", " ", text)
        if not text or text == "\n":
            continue
        start = start_ms / 1000.0
        end = start + max(dur_ms / 1000.0, 0.5)
        if segments and segments[-1]["text"] == text:
            segments[-1]["end"] = end
            continue
        segments.append({"start": start, "end": end, "text": text})
    return segments or None


def _parse_ttml_subtitle(raw: str) -> list | None:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None

    segments: list[dict] = []
    for elem in root.iter():
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        if tag != "p":
            continue
        text = "".join(elem.itertext()).strip()
        text = re.sub(r"\s+", " ", text)
        if not text:
            continue
        begin = elem.get("begin") or elem.get("{http://www.w3.org/ns/ttml#parameter}begin")
        end = elem.get("end") or elem.get("{http://www.w3.org/ns/ttml#parameter}end")
        start = _ttml_time_to_seconds(begin or "0")
        end_sec = _ttml_time_to_seconds(end or "") if end else start + 2.0
        if end_sec <= start:
            end_sec = start + 2.0
        if segments and segments[-1]["text"] == text:
            segments[-1]["end"] = end_sec
            continue
        segments.append({"start": start, "end": end_sec, "text": text})
    return segments or None


def _ttml_time_to_seconds(value: str) -> float:
    v = (value or "").strip()
    if not v:
        return 0.0
    if v.endswith("s") and v[:-1].replace(".", "", 1).isdigit():
        return float(v[:-1])
    if ":" in v:
        parts = v.split(":")
        try:
            if len(parts) == 3:
                h, m, s = parts
                return int(h) * 3600 + int(m) * 60 + float(s)
            if len(parts) == 2:
                m, s = parts
                return int(m) * 60 + float(s)
        except ValueError:
            return 0.0
    try:
        return float(v)
    except ValueError:
        return 0.0
