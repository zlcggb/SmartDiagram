"""抖音（douyin.com）专用解析模块。

为什么单独做，而不靠 yt-dlp：
- 抖音 Web 接口需要动态签名（a_bogus 等）且强制登录态，yt-dlp 的 Douyin 提取器
  时好时坏，常返回带水印地址或直接失败。
- 抖音有一个面向分享场景的公开页面（iesdouyin.com/share/video/{id}），页面里内联了
  `window._ROUTER_DATA` JSON，包含视频元信息与播放地址，且**无需登录**。
- 播放地址里的 `playwm`（watermark）换成 `play` 即得无水印地址。

设计原则：
- 纯逻辑（ID 提取 / 去水印 / JSON 解析）与网络 IO 分离，便于离线单测。
- 解析路径做多重兜底，因为抖音页面结构会随版本变化（命中不到时给清晰报错，方便调整）。

注意：真机验证需在能访问抖音的网络下进行；若抖音改了 JSON 结构，调整
`_pick_aweme()` 里的取值路径即可。
"""
import json
import os
import re
import base64
import hashlib
from http.cookiejar import MozillaCookieJar

import requests

from url_normalize import (
    canonical_douyin_url,
    extract_douyin_aweme_id,
    extract_url_from_text,
    is_douyin_url,
)

try:
    from platform_cookies import get_anonymous_cookie_file, load_anonymous_into_session
except ImportError:
    def get_anonymous_cookie_file(**_kw):  # type: ignore[misc]
        return None

    def load_anonymous_into_session(_session) -> None:  # type: ignore[misc]
        return

extract_aweme_id = extract_douyin_aweme_id

_ITEMINFO_API = "https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/"


def extract_share_url(text: str) -> str | None:
    u = extract_url_from_text(text)
    return u if u and is_douyin_url(u) else None


_UA_DESKTOP = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_UA_MOBILE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
)

# 下载抖音 CDN 直链时需要的请求头（防盗链 + 反爬）。
DOWNLOAD_HEADERS = {
    "User-Agent": _UA_DESKTOP,
    "Referer": "https://www.douyin.com/",
}

_COOKIES_FILE = os.environ.get("COOKIES_FILE")
_DEFAULT_COOKIES_FILE = os.path.join(os.path.dirname(__file__), "cookies.txt")


def _resolve_cookies_file() -> str | None:
    if _COOKIES_FILE and os.path.exists(_COOKIES_FILE):
        return _COOKIES_FILE
    if os.path.exists(_DEFAULT_COOKIES_FILE):
        return _DEFAULT_COOKIES_FILE
    return None


def _load_cookies_into_session(session: requests.Session) -> None:
    """把 cookies.txt 载入 Session（短链跳转常依赖浏览器 Cookie）。"""
    path = _resolve_cookies_file()
    if not path:
        return
    jar = MozillaCookieJar(path)
    try:
        jar.load(ignore_discard=True, ignore_expires=True)
    except Exception:
        return
    for c in jar:
        session.cookies.set(c.name, c.value, domain=c.domain, path=c.path)


def _short_link_failed_message() -> str:
    return (
        "抖音短链未能解析出视频 ID。请在浏览器打开该链接后，"
        "复制地址栏里 douyin.com/video/数字 的完整链接再粘贴。"
    )


_SHORT_LINK_CACHE: dict[str, tuple[float, str]] = {}
_DOUYIN_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_TTL_SEC = 300.0


