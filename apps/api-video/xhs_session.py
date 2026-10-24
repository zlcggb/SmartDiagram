"""小红书匿名会话：xhshow 签名 + activate 拿 web_session（用户无感）。"""
from __future__ import annotations

import binascii
import hashlib
import random
import re
import string
import time
from urllib.parse import parse_qs, urlparse

import requests
from xhshow import Xhshow

_EDITH = "https://edith.xiaohongshu.com"
_HOME = "https://www.xiaohongshu.com"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_xhshow = Xhshow()


def _get_a1_and_web_id() -> tuple[str, str]:
    def _rand(n: int) -> str:
        return "".join(random.choice(string.ascii_letters + string.digits) for _ in range(n))

    d = hex(int(time.time() * 1000))[2:] + _rand(30) + "5" + "0" + "000"
    g = (d + str(binascii.crc32(d.encode("utf-8"))))[:52]
    return g, hashlib.md5(g.encode("utf-8")).hexdigest()


def _cookie_dict(session: requests.Session) -> dict[str, str]:
    return {c.name: c.value for c in session.cookies}


def _merge_cookie_header(session: requests.Session, extra: str | None) -> None:
    if not extra:
        return
    for part in extra.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        session.cookies.set(name.strip(), value.strip(), domain=".xiaohongshu.com", path="/")


def _base_headers() -> dict[str, str]:
    return {
        "User-Agent": _UA,
        "Referer": f"{_HOME}/",
        "Origin": _HOME,
    }


def create_anonymous_session(extra_cookie: str | None = None) -> requests.Session:
    """访问首页 + activate，服务端自动拿匿名 web_session（用户无感）。"""
    session = requests.Session()
    session.trust_env = False
    a1, web_id = _get_a1_and_web_id()
    session.cookies.set("a1", a1, domain=".xiaohongshu.com", path="/")
    session.cookies.set("webId", web_id, domain=".xiaohongshu.com", path="/")
    _merge_cookie_header(session, extra_cookie)

    headers = _base_headers()
    session.get(
        f"{_HOME}/explore",
        headers=headers,
        timeout=15,
        proxies={"http": None, "https": None},
    )

    uri = "/api/sns/web/v1/login/activate"
    cookies = _cookie_dict(session)
    cookies.setdefault("a1", a1)
    cookies.setdefault("webId", web_id)
    signs = _xhshow.sign_headers_post(uri=uri, cookies=cookies, payload={})
    resp = session.post(
        f"{_EDITH}{uri}",
        data="{}",
        headers={**headers, "Content-Type": "application/json", **signs},
        timeout=15,
        proxies={"http": None, "https": None},
    )
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("success"):
        raise ValueError(f"小红书 activate 失败：{payload.get('msg') or payload}")
    data = payload.get("data") or {}
    if sess_id := data.get("session"):
        session.cookies.set("web_session", sess_id, domain=".xiaohongshu.com", path="/")
    return session


def parse_xhs_url(url: str) -> tuple[str, str, str]:
    parsed = urlparse(url.split("#")[0])
    qs = parse_qs(parsed.query)
    xsec_token = (qs.get("xsec_token") or [""])[0]
    xsec_source = (qs.get("xsec_source") or ["pc_feed"])[0]
    m = re.search(r"/(?:explore|discovery/item|user/profile/[^/]+)/([0-9a-f]+)", parsed.path, re.I)
    if not m:
        raise ValueError("无法从链接识别小红书笔记 ID。")
    return m.group(1), xsec_token, xsec_source


def fetch_note_card(session: requests.Session, note_id: str, xsec_token: str, xsec_source: str) -> dict:
    import json

    uri = "/api/sns/web/v1/feed"
    data = {
        "source_note_id": note_id,
        "image_formats": ["jpg", "webp", "avif"],
        "extra": {"need_body_topic": 1},
        "xsec_source": xsec_source,
        "xsec_token": xsec_token,
    }
    cookies = _cookie_dict(session)
    signs = _xhshow.sign_headers_post(uri=uri, cookies=cookies, payload=data)
    headers = {**_base_headers(), "Content-Type": "application/json", **signs}
    resp = session.post(
        f"{_EDITH}{uri}",
        data=json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode(),
        headers=headers,
        timeout=20,
        proxies={"http": None, "https": None},
    )
    payload = resp.json()
    code = payload.get("code")
    if code == 300031:
        raise ValueError("xsec_token 已过期或笔记不可浏览，请重新从 App/网页「分享」复制完整链接。")
    if not payload.get("success"):
        raise ValueError(f"小红书 feed 接口失败：{payload.get('msg') or code or payload}")
    items = (payload.get("data") or {}).get("items") or []
    if not items:
        raise ValueError("小红书未返回笔记数据，xsec_token 可能已过期，请重新分享链接。")
    return items[0]["note_card"]


def video_url_from_note(note: dict) -> str | None:
    video = note.get("video") or {}
    consumer = video.get("consumer") or {}
    key = consumer.get("origin_video_key") or consumer.get("originVideoKey")
    if key:
        cdn = random.choice(
            [
                "https://sns-video-bd.xhscdn.com",
                "https://sns-video-qc.xhscdn.com",
                "https://sns-video-hw.xhscdn.com",
            ]
        )
        return f"{cdn}/{key}"

    media = video.get("media") or {}
    stream = media.get("stream") or {}
    for bucket in ("h264", "h265", "av1"):
        for item in stream.get(bucket) or []:
            url = item.get("master_url") or item.get("masterUrl")
            if url:
                return url
    return None


def cookie_header(session: requests.Session) -> str:
    return "; ".join(f"{c.name}={c.value}" for c in session.cookies)
