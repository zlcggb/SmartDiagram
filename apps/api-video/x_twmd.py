"""X (Twitter) 视频解析：FxTwitter API → syndication → yt-dlp → twmd。

公开视频推文优先走开源 FxEmbed（api.fxtwitter.com）与 Twitter syndication，无需登录。
受限/较新推文再回退 twmd（需 auth_token + ct0）或 yt-dlp。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from http.cookiejar import MozillaCookieJar

import requests

from url_normalize import get_system_proxy

_BACKEND_DIR = Path(__file__).resolve().parent
_BIN_DIR = _BACKEND_DIR / "bin"
_COOKIES_FILE = _BACKEND_DIR / "cookies.txt"
_COOKIES_FILE_ENV = os.environ.get("COOKIES_FILE")

_TWEET_ID_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:twitter\.com|x\.com)/\w+/status/(\d+)",
    re.I,
)
_USERNAME_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:twitter\.com|x\.com)/([^/?#]+)/status/\d+",
    re.I,
)
_VIDEO_URL_RE = re.compile(r"https?://(?:video\.twimg\.com|pbs\.twimg\.com)[^\s]+", re.I)
_RES_IN_MP4_RE = re.compile(r"/vid/(\d+)x(\d+)/", re.I)

_FX_API_BASES = (
    "https://api.fxtwitter.com",
    "https://api.vxtwitter.com",
)

DOWNLOAD_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://x.com/",
}

_TWMD_NAMES = (
    "twitter-media-downloader.exe",
    "twitter-media-downloader",
    "twmd.exe",
    "twmd",
)


def is_x_url(url: str) -> bool:
    low = (url or "").lower()
    return "twitter.com" in low or "x.com" in low


def extract_tweet_id(url: str) -> str | None:
    if not url:
        return None
    m = _TWEET_ID_RE.search(url.strip())
    return m.group(1) if m else None


def extract_x_username(url: str) -> str | None:
    if not url:
        return None
    m = _USERNAME_RE.search(url.strip())
    if not m:
        return None
    user = m.group(1)
    if user.lower() in ("i", "home", "search", "intent", "share"):
        return None
    return user


def canonical_x_url(url: str) -> str:
    tid = extract_tweet_id(url)
    if tid:
        return f"https://x.com/i/status/{tid}"
    return (url or "").strip()


def resolve_twmd_path() -> str | None:
    custom = os.environ.get("TWMD_PATH")
    if custom and os.path.isfile(custom):
        return custom
    for name in _TWMD_NAMES:
        candidate = _BIN_DIR / name
        if candidate.is_file():
            return str(candidate)
    for name in _TWMD_NAMES:
        found = shutil.which(name)
        if found:
            return found
    return None


def _cookies_file() -> str | None:
    if _COOKIES_FILE_ENV and os.path.isfile(_COOKIES_FILE_ENV):
        return _COOKIES_FILE_ENV
    if _COOKIES_FILE.is_file():
        return str(_COOKIES_FILE)
    return None


def _x_tokens_from_jar(jar: MozillaCookieJar) -> dict[str, str]:
    tokens: dict[str, str] = {}
    for c in jar:
        domain = (c.domain or "").lstrip(".").lower()
        if domain not in ("x.com", "twitter.com", "www.x.com", "www.twitter.com"):
            continue
        if c.name in ("auth_token", "ct0") and c.value:
            tokens[c.name] = c.value
    return tokens


def _load_x_tokens(browser: str | None = None) -> dict[str, str]:
    path = _cookies_file()
    if path:
        jar = MozillaCookieJar(path)
        try:
            jar.load(ignore_discard=True, ignore_expires=True)
        except Exception:
            jar = MozillaCookieJar()
        else:
            tokens = _x_tokens_from_jar(jar)
            if tokens.get("auth_token") and tokens.get("ct0"):
                return tokens

    if browser:
        try:
            from yt_dlp.cookies import YDLLogger, extract_cookies_from_browser
        except ImportError:
            return {}
        try:
            jar = extract_cookies_from_browser(browser, None, YDLLogger())
        except Exception:
            return {}
        tokens = {}
        for c in jar:
            domain = (c.domain or "").lstrip(".").lower()
            if domain not in ("x.com", "twitter.com", "www.x.com", "www.twitter.com"):
                continue
            if c.name in ("auth_token", "ct0") and c.value:
                tokens[c.name] = c.value
        return tokens
    return {}


def _go_cookie_json(name: str, value: str) -> dict:
    expires = datetime.now(timezone.utc) + timedelta(days=365)
    return {
        "Name": name,
        "Value": value,
        "Path": "/",
        "Domain": ".x.com",
        "Expires": expires.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "RawExpires": "",
        "MaxAge": 0,
        "Secure": True,
        "HttpOnly": True,
        "SameSite": 0,
        "Raw": "",
        "Unparsed": None,
    }


def write_twmd_cookies(work_dir: str, browser: str | None = None) -> bool:
    """写入 twmd 所需的 twmd_cookies.json；成功返回 True。"""
    tokens = _load_x_tokens(browser)
    if not tokens.get("auth_token") or not tokens.get("ct0"):
        return False
    payload = [
        _go_cookie_json("auth_token", tokens["auth_token"]),
        _go_cookie_json("ct0", tokens["ct0"]),
    ]
    path = os.path.join(work_dir, "twmd_cookies.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    return True


def _http_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    proxy = get_system_proxy()
    if proxy:
        session.proxies = {"http": proxy, "https": proxy}
    session.headers.update(DOWNLOAD_HEADERS)
    return session


def _best_mp4_from_variants(variants: list[dict]) -> str | None:
    """从 variants/formats 里选最高分辨率 mp4。"""
    best: tuple[int, str] | None = None
    for item in variants or []:
        url = item.get("url") or item.get("src") or ""
        ctype = (item.get("type") or item.get("content_type") or item.get("container") or "").lower()
        if "mp4" not in ctype and not url.endswith(".mp4") and ".mp4?" not in url:
            continue
        if "video.twimg.com" not in url:
            continue
        pixels = 0
        m = _RES_IN_MP4_RE.search(url)
        if m:
            pixels = int(m.group(1)) * int(m.group(2))
        bitrate = int(item.get("bitrate") or 0)
        score = pixels * 1000 + bitrate
        if best is None or score > best[0]:
            best = (score, url)
    return best[1] if best else None


def _video_from_fx_tweet(tweet: dict) -> dict | None:
    media = tweet.get("media") or {}
    videos = list(media.get("videos") or [])
    if not videos:
        for item in media.get("all") or []:
            if item.get("type") == "video":
                videos.append(item)
    if not videos:
        return None

    video = videos[0]
    variants = video.get("formats") or video.get("variants") or []
    mp4 = _best_mp4_from_variants(variants)
    if not mp4:
        url = video.get("url") or ""
        if "video.twimg.com" in url:
            mp4 = url
    if not mp4:
        return None

    author = tweet.get("author") or {}
    text = (tweet.get("text") or "").strip()
    return {
        "video_url": mp4,
        "title": (text[:120] + "…") if len(text) > 120 else (text or None),
        "thumbnail": video.get("thumbnail_url"),
        "duration": video.get("duration"),
        "uploader": author.get("name") or author.get("screen_name"),
        "source": "fxtwitter",
    }


def _fetch_fxtwitter(tweet_id: str, username: str | None = None) -> dict | None:
    """FxEmbed 开源 API，多数公开视频推文无需 Cookie。"""
    paths: list[str] = []
    if username:
        paths.append(f"/{username}/status/{tweet_id}")
    paths.append(f"/i/status/{tweet_id}")

    session = _http_session()
    for base in _FX_API_BASES:
        for path in paths:
            try:
                resp = session.get(f"{base}{path}", timeout=20)
            except requests.RequestException:
                continue
            if resp.status_code != 200:
                continue
            try:
                tweet = resp.json().get("tweet") or {}
            except ValueError:
                continue
            parsed = _video_from_fx_tweet(tweet)
            if parsed:
                return parsed
    return None


def _fetch_syndication(tweet_id: str) -> dict | None:
    """Twitter syndication 端点，部分推文可匿名取到 mp4。"""
    session = _http_session()
    url = (
        f"https://cdn.syndication.twimg.com/tweet-result"
        f"?id={tweet_id}&token=x&lang=en"
    )
    try:
        resp = session.get(url, timeout=20)
    except requests.RequestException:
        return None
    if resp.status_code != 200:
        return None
    try:
        data = resp.json()
    except ValueError:
        return None

    video = data.get("video") or {}
    variants = video.get("variants") or []
    mp4 = _best_mp4_from_variants(variants)
    if not mp4:
        return None

    user = data.get("user") or {}
    text = (data.get("text") or "").strip()
    duration_ms = video.get("durationMs")
    return {
        "video_url": mp4,
        "title": (text[:120] + "…") if len(text) > 120 else (text or None),
        "thumbnail": video.get("poster"),
        "duration": (duration_ms / 1000.0) if duration_ms else None,
        "uploader": user.get("name") or user.get("screen_name"),
        "source": "syndication",
    }


def _fetch_ytdlp(url: str, browser: str | None = None) -> dict | None:
    """yt-dlp 对部分推文仍可用，优先于 twmd。"""
    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        return None

    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 30,
    }
    proxy = get_system_proxy()
    if proxy:
        opts["proxy"] = proxy
    if browser:
        opts["cookiesfrombrowser"] = (browser,)

    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception:
        return None

    if not info:
        return None
    video_url = info.get("url")
    if not video_url and info.get("formats"):
        for fmt in reversed(info.get("formats") or []):
            if fmt.get("url") and "video.twimg.com" in fmt["url"]:
                video_url = fmt["url"]
                break
    if not video_url or "video.twimg.com" not in str(video_url):
        return None

    return {
        "video_url": video_url,
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader"),
        "source": "yt-dlp",
    }


def _parse_twmd_urls(stdout: str) -> list[str]:
    urls: list[str] = []
    for line in (stdout or "").splitlines():
        line = line.strip()
        if not line or line.startswith("Logged in"):
            continue
        if _VIDEO_URL_RE.match(line):
            urls.append(line.split()[0])
    # video.twimg.com 优先
    urls.sort(key=lambda u: ("video.twimg.com" not in u, len(u)))
    return urls


def _fetch_twmd_urls(tweet_id: str, *, browser: str | None = None) -> list[str]:
    """调用 twmd -z 获取推文媒体直链（需 Cookie 时）。"""
    twmd = resolve_twmd_path()
    if not twmd:
        raise ValueError(
            "未找到 twmd 可执行文件。请从 GitHub Releases 下载 twitter-media-downloader "
            "放到 backend/bin/，或设置环境变量 TWMD_PATH。"
        )

    proxy = get_system_proxy() or ""
    with tempfile.TemporaryDirectory(prefix="twmd_") as work_dir:
        use_cookies = write_twmd_cookies(work_dir, browser)
        cmd = [twmd, "-B", "-t", tweet_id, "-z", "-v"]
        if proxy:
            cmd.extend(["-p", proxy])
        if use_cookies:
            cmd.append("-C")

        try:
            proc = subprocess.run(
                cmd,
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=int(os.environ.get("TWMD_TIMEOUT", "90")),
                encoding="utf-8",
                errors="replace",
            )
        except subprocess.TimeoutExpired as e:
            raise ValueError("X 解析超时，请确认代理可用后重试。") from e

        urls = _parse_twmd_urls(proc.stdout)
        if urls:
            return urls

        err = (proc.stderr or proc.stdout or "").strip()
        low = err.lower()
        if "404" in low or "not found" in low:
            if not use_cookies:
                raise ValueError(
                    "X 拒绝了匿名请求（404）。请在浏览器登录 x.com 后，"
                    "导出 cookies.txt 到 backend/cookies.txt（需含 auth_token 与 ct0），"
                    "或勾选「读取浏览器登录态」。"
                )
            raise ValueError("未找到该推文或推文不含可下载视频（可能已删除或无权访问）。")
        if "bad cookies" in low or "invalid cookies" in low:
            raise ValueError(
                "X Cookie 无效或已过期。请重新在浏览器登录 x.com 并更新 cookies.txt。"
            )
        if err:
            raise ValueError(f"twmd 解析失败：{err.splitlines()[-1][:200]}")
        raise ValueError("该推文未包含可下载的视频。")


def fetch_media_urls(tweet_id: str, *, browser: str | None = None, url: str | None = None) -> list[str]:
    """按优先级解析视频直链。"""
    username = extract_x_username(url or "")
    page_url = url or canonical_x_url(f"https://x.com/i/status/{tweet_id}")

    for resolver in (
        lambda: _fetch_fxtwitter(tweet_id, username),
        lambda: _fetch_syndication(tweet_id),
        lambda: _fetch_ytdlp(page_url, browser),
    ):
        try:
            data = resolver()
        except Exception:
            data = None
        if data and data.get("video_url"):
            return [data["video_url"]]

    try:
        return _fetch_twmd_urls(tweet_id, browser=browser)
    except ValueError as e:
        msg = str(e)
        if "404" in msg or "Cookie" in msg or "登录" in msg:
            raise ValueError(
                "无法解析该 X 视频。公开推文通常可直接下载；若仍失败，可能是推文已删、"
                "不含视频，或需登录。请在 x.com 登录后导出 cookies.txt（含 auth_token、ct0）"
                "或勾选「读取浏览器登录态」后重试。"
            ) from e
        raise


def extract_x_public(url: str) -> dict | None:
    """无登录播放/下载：FxTwitter（开源）+ Twitter syndication。失败返回 None。"""
    tweet_id = extract_tweet_id(url)
    if not tweet_id:
        return None
    username = extract_x_username(url)
    for resolver in (
        lambda: _fetch_fxtwitter(tweet_id, username),
        lambda: _fetch_syndication(tweet_id),
    ):
        try:
            meta = resolver()
        except Exception:
            meta = None
        if meta and meta.get("video_url"):
            return meta
    return None


def extract_x(url: str, browser: str | None = None) -> dict:
    """解析 X 视频推文，返回与 downloader 统一的结构。"""
    tweet_id = extract_tweet_id(url)
    if not tweet_id:
        raise ValueError("无法从链接识别 X/Twitter 推文 ID（需要含 /status/数字 的链接）。")

    username = extract_x_username(url)
    page_url = canonical_x_url(url)

    meta: dict | None = extract_x_public(url)
    if not meta:
        try:
            meta = _fetch_ytdlp(page_url, browser)
        except Exception:
            meta = None

    if not meta:
        urls = _fetch_twmd_urls(tweet_id, browser=browser)
        video_url = urls[0]
        meta = {"video_url": video_url, "source": "twmd"}
    else:
        video_url = meta["video_url"]

    if "video.twimg.com" not in video_url and "amplify_video" not in video_url:
        raise ValueError("该推文未包含视频（可能仅为图片或文字）。")

    return {
        "tweet_id": tweet_id,
        "title": meta.get("title") or f"X 视频 {tweet_id}",
        "thumbnail": meta.get("thumbnail"),
        "duration": meta.get("duration"),
        "uploader": meta.get("uploader"),
        "video_url": video_url,
        "webpage_url": page_url,
        "source": meta.get("source"),
    }