def resolve_douyin_short_link(url: str) -> str:
    """解析 v.douyin.com 短链；完整页/精选请用 url_normalize.normalize_url。"""
    import time
    raw = (url or "").strip()
    low = raw.lower()
    if "v.douyin.com" not in low and "v.iesdouyin.com" not in low:
        return raw
    cached = _SHORT_LINK_CACHE.get(raw)
    if cached and (time.monotonic() - cached[0]) < _CACHE_TTL_SEC:
        return cached[1]
    final, _ = _http_get(raw, mobile=True)
    aweme_id = extract_douyin_aweme_id(final)
    if not aweme_id:
        from urllib.parse import parse_qs, urlparse

        qs = parse_qs(urlparse(final).query)
        for key in ("modal_id", "aweme_id", "item_id", "video_id", "share_item_id"):
            vals = qs.get(key)
            if vals and str(vals[0]).isdigit():
                aweme_id = str(vals[0])
                break
    homepage = final.rstrip("/").endswith("douyin.com")
    if aweme_id and not homepage:
        resolved = f"https://www.douyin.com/video/{aweme_id}" if "/video/" not in final else final
        _SHORT_LINK_CACHE[raw] = (time.monotonic(), resolved)
        return resolved
    if aweme_id:
        resolved = f"https://www.douyin.com/video/{aweme_id}"
        _SHORT_LINK_CACHE[raw] = (time.monotonic(), resolved)
        return resolved
    if homepage:
        raise ValueError(_short_link_failed_message())
    raise ValueError(_short_link_failed_message())


# 兼容旧名
resolve_douyin_url = resolve_douyin_short_link


def to_no_watermark(play_url: str) -> str:
    """把带水印的播放地址转为无水印地址（playwm -> play）。"""
    if not play_url:
        return play_url
    return play_url.replace("playwm", "play").replace("/aweme/v1/playwm/", "/aweme/v1/play/")


def parse_router_data(html: str) -> dict:
    """从分享页 HTML 中抽取 `window._ROUTER_DATA = {...}` 的 JSON。"""
    if not html:
        raise ValueError("分享页内容为空")
    data = _extract_router_data_json(html)
    if data:
        return data
    m = re.search(
        r"_ROUTER_DATA\s*=\s*(\{.*?\})\s*</script>",
        html,
        re.DOTALL,
    )
    if not m:
        m = re.search(r"_ROUTER_DATA\s*=\s*(\{.*\});", html, re.DOTALL)
    if not m:
        raise ValueError(
            "分享页未找到视频数据（抖音可能触发了反爬校验）。"
            "请确认链接有效，或导出 douyin.com 的 cookies.txt 放到 backend/cookies.txt 后重试。"
        )
    return json.loads(m.group(1))


def _extract_router_data_json(html: str) -> dict:
    """用大括号深度匹配抽取 _ROUTER_DATA（比正则更稳）。"""
    marker = "window._ROUTER_DATA = "
    start = html.find(marker)
    if start < 0:
        return {}
    index = start + len(marker)
    while index < len(html) and html[index].isspace():
        index += 1
    if index >= len(html) or html[index] != "{":
        return {}

    depth = 0
    in_string = False
    escaped = False
    for cursor in range(index, len(html)):
        char = html[cursor]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[index : cursor + 1])
                except ValueError:
                    return {}
    return {}


def _is_waf_challenge_page(html: str) -> bool:
    return "Please wait..." in html and "wci=" in html and "cs=" in html


def _decode_urlsafe_b64(value: str) -> bytes:
    normalized = value.replace("-", "+").replace("_", "/")
    normalized += "=" * (-len(normalized) % 4)
    return base64.b64decode(normalized)


def _solve_and_set_waf_cookie(html: str, page_url: str) -> bool:
    """解 iesdouyin 分享页 WAF（SHA256 工作量证明），思路来自 MIT douyin_video_downloader。"""
    match = re.search(r'wci="([^"]+)"\s*,\s*cs="([^"]+)"', html)
    if not match:
        return False
    cookie_name, challenge_blob = match.groups()
    try:
        challenge_data = json.loads(_decode_urlsafe_b64(challenge_blob).decode("utf-8"))
        prefix = _decode_urlsafe_b64(challenge_data["v"]["a"])
        expected_digest = _decode_urlsafe_b64(challenge_data["v"]["c"]).hex()
    except (KeyError, ValueError, TypeError):
        return False

    solved_value = None
    for candidate in range(1_000_001):
        digest = hashlib.sha256(prefix + str(candidate).encode("utf-8")).hexdigest()
        if digest == expected_digest:
            solved_value = candidate
            break
    if solved_value is None:
        return False

    challenge_data["d"] = base64.b64encode(str(solved_value).encode("utf-8")).decode("utf-8")
    cookie_value = base64.b64encode(
        json.dumps(challenge_data, separators=(",", ":")).encode("utf-8")
    ).decode("utf-8")
    from urllib.parse import urlparse

    domain = urlparse(page_url).hostname or "www.iesdouyin.com"
    _SESSION.cookies.set(cookie_name, cookie_value, domain=domain, path="/")
    return True


