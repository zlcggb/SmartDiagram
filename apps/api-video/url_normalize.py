"""多平台链接规范化：从口令/短链/精选页提取 URL，转为 yt-dlp 友好形态。

设计原则：各平台只在此做「薄适配」，下载逻辑统一走 yt-dlp。
"""
from __future__ import annotations

import os
import re
from urllib.parse import urlparse

# 国内站点：应直连，勿走 HTTP_PROXY 海外节点
_DOMESTIC_HOST_SUFFIXES = (
    "douyin.com",
    "iesdouyin.com",
    "bilibili.com",
    "b23.tv",
    "youku.com",
    "iqiyi.com",
    "qq.com",
    "weibo.com",
    "xiaohongshu.com",
    "kuaishou.com",
)

# 海外站点：国内环境通常需走系统代理
_OVERSEAS_HOST_SUFFIXES = (
    "youtube.com",
    "youtu.be",
    "googlevideo.com",
    "googleusercontent.com",
    "ggpht.com",
    "gvt1.com",
    "tiktok.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "facebook.com",
    "vimeo.com",
    "twitch.tv",
)

_URL_IN_TEXT = re.compile(
    r"https?://[^\s<>\"']+",
    re.IGNORECASE,
)

_DOUYIN_IN_TEXT = re.compile(
    r"https?://(?:www\.)?(?:v\.douyin\.com|v\.iesdouyin\.com|douyin\.com|iesdouyin\.com)[^\s<>\"']+",
    re.IGNORECASE,
)

_TIKTOK_IN_TEXT = re.compile(
    r"https?://(?:www\.)?(?:v(?:t)?\.tiktok\.com|tiktok\.com)/[^\s<>\"']+",
    re.IGNORECASE,
)

_X_IN_TEXT = re.compile(
    r"https?://(?:www\.)?(?:twitter\.com|x\.com)/\w+/status/\d+[^\s<>\"']*",
    re.IGNORECASE,
)

_WEIBO_IN_TEXT = re.compile(
    r"https?://(?:www\.)?(?:weibo\.com|m\.weibo\.cn|video\.weibo\.com|weibo\.cn)/[^\s<>\"']+",
    re.IGNORECASE,
)

_TCN_IN_TEXT = re.compile(
    r"https?://(?:www\.)?t\.cn/[^\s<>\"']+",
    re.IGNORECASE,
)

_WEIBO_SHORT_HOSTS = frozenset({"t.cn", "weibo.cn"})


def _is_weibo_short_host(host: str) -> bool:
    return host in _WEIBO_SHORT_HOSTS or host.endswith(".t.cn")


def _weibo_request_headers() -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
        "Referer": "https://weibo.com/",
    }


def _follow_weibo_short_link(url: str) -> str:
    """跟跳 t.cn / weibo.cn 短链，返回最终落地页。"""
    import requests

    session = requests.Session()
    session.trust_env = False
    resp = session.get(
        url,
        timeout=15,
        allow_redirects=True,
        headers=_weibo_request_headers(),
        proxies={"http": None, "https": None},
    )
    resp.raise_for_status()
    return resp.url or url


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def _matches_suffix(host: str, suffixes: tuple[str, ...]) -> bool:
    return any(host == s or host.endswith("." + s) for s in suffixes)


def is_xhs_url(url: str) -> bool:
    h = _host(url)
    return bool(h) and (
        "xiaohongshu.com" in h or h == "xhslink.com" or "rednote.com" in h
    )


def is_iqiyi_url(url: str) -> bool:
    h = _host(url)
    return bool(h) and ("iqiyi.com" in h or h.endswith(".pps.tv"))


def canonical_xhs_url(url: str) -> str:
    """保留 xsec_token 等查询参数（小红书必需）。"""
    cleaned = (url or "").strip().split("#")[0]
    if cleaned.startswith("http://"):
        cleaned = "https://" + cleaned[len("http://") :]
    return cleaned


def canonical_iqiyi_url(url: str) -> str:
    cleaned = (url or "").strip().split("#")[0]
    if cleaned.startswith("http://"):
        cleaned = "https://" + cleaned[len("http://") :]
    return cleaned


