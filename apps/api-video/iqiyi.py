"""爱奇艺解析：accelerator + baseinfo + Dlink_Parse dash 签名（cmd5x/vf 纯算，无需用户 Cookie）。"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import time
from urllib.parse import quote, urlparse

import requests

_ACCELERATOR = "https://mesh.if.iqiyi.com/player/lw/lwplay/accelerator.js"
_BASEINFO = "https://pcw-api.iqiyi.com/video/video/baseinfo/{tvid}"
_DASH = "https://cache.video.iqiyi.com/dash"

_BID_LABELS = {
    "600": "1080P",
    "500": "720P",
    "300": "480P",
    "200": "360P",
    "100": "240P",
}

DOWNLOAD_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.iqiyi.com/",
}


def is_iqiyi_url(url: str) -> bool:
    host = (urlparse(url or "").hostname or "").lower()
    return "iqiyi.com" in host or host.endswith(".pps.tv")


def _page_url(url: str) -> str:
    cleaned = (url or "").strip().split("#")[0]
    if cleaned.startswith("http://"):
        cleaned = "https://" + cleaned[len("http://") :]
    return cleaned


def _iqiyi_auth(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def _iqiyi_add_char(text: str) -> str:
    out = text
    for t in range(4):
        for i in range(2):
            for r in range(4):
                n = (70 * t + 677 * i + 21 * r + 87 * t * i * r + 59) % 30
                n += 48 if n < 9 else 88
                out += chr(n)
    return out


def _session() -> requests.Session:
    s = requests.Session()
    s.trust_env = False
    return s


def _fetch_accelerator(session: requests.Session, page_url: str) -> str:
    resp = session.get(
        _ACCELERATOR,
        headers={**DOWNLOAD_HEADERS, "Referer": page_url},
        timeout=20,
        proxies={"http": None, "https": None},
    )
    resp.raise_for_status()
    return resp.text


def _parse_ids(acc: str, session: requests.Session) -> tuple[str, str, str, str | None]:
    if re.search(r"video\s+offline|视频已下线|已下架", acc, re.I):
        raise ValueError("该爱奇艺视频已下线或不可用，请换用其他链接。")
    m_t = re.search(r'"tvid"\s*:\s*"?(\d+)"?', acc)
    if not m_t:
        raise ValueError("无法从爱奇艺页面获取 tvid，链接可能无效或页面结构已变更。")
    tvid = m_t.group(1)
    m_v = re.search(r'"vid"\s*:\s*"([a-f0-9]{32})"', acc)
    vid = m_v.group(1) if m_v else None
    title = thumb = None
    info = session.get(
        _BASEINFO.format(tvid=tvid),
        headers=DOWNLOAD_HEADERS,
        timeout=20,
        proxies={"http": None, "https": None},
    ).json()
    data = info.get("data") or {}
    vid = vid or data.get("vid")
    title = data.get("name") or data.get("subtitle") or "爱奇艺视频"
    thumb = data.get("apic") or data.get("vpic")
    if not vid:
        raise ValueError("爱奇艺未返回 vid，无法请求播放地址。")
    return tvid, vid, title, thumb


def _build_dash_params(tvid: str, vid: str, bid: str) -> dict:
    tm = int(time.time() * 1000)
    auth_key = _iqiyi_auth(_iqiyi_auth("") + f"{tm}{tvid}")
    bop = '{"version":"10.0","dfp":"a05f71a09d3d594d61999d8de6456cae27c93252e9ce61cd4246848a76eafcb3ec"}'
    params = {
        "tvid": tvid,
        "bid": bid,
        "vid": vid,
        "src": "01080031010000000000",
        "vt": "0",
        "rs": "1",
        "uid": "",
        "ori": "pcw",
        "ps": "1",
        "k_uid": secrets.token_hex(16),
        "pt": "0",
        "d": "0",
        "s": "",
        "lid": "0",
        "cf": "0",
        "ct": "0",
        "authKey": auth_key,
        "k_tag": "1",
        "dfp": "a05f71a09d3d594d61999d8de6456cae27c93252e9ce61cd4246848a76eafcb3ec",
        "locale": "zh_cn",
        "pck": "38Dklg6YLDVPnQ2URa80m1AvEn7v0bVvq4MgAHwm3m1Vm3ai5115qb9dHm1vNXAv4ytm2qAF17",
        "k_err_retries": "0",
        "up": "",
        "qd_v": "a1",
        "tm": str(tm),
        "k_ft1": "706436220846084",
        "k_ft4": "1162321298202628",
        "k_ft5": "137573171201",
        "k_ft6": "128",
        "k_ft7": "671612932",
        "fr_300": "120_120_120_120_120_120",
        "fr_500": "120_120_120_120_120_120",
        "fr_600": "120_120_120_120_120_120",
        "fr_800": "120_120_120_120_120_120",
        "fr_1020": "120_120_120_120_120_120",
        "bop": bop,
        "ut": "0",
    }
    enc = [f"{quote(k, safe='')}={quote(str(v), safe='')}" for k, v in params.items() if k != "vf"]
    dash_path = "/dash?" + "&".join(enc)
    params["vf"] = hashlib.md5(_iqiyi_add_char(dash_path).encode("utf-8")).hexdigest()
    return params


def _dash_streams(session: requests.Session, tvid: str, vid: str) -> list[dict]:
    seen: set[str] = set()
    streams: list[dict] = []
    for bid in ("600", "500", "300", "200", "100"):
        params = _build_dash_params(tvid, vid, bid)
        resp = session.get(
            _DASH,
            params=params,
            headers=DOWNLOAD_HEADERS,
            timeout=20,
            proxies={"http": None, "https": None},
        )
        try:
            payload = resp.json()
        except json.JSONDecodeError:
            continue
        if payload.get("code") != "A00000":
            continue
        program = (payload.get("data") or {}).get("program") or {}
        for item in program.get("video") or []:
            m3u = item.get("m3u8") or item.get("m3u8Url") or item.get("url")
            if not m3u or m3u in seen:
                continue
            seen.add(m3u)
            bid_val = str(item.get("bid") or bid)
            streams.append(
                {
                    "format_id": f"iqiyi_{bid_val}",
                    "quality": _BID_LABELS.get(bid_val, f"{bid_val}P"),
                    "ext": "mp4",
                    "url": m3u,
                    "_rank": int(bid_val) if bid_val.isdigit() else 0,
                }
            )
    streams.sort(key=lambda x: x.get("_rank", 0), reverse=True)
    for s in streams:
        s.pop("_rank", None)
    return streams


def extract_iqiyi(url: str, browser: str | None = None) -> dict:
    page_url = _page_url(url)
    session = _session()
    try:
        session.get(page_url, headers=DOWNLOAD_HEADERS, timeout=20, proxies={"http": None, "https": None})
    except requests.RequestException:
        pass
    acc = _fetch_accelerator(session, page_url)
    tvid, vid, title, thumb = _parse_ids(acc, session)
    qualities = _dash_streams(session, tvid, vid)
    if not qualities:
        raise ValueError(
            "爱奇艺未返回可下载流（可能为会员专享/DRM）。公开视频通常无需登录即可解析。"
        )
    best = qualities[0]
    return {
        "tvid": tvid,
        "vid": vid,
        "title": title,
        "thumbnail": thumb,
        "webpage_url": page_url,
        "qualities": qualities,
        "video_url": best["url"],
        "format_id": best["format_id"],
    }


def pick_iqiyi_stream(data: dict, format_id: str | None) -> str:
    qualities = data.get("qualities") or []
    if format_id:
        for q in qualities:
            if q.get("format_id") == format_id:
                return q["url"]
    return data["video_url"]