def _fetch_item_info_api(aweme_id: str) -> dict | None:
    """优先走 iesdouyin 公开 iteminfo API。"""
    try:
        resp = _SESSION.get(
            _ITEMINFO_API,
            params={"item_ids": aweme_id},
            headers={"User-Agent": _UA_MOBILE, "Accept-Language": "zh-CN,zh;q=0.9"},
            timeout=15,
            proxies={"http": None, "https": None},
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError):
        return None
    if data.get("status_code") not in (0, None):
        return None
    item_list = data.get("item_list") or []
    return item_list[0] if item_list else None


def _get_share_page_html(share_url: str) -> str:
    """拉分享页 HTML，必要时自动解 WAF 后重试。"""
    _, html = _http_get(share_url, mobile=True)
    if _is_waf_challenge_page(html):
        if _solve_and_set_waf_cookie(html, share_url):
            _, html = _http_get(share_url, mobile=True)
    return html


def _pick_aweme(router_data: dict) -> dict:
    """从 _ROUTER_DATA 里定位到单个视频信息节点（结构随版本浮动，做多重兜底）。"""
    loader = router_data.get("loaderData") or {}
    # 常见结构：loaderData["video_(id)/page"].videoInfoRes.item_list[0]
    for key, node in loader.items():
        if not isinstance(node, dict):
            continue
        res = node.get("videoInfoRes") or node
        if not isinstance(res, dict):
            continue
        item_list = res.get("item_list")
        if item_list:
            return item_list[0]
        detail = res.get("aweme_detail")
        if detail:
            return detail
        filters = res.get("filter_list") or []
        if filters:
            reason = filters[0].get("filter_reason") or "unknown"
            raise ValueError(_filter_reason_message(reason))
    raise ValueError("无法从分享页定位视频信息（页面结构可能已变化）")


def _session_has_cookies() -> bool:
    return bool(_SESSION.cookies)


def _filter_reason_message(reason: str) -> str:
    """把抖音 filter_reason 转为用户可读提示。"""
    if reason == "SYSTEM_ITEM_NOT_EXIST" and not _session_has_cookies():
        return (
            "抖音未返回该视频数据（浏览器能打开，通常是因为已有 Cookie，不等于必须登录账号）。"
            "请勾选「读取浏览器登录态」选 Firefox，或用扩展导出 cookies.txt 放到 backend/cookies.txt 后重试。"
        )
    mapping = {
        "SYSTEM_ITEM_NOT_EXIST": "视频不存在或已被删除（链接可能已失效）。",
        "CORE_DEP": "该视频当前不可访问（可能被设为私密或已下架）。",
        "status_deleted": "视频已被作者删除。",
        "status_self_see": "视频仅作者可见。",
        "status_friend_see": "视频仅好友可见。",
    }
    return mapping.get(reason, f"视频不可访问（{reason}）。")


def _build_info(aweme: dict, aweme_id: str) -> dict:
    """把抖音原始 item 结构整理成我们统一的视频信息字典。"""
    video = aweme.get("video") or {}
    play_addr = video.get("play_addr") or {}
    url_list = play_addr.get("url_list") or []
    if not url_list:
        raise ValueError("未取到播放地址 url_list")
    play_url = to_no_watermark(url_list[0])

    cover = (video.get("cover") or video.get("origin_cover") or {}).get("url_list") or []
    duration_ms = video.get("duration") or 0
    author = aweme.get("author") or {}

    return {
        "aweme_id": aweme_id,
        "title": (aweme.get("desc") or "").strip() or f"douyin_{aweme_id}",
        "thumbnail": cover[0] if cover else None,
        "duration": (duration_ms / 1000) if duration_ms else None,
        "uploader": author.get("nickname"),
        "play_url": play_url,
    }