def detect_platform(url: str) -> str | None:
    """返回平台标识：douyin / tiktok / bilibili / youtube / weibo / None。"""
    h = _host(url)
    if not h:
        return None
    if "douyin" in h or "iesdouyin" in h:
        return "douyin"
    if "tiktok" in h:
        return "tiktok"
    if "bilibili" in h or h == "b23.tv":
        return "bilibili"
    if "youtube" in h or h == "youtu.be":
        return "youtube"
    if "twitter" in h or h == "x.com" or h.endswith(".x.com"):
        return "x"
    if "weibo" in h:
        return "weibo"
    if is_xhs_url(url):
        return "xhs"
    if is_iqiyi_url(url):
        return "iqiyi"
    return None


def needs_overseas_proxy(url: str) -> bool:
    """该 URL 是否建议走 HTTP(S)_PROXY（海外站）。"""
    h = _host(url)
    if not h:
        return False
    if _matches_suffix(h, _DOMESTIC_HOST_SUFFIXES):
        return False
    if _matches_suffix(h, _OVERSEAS_HOST_SUFFIXES):
        return True
    return False


def get_system_proxy() -> str | None:
    from proxy_config import get_overseas_proxy

    return get_overseas_proxy()


def extract_url_from_text(text: str) -> str | None:
    """从分享口令或混合文本中提取第一个视频 HTTP 链接（优先抖音/TikTok）。"""
    if not text:
        return None
    for pat in (_DOUYIN_IN_TEXT, _TIKTOK_IN_TEXT, _X_IN_TEXT, _WEIBO_IN_TEXT, _TCN_IN_TEXT, _URL_IN_TEXT):
        m = pat.search(text)
        if m:
            return m.group(0).rstrip(".,;)]}")
    return None


def is_douyin_url(url: str) -> bool:
    if not url:
        return False
    low = url.lower()
    return "douyin.com" in low or "iesdouyin.com" in low


def is_tiktok_url(url: str) -> bool:
    return "tiktok.com" in (url or "").lower()


def is_weibo_url(url: str) -> bool:
    return "weibo" in _host(url or "")


def canonical_weibo_url(url: str) -> str:
    """将微博链接规范为 yt-dlp Weibo/WeiboVideo 提取器可识别的形态。"""
    if not url:
        return url
    from urllib.parse import parse_qs, urlparse

    cleaned = url.strip().split("#")[0]
    parsed = urlparse(cleaned)
    host = (parsed.hostname or "").lower()

    if host == "video.weibo.com":
        qs = parse_qs(parsed.query)
        fid = (qs.get("fid") or [None])[0]
        if fid:
            return f"https://weibo.com/tv/show/{fid}"
        m = re.search(r"/show/([^?#/]+)", parsed.path)
        if m:
            return f"https://weibo.com/tv/show/{m.group(1)}"

    if host == "m.weibo.cn":
        m = re.search(r"/detail/(\d+)", parsed.path)
        if m:
            return f"https://m.weibo.cn/status/{m.group(1)}"

    if host.endswith("weibo.com") and "/tv/show/" in parsed.path:
        m = re.search(r"/tv/show/([^?#/]+)", parsed.path)
        if m:
            return f"https://weibo.com/tv/show/{m.group(1)}"

    return cleaned


def extract_douyin_aweme_id(url: str) -> str | None:
    """从抖音 URL 提取 aweme_id（含精选 modal_id、/video/、/note/）。"""
    if not url:
        return None
    for pat in (
        r"/video/(\d+)",
        r"modal_id=(\d+)",
        r"/share/video/(\d+)",
        r"/note/(\d+)",
        r"aweme_id=(\d+)",
    ):
        m = re.search(pat, url)
        if m:
            return m.group(1)
    m = re.search(r"(\d{15,21})", url)
    return m.group(1) if m else None


def canonical_douyin_url(url: str) -> str | None:
    aweme_id = extract_douyin_aweme_id(url)
    if aweme_id:
        return f"https://www.douyin.com/video/{aweme_id}"
    return None


