"""B 站视频解析：匿名 try_look + 非 WBI playurl（绕过 yt-dlp 412）。

公开投稿：匿名 Cookie + playurl?try_look=1 通常可拿到 720P/1080P，无需登录。
大会员专享 / 充电专属：仍需用户浏览器 Cookie（含有效大会员或 UP 主权限）。
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

import requests

from platform_cookies import prepare_session_cookies, resolve_cookies_file

_VIEW_API = "https://api.bilibili.com/x/web-interface/view"
_PLAYURL_API = "https://api.bilibili.com/x/player/playurl"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
DOWNLOAD_HEADERS = {
    "User-Agent": _UA,
    "Referer": "https://www.bilibili.com/",
}

_SESSION = requests.Session()
_SESSION.trust_env = False

_LOGIN_HINT_MEMBER = (
    "该视频含大会员专享清晰度或内容。请在浏览器登录 bilibili.com 且账号为大会员后，"
    "勾选「读取浏览器登录态」选 Firefox，或导出 cookies.txt 到 backend/cookies.txt。"
)
_LOGIN_HINT_LOW = (
    "当前匿名仅解析到较低清晰度。若需更高画质，可在浏览器登录 B 站后导出 cookies.txt，"
    "或勾选「读取浏览器登录态」。"
)

_BVID_RE = re.compile(r"BV[0-9A-Za-z]{10}", re.I)
_AVID_RE = re.compile(r"av(\d+)", re.I)

# B 站 qn 与清晰度对照（accept_description 缺失时的兜底）
_QN_LABELS: dict[int, str] = {
    127: "8K",
    120: "4K",
    116: "1080P60",
    112: "1080P+",
    80: "1080P",
    64: "720P",
    32: "480P",
    16: "360P",
}


def is_bilibili_url(url: str) -> bool:
    low = (url or "").lower()
    return "bilibili.com" in low or "b23.tv" in low


def extract_bvid(url: str) -> str | None:
    if not url:
        return None
    m = _BVID_RE.search(url)
    if m:
        return m.group(0)
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    for key in ("bvid",):
        if key in qs and qs[key]:
            cand = qs[key][0]
            if _BVID_RE.fullmatch(cand):
                return cand
    return None


def extract_avid(url: str) -> int | None:
    m = _AVID_RE.search(url or "")
    return int(m.group(1)) if m else None


def _api_get(url: str, params: dict | None = None) -> dict:
    try:
        resp = _SESSION.get(
            url,
            params=params,
            headers=DOWNLOAD_HEADERS,
            timeout=20,
            proxies={"http": None, "https": None},
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError) as e:
        raise ValueError(f"B 站接口请求失败：{e}") from e
    if data.get("code") != 0:
        msg = data.get("message") or "未知错误"
        raise ValueError(f"B 站返回错误：{msg}")
    return data.get("data") or {}


def _warm_session(page_url: str) -> None:
    try:
        _SESSION.get(
            page_url,
            headers=DOWNLOAD_HEADERS,
            timeout=15,
            proxies={"http": None, "https": None},
        )
    except requests.RequestException:
        pass


def _stream_url(item: dict) -> str | None:
    return item.get("baseUrl") or ((item.get("backupUrl") or [None])[0])


def _videos_by_qn(videos: list[dict]) -> dict[int, dict]:
    """同一 qn 可能有多条编码（AVC/HEVC），取带宽最高的一条。"""
    by_qn: dict[int, dict] = {}
    for v in videos:
        qn = v.get("id")
        if qn is None or not _stream_url(v):
            continue
        prev = by_qn.get(qn)
        if not prev or (v.get("bandwidth") or 0) > (prev.get("bandwidth") or 0):
            by_qn[qn] = v
    return by_qn


def _build_quality_options(play_data: dict) -> list[dict]:
    """从 playurl 的 DASH 流构建可选清晰度列表。"""
    dash = play_data.get("dash") or {}
    by_qn = _videos_by_qn(dash.get("video") or [])
    if not by_qn:
        return []

    accept_q = play_data.get("accept_quality") or []
    accept_desc = play_data.get("accept_description") or []
    desc_by_qn = dict(zip(accept_q, accept_desc))

    options: list[dict] = []
    for qn in sorted(by_qn, reverse=True):
        v = by_qn[qn]
        label = desc_by_qn.get(qn) or _QN_LABELS.get(qn)
        if not label and v.get("height"):
            label = f"{v['height']}p"
        label = label or f"qn{qn}"
        options.append(
            {
                "format_id": f"bilibili_qn_{qn}",
                "quality": label,
                "qn": qn,
                "height": v.get("height"),
                "ext": "mp4",
                "filesize": v.get("size"),
            }
        )
    return options


def parse_bilibili_qn(format_id: str | None) -> int | None:
    """从 format_id（如 bilibili_qn_64）解析 qn；None 表示取最高可用。"""
    if not format_id or format_id == "bilibili_best":
        return None
    if format_id.startswith("bilibili_qn_"):
        try:
            return int(format_id.rsplit("_", 1)[-1])
        except ValueError:
            return None
    return None


def _pick_streams(play_data: dict, qn: int | None = None) -> tuple[str, str | None]:
    """从 playurl 响应中取指定清晰度（qn）的视频流 + 音频流 URL。"""
    dash = play_data.get("dash") or {}
    by_qn = _videos_by_qn(dash.get("video") or [])
    audios = dash.get("audio") or []

    if by_qn:
        if qn is not None and qn in by_qn:
            chosen = by_qn[qn]
        elif qn is not None:
            # 匿名 Cookie 可能拿不到请求的档位，降到不高于 qn 的最高档
            lower = [q for q in by_qn if q <= qn]
            chosen = by_qn[max(lower)] if lower else by_qn[max(by_qn)]
        else:
            chosen = by_qn[max(by_qn)]
        v_url = _stream_url(chosen)
        a_url = None
        if audios:
            best_a = max(audios, key=lambda x: x.get("bandwidth") or 0)
            a_url = _stream_url(best_a)
        if v_url:
            return v_url, a_url

    durl = play_data.get("durl") or []
    if durl and durl[0].get("url"):
        return durl[0]["url"], None
    raise ValueError("未从 B 站 playurl 取得可下载地址（可能需大会员或登录）。")


def _has_premium_only_label(play_data: dict) -> bool:
    """accept 列表里是否标明大会员专享清晰度。"""
    for desc in play_data.get("accept_description") or []:
        if desc and "大会员" in str(desc):
            return True
    return False


def _fetch_play_data(bvid: str, cid: int, *, logged_in: bool) -> dict:
    """拉 playurl（非 WBI，避免 412）。

    匿名用户加 try_look=1 可不登录拿到 720P/1080P（公开投稿）；
    登录态用 fnval=4048 拿 DASH 多档；大会员片仍需有效 Cookie。
    """
    params: dict = {
        "bvid": bvid,
        "cid": cid,
        "qn": 127,
        "fnval": 4048,
        "fourk": 1,
    }
    if not logged_in:
        params["try_look"] = 1
    return _api_get(_PLAYURL_API, params)


def extract_bilibili(url: str, page: int = 1, qn: int | None = None, browser: str | None = None) -> dict:
    """解析 B 站视频，返回统一下载信息（含多档清晰度）。"""
    login_source = prepare_session_cookies(_SESSION, browser)
    bvid = extract_bvid(url)
    avid = extract_avid(url)
    page_url = url if bvid else url
    if bvid:
        page_url = f"https://www.bilibili.com/video/{bvid}"
    _warm_session(page_url)

    params: dict = {}
    if bvid:
        params["bvid"] = bvid
    elif avid:
        params["aid"] = avid
    else:
        raise ValueError("无法从链接识别 B 站 BV 号或 av 号。")

    view = _api_get(_VIEW_API, params)
    pages = view.get("pages") or [{"cid": view.get("cid"), "page": 1}]
    cid = None
    for p in pages:
        if int(p.get("page") or 1) == page:
            cid = p.get("cid")
            break
    if not cid:
        cid = view.get("cid")
    if not cid:
        raise ValueError("无法取得视频分 P 的 cid。")

    bvid = view.get("bvid") or bvid
    play = _fetch_play_data(bvid, cid, logged_in=login_source != "anonymous")
    qualities = _build_quality_options(play)
    if not qualities:
        raise ValueError("未获取到可下载的清晰度（高画质可能需要登录或大会员）。")

    selected_qn = qn
    if selected_qn is None:
        selected_qn = qualities[0]["qn"]
    video_url, audio_url = _pick_streams(play, selected_qn)
    audio_urls: list[str] = []
    dash = play.get("dash") or {}
    for a in dash.get("audio") or []:
        u = _stream_url(a)
        if u and u not in audio_urls:
            audio_urls.append(u)
        for bu in a.get("backupUrl") or []:
            if bu and bu not in audio_urls:
                audio_urls.append(bu)

    max_qn = max(q["qn"] for q in qualities)
    login_hint = None
    if _has_premium_only_label(play) and login_source == "anonymous":
        login_hint = _LOGIN_HINT_MEMBER
    elif login_source == "anonymous" and max_qn < 64:
        login_hint = _LOGIN_HINT_LOW

    return {
        "bvid": bvid,
        "cid": cid,
        "title": (view.get("title") or "").strip() or str(bvid),
        "thumbnail": view.get("pic"),
        "duration": view.get("duration"),
        "uploader": (view.get("owner") or {}).get("name"),
        "video_url": video_url,
        "audio_url": audio_url,
        "audio_urls": audio_urls or ([audio_url] if audio_url else []),
        "webpage_url": page_url,
        "qualities": qualities,
        "selected_qn": selected_qn,
        "login_hint": login_hint,
    }