def classify_douyin_network_error(err: BaseException) -> dict:
    """把抖音网络层错误转为对用户可操作的提示。"""
    msg = str(err).strip()
    low = msg.lower()
    if any(
        k in low
        for k in (
            "ssl",
            "unexpected_eof",
            "certificate",
            "handshake",
        )
    ):
        return {
            "code": "douyin_network",
            "message": (
                "无法连接抖音服务器（SSL 握手失败）。抖音需直连国内网络，"
                "请勿让海外代理接管：在 Clash 等工具里把 douyin.com / iesdouyin.com 设为 DIRECT，"
                "或暂时关闭全局代理后重试。"
            ),
        }
    if any(k in low for k in ("10054", "connection reset", "connection aborted", "forcibly closed")):
        return {
            "code": "douyin_network",
            "message": (
                "无法连接抖音服务器（连接被重置）。常见于公司网络屏蔽抖音，"
                "请换手机热点或家庭网络后重试。"
            ),
        }
    if "timed out" in low or "timeout" in low:
        return {
            "code": "douyin_network",
            "message": "连接抖音超时，请检查网络或稍后重试。",
        }
    detail = msg or type(err).__name__
    return {
        "code": "douyin_network",
        "message": f"抖音解析失败：{detail}",
    }


# 独立 Session：忽略系统 HTTP_PROXY，抖音必须直连国内节点。
_SESSION = requests.Session()
_SESSION.trust_env = False
_load_cookies_into_session(_SESSION)
load_anonymous_into_session(_SESSION)


def _http_get(url: str, timeout: int = 15, *, mobile: bool = False) -> tuple[str, str]:
    """GET 请求，返回 (最终 URL, 文本)。短链解析依赖自动跟随 3xx。

    抖音为国内服务，必须直连；若走 HTTP_PROXY 海外节点会导致 SSL 握手失败。
    mobile=True 时用 iPhone UA，分享页才能返回 _ROUTER_DATA。
    """
    headers = {
        "User-Agent": _UA_MOBILE if mobile else _UA_DESKTOP,
        "Accept-Language": "zh-CN,zh;q=0.9",
    }
    try:
        resp = _SESSION.get(
            url,
            headers=headers,
            timeout=timeout,
            allow_redirects=True,
            proxies={"http": None, "https": None},
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        info = classify_douyin_network_error(e)
        raise ValueError(info["message"]) from e
    return resp.url, resp.text


def extract_douyin(url: str, *, force_refresh: bool = False) -> dict:
    """解析抖音链接，返回统一视频信息（含无水印 play_url）。

    流程：提取 aweme_id → 内存缓存 → iteminfo API → 分享页 _ROUTER_DATA（含 WAF 解题）→ 无水印地址。
    """
    import time
    url = canonical_douyin_url(url) or url
    aweme_id = extract_douyin_aweme_id(url)
    if not aweme_id:
        raise ValueError(
            "无法从链接解析出抖音视频 ID。请粘贴完整链接，"
            "如 https://www.douyin.com/video/数字 或 App 内复制的 v.douyin.com 短链。"
        )

    if force_refresh:
        _DOUYIN_CACHE.pop(aweme_id, None)
    else:
        cached = _DOUYIN_CACHE.get(aweme_id)
        if cached and (time.monotonic() - cached[0]) < _CACHE_TTL_SEC:
            return dict(cached[1])

    get_anonymous_cookie_file()
    load_anonymous_into_session(_SESSION)

    aweme = _fetch_item_info_api(aweme_id)
    if not aweme:
        share_url = f"https://www.iesdouyin.com/share/video/{aweme_id}/"
        html = _get_share_page_html(share_url)
        router_data = parse_router_data(html)
        aweme = _pick_aweme(router_data)
    info = _build_info(aweme, aweme_id)
    _DOUYIN_CACHE[aweme_id] = (time.monotonic(), info)
    return dict(info)