def _normalize_douyin(text: str) -> str:
    """抖音：精选 modal_id / 完整页 / 短链（短链需 douyin 模块跟跳转）。"""
    raw = extract_url_from_text(text) or text.strip()
    low = raw.lower()

    # 精选、播放页、modal_id：直接规范为 /video/{id}
    if "v.douyin.com" not in low and "v.iesdouyin.com" not in low:
        canon = canonical_douyin_url(raw)
        if canon:
            return canon

    from douyin import resolve_douyin_short_link

    return resolve_douyin_short_link(raw)


def _normalize_tiktok(text: str) -> str:
    """TikTok：从口令提取链接；短链交给 yt-dlp 跟随跳转。"""
    raw = extract_url_from_text(text) or text.strip()
    if not raw.lower().startswith(("http://", "https://")):
        raise ValueError("无法从输入中识别 TikTok 链接")
    return raw


def _normalize_x(text: str) -> str:
    """X / Twitter：提取 status 链接并规范为 x.com/i/status/{id}。"""
    from x_twmd import canonical_x_url, extract_tweet_id

    raw = extract_url_from_text(text) or text.strip()
    tid = extract_tweet_id(raw)
    if not tid:
        raise ValueError("无法从链接识别 X/Twitter 推文 ID（需要 /status/数字）。")
    return canonical_x_url(raw)


def _normalize_weibo(text: str) -> str:
    """微博：口令提取 + video.weibo.com → tv/show + t.cn 短链跟跳。"""
    raw = extract_url_from_text(text) or text.strip()
    raw = canonical_weibo_url(raw)
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if _is_weibo_short_host(host):
        try:
            raw = _follow_weibo_short_link(raw)
        except Exception:
            pass
        return canonical_weibo_url(raw)
    return raw


def _normalize_bilibili(text: str) -> str:
    """B 站：b23.tv 短链跟跳转到 bilibili.com。"""
    raw = extract_url_from_text(text) or text.strip()
    low = raw.lower()
    if "b23.tv" not in low:
        return raw
    import requests

    session = requests.Session()
    session.trust_env = False
    try:
        resp = session.get(
            raw,
            timeout=15,
            allow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                ),
                "Referer": "https://www.bilibili.com/",
            },
            proxies={"http": None, "https": None},
        )
        resp.raise_for_status()
        return resp.url or raw
    except requests.RequestException:
        return raw


def normalize_url(text: str) -> str:
    """统一入口：规范化用户输入为 yt-dlp 可用的 URL。"""
    raw = (text or "").strip()
    if not raw:
        raise ValueError("URL 不能为空")

    extracted = extract_url_from_text(raw)
    candidate = extracted or raw
    platform = detect_platform(candidate)

    if platform == "douyin" or is_douyin_url(candidate) or is_douyin_url(raw):
        return _normalize_douyin(raw)
    if platform == "tiktok" or is_tiktok_url(candidate) or is_tiktok_url(raw):
        return _normalize_tiktok(raw)
    if platform == "x":
        return _normalize_x(raw)
    if platform == "bilibili":
        return _normalize_bilibili(raw)
    if (
        platform == "weibo"
        or is_weibo_url(candidate)
        or is_weibo_url(raw)
        or _is_weibo_short_host(_host(candidate))
        or _is_weibo_short_host(_host(raw))
    ):
        return _normalize_weibo(raw)
    if platform == "xhs" or is_xhs_url(candidate) or is_xhs_url(raw):
        canon = canonical_xhs_url(extract_url_from_text(raw) or raw)
        if "xhslink.com" in canon.lower():
            try:
                from xiaohongshu import resolve_xhs_share_url

                canon = resolve_xhs_share_url(canon)
            except Exception:
                pass
        return canon
    if platform == "iqiyi" or is_iqiyi_url(candidate) or is_iqiyi_url(raw):
        return canonical_iqiyi_url(extract_url_from_text(raw) or raw)

    if extracted:
        return extracted
    if candidate.lower().startswith(("http://", "https://")):
        return candidate
    raise ValueError("无法识别视频链接，请粘贴以 http:// 或 https:// 开头的地址")
