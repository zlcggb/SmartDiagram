"""服务端自动获取国内平台匿名 Cookie（用户无感，不等于登录账号）。

公开视频常只需 buvid3 / ttwid 等匿名指纹即可通过反爬；会员/私有内容仍需用户 cookies.txt。
"""
from __future__ import annotations

import os
import time
from http.cookiejar import Cookie, MozillaCookieJar
from pathlib import Path

import requests

_BACKEND_DIR = Path(__file__).resolve().parent
_ANON_COOKIE_FILE = _BACKEND_DIR / ".anonymous_cookies.txt"
_DEFAULT_COOKIES_FILE = _BACKEND_DIR / "cookies.txt"
_COOKIES_FILE_ENV = os.environ.get("COOKIES_FILE")
_TTL_SECONDS = int(os.environ.get("ANON_COOKIE_TTL", "3600"))

_UA_DESKTOP = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_UA_MOBILE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
)

# 访问顺序：B 站导航接口会下发 buvid；抖音首页会下发 ttwid 等
_BILIBILI_SEED_URLS = (
    "https://www.bilibili.com/",
    "https://api.bilibili.com/x/web-interface/nav",
)
_DOUYIN_SEED_URLS = (
    "https://www.douyin.com/",
    "https://www.iesdouyin.com/",
)
_TIKTOK_SEED_URLS = (
    "https://www.tiktok.com/",
)


def _direct_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    session.headers.update(
        {
            "User-Agent": _UA_DESKTOP,
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": "https://www.bilibili.com/",
        }
    )
    return session


def _is_fresh() -> bool:
    if not _ANON_COOKIE_FILE.is_file():
        return False
    return time.time() - _ANON_COOKIE_FILE.stat().st_mtime < _TTL_SECONDS


def _cookie_to_jar_entry(jar: MozillaCookieJar, c: requests.cookies.Cookie) -> None:
    domain = c.domain or ""
    jar.set_cookie(
        Cookie(
            version=0,
            name=c.name,
            value=c.value,
            port=None,
            port_specified=False,
            domain=domain,
            domain_specified=bool(domain),
            domain_initial_dot=domain.startswith("."),
            path=c.path or "/",
            path_specified=bool(c.path),
            secure=bool(c.secure),
            expires=c.expires,
            discard=False,
            comment=None,
            comment_url=None,
            rest={},
            rfc2109=False,
        )
    )


def _save_netscape(session: requests.Session, path: Path) -> None:
    jar = MozillaCookieJar(str(path))
    for c in session.cookies:
        _cookie_to_jar_entry(jar, c)
    jar.save(ignore_discard=True, ignore_expires=True)


def _seed_urls(session: requests.Session, urls: tuple[str, ...], *, mobile: bool = False) -> None:
    headers = {"User-Agent": _UA_MOBILE if mobile else _UA_DESKTOP}
    proxies = {"http": None, "https": None}
    for url in urls:
        try:
            session.get(url, headers=headers, timeout=15, allow_redirects=True, proxies=proxies)
        except requests.RequestException:
            continue


def refresh_anonymous_cookies(*, force: bool = False) -> str:
    """拉取 B 站 / 抖音匿名 Cookie 并写入 Netscape 文件。"""
    if not force and _is_fresh():
        return str(_ANON_COOKIE_FILE)

    session = _direct_session()
    _seed_urls(session, _BILIBILI_SEED_URLS)
    _seed_urls(session, _DOUYIN_SEED_URLS, mobile=True)
    _seed_urls(session, _TIKTOK_SEED_URLS, mobile=True)
    _save_netscape(session, _ANON_COOKIE_FILE)
    return str(_ANON_COOKIE_FILE)


def get_anonymous_cookie_file(*, refresh: bool = False) -> str | None:
    try:
        return refresh_anonymous_cookies(force=refresh)
    except OSError:
        return None


def resolve_cookies_file() -> str | None:
    """用户导出的 cookies.txt（含 B 站 / 抖音登录态）。"""
    if _COOKIES_FILE_ENV and os.path.isfile(_COOKIES_FILE_ENV):
        return _COOKIES_FILE_ENV
    if _DEFAULT_COOKIES_FILE.is_file():
        return str(_DEFAULT_COOKIES_FILE)
    return None


def _load_jar_into_session(session: requests.Session, path: str) -> None:
    jar = MozillaCookieJar(path)
    try:
        jar.load(ignore_discard=True, ignore_expires=True)
    except Exception:
        return
    for c in jar:
        session.cookies.set(c.name, c.value, domain=c.domain, path=c.path)


def _load_browser_into_session(session: requests.Session, browser: str) -> bool:
    """从 Firefox 等浏览器读取 Cookie 写入 Session（与 yt-dlp 同源）。"""
    try:
        from yt_dlp.cookies import YDLLogger, extract_cookies_from_browser
    except ImportError:
        return False
    try:
        jar = extract_cookies_from_browser(browser, None, YDLLogger())
    except Exception:
        return False
    for c in jar:
        session.cookies.set(c.name, c.value, domain=c.domain, path=c.path)
    return True


def prepare_session_cookies(session: requests.Session, browser: str | None = None) -> str:
    """为请求准备 Cookie：匿名底稿 → cookies.txt / 浏览器登录态覆盖。返回 login 来源说明。"""
    session.cookies.clear()
    load_anonymous_into_session(session)
    if resolve_cookies_file():
        _load_jar_into_session(session, resolve_cookies_file())  # type: ignore[arg-type]
        return "file"
    if browser and _load_browser_into_session(session, browser):
        return "browser"
    return "anonymous"


def netscape_cookie_header(path: str | None = None) -> str:
    """从 Netscape cookies 文件生成 Cookie 请求头（TikTok CDN 等必需）。"""
    use = path or resolve_cookies_file() or get_anonymous_cookie_file()
    if not use or not os.path.isfile(use):
        return ""
    jar = MozillaCookieJar(use)
    try:
        jar.load(ignore_discard=True, ignore_expires=True)
    except Exception:
        return ""
    return "; ".join(f"{c.name}={c.value}" for c in jar if c.name and c.value)


def load_anonymous_into_session(session: requests.Session) -> None:
    """把匿名 Cookie 载入已有 requests.Session（与 cookies.txt 并存时后者优先）。"""
    path = get_anonymous_cookie_file()
    if not path or not os.path.isfile(path):
        return
    jar = MozillaCookieJar(path)
    try:
        jar.load(ignore_discard=True, ignore_expires=True)
    except Exception:
        return
    for c in jar:
        if c.name not in session.cookies:
            session.cookies.set(c.name, c.value, domain=c.domain, path=c.path)
