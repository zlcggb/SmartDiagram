"""yt-dlp 封装层：解析视频信息 + 下载（带进度回调）。

设计原则：尽量薄封装，直接调用 yt-dlp 的 Python API，少改动。
"""
import os
import re
import glob
import shutil
import subprocess

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadCancelled

from tasks import (
    clear_task_controls,
    is_cancel_requested,
    update_task,
    wait_while_paused,
)
from douyin import DOWNLOAD_HEADERS as DOUYIN_HEADERS
from douyin import (
    extract_douyin,
    extract_share_url,
    is_douyin_url,
    resolve_douyin_url,
)
from url_normalize import (
    canonical_douyin_url,
    get_system_proxy,
    is_tiktok_url,
    is_weibo_url,
    needs_overseas_proxy,
    normalize_url,
)
from platform_cookies import get_anonymous_cookie_file
from bilibili import DOWNLOAD_HEADERS as BILIBILI_HEADERS
from bilibili import extract_bilibili, is_bilibili_url as _is_bilibili_url, parse_bilibili_qn
from x_twmd import DOWNLOAD_HEADERS as X_HEADERS
from x_twmd import extract_x, is_x_url as _is_x_url
from xiaohongshu import DOWNLOAD_HEADERS as XHS_HEADERS
from xiaohongshu import extract_xiaohongshu, is_xhs_url as _is_xhs_url, resolve_xhs_share_url
from iqiyi import DOWNLOAD_HEADERS as IQIYI_HEADERS
from iqiyi import extract_iqiyi, is_iqiyi_url as _is_iqiyi_url, pick_iqiyi_stream
from weibo import DOWNLOAD_HEADERS as WEIBO_HEADERS
from weibo import extract_weibo

DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# 可选：通过环境变量指定 ffmpeg 所在目录（便携版场景）。未设置时 yt-dlp 走 PATH。
FFMPEG_LOCATION = os.environ.get("FFMPEG_LOCATION")

# 可选：cookies 文件（Netscape 格式）。优先用环境变量 COOKIES_FILE 指定的路径；
# 否则自动探测 backend/cookies.txt（用户用浏览器扩展导出后直接丢到这里即可，零配置）。
COOKIES_FILE = os.environ.get("COOKIES_FILE")
DEFAULT_COOKIES_FILE = os.path.join(os.path.dirname(__file__), "cookies.txt")

# YouTube n-challenge 等需要 JS 运行时；默认探测便携 Node，也可用环境变量 NODE_JS 覆盖。
_NODE_JS = os.environ.get("NODE_JS") or r"G:\node-v24.16.0-win-x64\node.exe"
if not os.environ.get("NO_PROXY"):
    os.environ["NO_PROXY"] = "127.0.0.1,localhost"


def _apply_js_runtime(opts: dict) -> None:
    """为 yt-dlp 配置 Node.js 与 EJS 远程组件（YouTube n-challenge / 格式列表需要）。"""
    if os.path.isfile(_NODE_JS):
        opts["js_runtimes"] = {"node": {"path": _NODE_JS}}
    # yt-dlp 2026+：需拉取 EJS 挑战求解脚本，否则 YouTube 只剩 storyboard 图。
    opts.setdefault("remote_components", set()).add("ejs:github")


def _resolve_cookies_file() -> str | None:
    """解析可用的 cookies 文件路径：环境变量优先，其次默认 backend/cookies.txt。"""
    if COOKIES_FILE and os.path.exists(COOKIES_FILE):
        return COOKIES_FILE
    if os.path.exists(DEFAULT_COOKIES_FILE):
        return DEFAULT_COOKIES_FILE
    return None

# 可选：bgutil PO Token provider 的 HTTP 地址。
# 默认（留空）时 yt-dlp 插件会自动连本机 http://127.0.0.1:4416，无需配置。
# 当 provider 部署在别的主机/端口时，用该变量覆盖（如 http://127.0.0.1:8080）。
POT_PROVIDER_BASE_URL = os.environ.get("POT_PROVIDER_BASE_URL")

# 可选：自定义 YouTube player_client（逗号分隔，如 "default,mweb,tv"）。
# 留空时使用 yt-dlp 默认客户端组合（配合 PO Token 已能绕过常规 bot 校验）。
_player_clients_env = os.environ.get("YT_PLAYER_CLIENTS")
YT_PLAYER_CLIENTS = (
    [c.strip() for c in _player_clients_env.split(",") if c.strip()]
    if _player_clients_env
    else None
)

# TikTok：优先 H.264，避免 Windows / 浏览器无法播 HEVC（方案 A）
_TIKTOK_YTDLP_FORMAT = (
    "bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/"
    "bestvideo[vcodec^=avc][ext=mp4]+bestaudio/"
    "bestvideo[vcodec!=hev1][vcodec!=hvc1][vcodec!=hevc]+bestaudio/"
    "b[ext=mp4][vcodec^=avc]/"
    "bestvideo+bestaudio/best"
)


def _apply_pot_provider(opts: dict) -> None:
    """注入 PO Token provider 与 player_client 调优参数（用于绕过 YouTube bot 校验）。

    - PO Token 插件（bgutil-ytdlp-pot-provider）已随 pip 安装并被 yt-dlp 自动加载，
      只要本机 provider 服务在跑（默认 127.0.0.1:4416），公开视频即可免 cookie 解析/下载。
    - 仅当配置了自定义地址或客户端时才注入 extractor_args，否则走默认行为。
    """
    if not POT_PROVIDER_BASE_URL and not YT_PLAYER_CLIENTS:
        return
    extractor_args = dict(opts.get("extractor_args") or {})
    if POT_PROVIDER_BASE_URL:
        extractor_args["youtubepot-bgutilhttp"] = {"base_url": [POT_PROVIDER_BASE_URL]}
    if YT_PLAYER_CLIENTS:
        youtube_args = dict(extractor_args.get("youtube") or {})
        youtube_args["player_client"] = YT_PLAYER_CLIENTS
        extractor_args["youtube"] = youtube_args
    opts["extractor_args"] = extractor_args


def _apply_player_clients(opts: dict, clients: list | None) -> None:
    """为单次重试覆盖 YouTube player_client（如年龄门用嵌入式客户端）。"""
    if not clients:
        return
    extractor_args = dict(opts.get("extractor_args") or {})
    youtube_args = dict(extractor_args.get("youtube") or {})
    youtube_args["player_client"] = clients
    extractor_args["youtube"] = youtube_args
    opts["extractor_args"] = extractor_args


def _apply_cookies(opts: dict, browser: str | None) -> None:
    """为 yt-dlp 选项注入登录态。

    优先级：用户 cookies 文件 > 浏览器读取 > 服务端匿名 Cookie 池。
    """
    cookies_file = _resolve_cookies_file()
    if cookies_file:
        opts["cookiefile"] = cookies_file
    elif browser:
        opts["cookiesfrombrowser"] = (browser,)
    else:
        anon = get_anonymous_cookie_file()
        if anon:
            opts["cookiefile"] = anon


def _is_cookie_error(err: Exception) -> bool:
    """判断异常是否由读取浏览器 cookie 失败导致。

    典型场景：Chromium 系数据库被锁（Could not copy cookie database）、
    Chrome/Edge 127+ 应用绑定加密（Failed to decrypt with DPAPI）。
    命中后对公开内容做「免 cookie」兜底重试。
    """
    msg = str(err).lower()
    return any(k in msg for k in ("cookie", "dpapi", "decrypt"))


# 年龄门 / bot 校验时尝试的嵌入式客户端：部分受限内容可免登录取到 player 响应。
_AGE_GATE_CLIENTS = ["tv_embedded", "web_embedded", "default", "mweb"]


def _is_bot_or_age_error(err: Exception) -> bool:
    """是否疑似 bot 校验 / 年龄门（可尝试嵌入式客户端绕过）。"""
    msg = str(err).lower()
    return any(
        k in msg
        for k in ("not a bot", "confirm your age", "age-restricted", "inappropriate")
    )


def _recover_attempts(browser: str | None, err: Exception) -> list:
    """根据首次失败的错误类型，给出后续重试参数序列 [(use_browser, clients), ...]。

    - 浏览器 cookie 读取失败 → 退回「无浏览器」（此时若有 cookies.txt 仍会自动采用）。
    - bot 校验 / 年龄门 → 尝试嵌入式客户端组合（无浏览器，保留 cookies.txt）。
    """
    attempts = []
    if browser and _is_cookie_error(err):
        # Edge/Chrome 在 Windows 上常读不出 cookie，自动改用 Firefox 登录态再试。
        if browser in {"edge", "chrome", "brave", "chromium", "opera", "vivaldi"}:
            attempts.append(("firefox", None))
        attempts.append((None, None))
    if _is_bot_or_age_error(err):
        # YouTube bot 校验：优先尝试 Firefox 登录态（Windows 上比 Edge 可靠），再试嵌入式客户端。
        if not browser:
            attempts.append(("firefox", None))
        attempts.append((None, _AGE_GATE_CLIENTS))
    if _is_bilibili_412_error(err) and not _resolve_cookies_file():
        attempts.append(("__refresh_anon__", None))
    return attempts


def _recover(run, browser: str | None, err: Exception):
    """按 _recover_attempts 顺序重试；全失败时抛出**最后一次**错误（比 cookie 读取失败更有参考价值）。"""
    last_err = err
    for use_browser, clients in _recover_attempts(browser, err):
        try:
            if use_browser == "__refresh_anon__":
                get_anonymous_cookie_file(refresh=True)
                return run(None, clients)
            return run(use_browser, clients)
        except Exception as e:  # noqa: BLE001
            last_err = e
            continue
    raise last_err


def _is_bilibili_412_error(err: Exception) -> bool:
    msg = str(err).lower()
    return "412" in msg and ("bilibili" in msg or "precondition failed" in msg)


def _ffmpeg_bin() -> str:
    if FFMPEG_LOCATION:
        candidate = os.path.join(FFMPEG_LOCATION, "ffmpeg.exe")
        if os.path.isfile(candidate):
            return candidate
    return shutil.which("ffmpeg") or "ffmpeg"


def _ffmpeg_merge(video_path: str, audio_path: str, out_path: str) -> None:
    cmd = [
        _ffmpeg_bin(),
        "-y",
        "-i",
        video_path,
        "-i",
        audio_path,
        "-c",
        "copy",
        out_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def _apply_http_headers(opts: dict, url: str) -> None:
    """为部分平台补充常见请求头（如 B 站 / 微博 Referer）。"""
    if _is_bilibili_url(url):
        headers = dict(opts.get("http_headers") or {})
        headers.setdefault("Referer", "https://www.bilibili.com/")
        opts["http_headers"] = headers
    elif "weibo" in (url or "").lower():
        headers = dict(opts.get("http_headers") or {})
        headers.setdefault("Referer", "https://weibo.com/")
        opts["http_headers"] = headers
    elif _is_x_url(url):
        headers = dict(opts.get("http_headers") or {})
        headers.update(X_HEADERS)
        opts["http_headers"] = headers


def _apply_proxy_opts(opts: dict, url: str) -> None:
    """按域名分流代理：海外站走本机/环境代理，国内站强制直连。"""
    if needs_overseas_proxy(url):
        proxy = get_system_proxy()
        if proxy:
            opts["proxy"] = proxy
        else:
            opts["proxy"] = ""
    else:
        opts["proxy"] = ""


def classify_error(err) -> dict:
    """把 yt-dlp 原始报错归类为结构化、对用户友好的提示。

    返回 {"code": ..., "message": ...}，前端据此决定是否引导登录。
    """
    msg = str(err)
    low = msg.lower()
    if "抖音需要浏览器 Cookie" in msg or "抖音未返回该视频数据" in msg:
        return {"code": "douyin_cookie", "message": msg}
    if msg.startswith(("无法连接抖音", "连接抖音超时", "抖音解析失败", "分享页未找到", "无法从分享页")):
        return {"code": "douyin_network", "message": msg}
    if msg.startswith(("视频不存在", "视频不可访问", "视频已被", "视频仅", "该视频当前", "抖音短链在服务端")):
        return {"code": "unavailable", "message": msg}
    if "fresh cookies" in low:
        return {
            "code": "douyin_cookie",
            "message": (
                "抖音需要浏览器 Cookie 校验（通常不必登录账号）。"
                "请在浏览器打开 douyin.com 随便浏览几个视频，然后："
                "① 勾选「读取浏览器登录态」选 Firefox；或 "
                "② 用扩展导出 cookies.txt 放到 backend/cookies.txt。"
            ),
        }
    if any(
        k in low
        for k in (
            "private video",
            "members-only",
            "members only",
            "join this channel",
            "this video is available to this channel's members",
            "sign in to confirm your age",
            "confirm your age",
            "age-restricted",
            "login required",
            "requires authentication",
            "412: precondition failed",
            "precondition failed",
        )
    ):
        if "bilibili" in low:
            return {
                "code": "needs_login",
                "message": (
                    "B 站拒绝了请求（HTTP 412，反爬校验）。"
                    "公开视频通常只需匿名 Cookie，请重试一次；若仍失败，"
                    "请在浏览器打开 bilibili.com 后用扩展导出 cookies.txt 放到 backend/cookies.txt。"
                    "（会员/高码率视频才需要登录账号。）"
                ),
            }
        return {
            "code": "needs_login",
            "message": "该视频需要登录或为会员 / 年龄限制内容。请在「需要登录?」中提供登录态后重试。",
        }
    if "not a bot" in low:
        return {
            "code": "bot_ip",
            "message": (
                "当前网络被 YouTube 判定为异常流量（这不是“视频需要会员”，公开视频也会被拦）。"
                "建议：① 取消勾选「读取浏览器登录态」（Edge 无法直读）；"
                "② 用扩展导出 YouTube 的 cookies.txt 放到 backend/cookies.txt；"
                "③ 或更换网络（如手机热点）后重试。"
            ),
        }
    if "could not copy" in low and "cookie" in low:
        return {
            "code": "needs_login",
            "message": (
                "无法从 Edge/Chrome 读取登录态（浏览器 127+ 加密限制）。"
                "公开视频请取消勾选「读取浏览器登录态」；若仍提示网络受限，"
                "请用扩展「Get cookies.txt LOCALLY」导出 YouTube 的 cookies.txt，"
                "放到 backend/cookies.txt 后重试（无需再勾选）。"
            ),
        }
    if any(k in low for k in ("not available in your country", "geo", "region")):
        return {
            "code": "geo_blocked",
            "message": "该视频在当前地区不可用（地区限制）。",
        }
    if any(
        k in low
        for k in ("video unavailable", "removed", "deleted", "no longer available")
    ):
        return {
            "code": "unavailable",
            "message": "视频不可用（可能已被删除、设为私有或链接有误）。",
        }
    if "ip address is blocked" in low and "tiktok" in low:
        return {
            "code": "tiktok_ip_blocked",
            "message": (
                "TikTok 封禁了当前代理 IP，无法拉取直链。"
                "工作台会尝试官方嵌入页播放；下载请换住宅代理或稍后重试。"
            ),
        }
    if "tiktok" in low and any(
        k in low
        for k in (
            "unable to download",
            "timed out",
            "timeout",
            "connection",
            "ssl",
            "errno",
            "network is unreachable",
        )
    ):
        return {
            "code": "needs_proxy",
            "message": (
                "TikTok / YouTube 等海外站需要本机代理。"
                "请确认 Clash 等已开启（常见端口 10808 / 7890），"
                "或在 backend/overseas_proxy.txt 写入代理地址，"
                "或设置环境变量 HTTP_PROXY=http://127.0.0.1:10808 后重启后端。"
            ),
        }
    if any(k in low for k in ("timed out", "timeout", "errno", "connection")) and not get_system_proxy():
        return {
            "code": "needs_proxy",
            "message": (
                "连接海外视频站超时：未检测到可用代理。"
                "请开启本机代理（如 Clash 10808），或在 backend/overseas_proxy.txt 写入代理地址后重启后端。"
            ),
        }
    if "weibo" in low and ("403" in low or "forbidden" in low):
        return {
            "code": "needs_cookie",
            "message": (
                "微博拒绝了下载请求（403）。公开视频通常可直接解析；若仍失败，"
                "请在浏览器打开 weibo.com 登录后，用扩展导出 cookies.txt 到 backend/cookies.txt，"
                "或勾选「读取浏览器登录态」后重试。"
            ),
        }
    if "weibo" in low and "432" in low:
        return {
            "code": "needs_cookie",
            "message": (
                "微博触发了访问频率限制（432）。请稍等几分钟后重试；"
                "若持续失败，可在 weibo.com 登录后导出 cookies.txt 到 backend/cookies.txt。"
            ),
        }
    if "weibo" in low and ("unsupported url" in low or "no suitable extractor" in low):
        return {
            "code": "bad_url",
            "message": (
                "无法识别该微博链接。请使用含视频的完整链接，例如："
                "weibo.com/用户数字ID/博文ID、m.weibo.cn/status/数字、"
                "weibo.com/tv/show/1034:... 或 video.weibo.com 分享链接。"
            ),
        }
    if "weibo" in low and "extractor failed to obtain" in low:
        return {
            "code": "bad_url",
            "message": (
                "无法识别该微博链接。请使用含视频的完整链接，例如："
                "weibo.com/用户数字ID/博文ID、m.weibo.cn/status/数字、"
                "weibo.com/tv/show/1034:..."
            ),
        }
    if "no video formats found" in low and "weibo" in low:
        return {
            "code": "unavailable",
            "message": "该微博不含可下载视频，或链接已失效。",
        }
    if msg.startswith(
        (
            "未找到 twmd",
            "X 拒绝了匿名",
            "X Cookie",
            "twmd 解析失败",
            "无法从链接识别 X",
            "无法解析该 X 视频",
            "该推文未包含",
        )
    ):
        return {"code": "needs_login", "message": msg}
    if msg.startswith(
        (
            "小红书链接识别失败",
            "小红书获取数据失败",
            "小红书未返回视频下载地址",
            "该笔记为",
            "无法从链接识别小红书",
            "链接缺少 xsec_token",
            "xsec_token 已过期",
            "小红书 feed 接口失败",
            "小红书未返回笔记数据",
            "小红书 API 未返回视频地址",
            "小红书 activate 失败",
        )
    ):
        code = "bad_url" if "xsec_token" in msg or "识别" in msg else "needs_cookie"
        return {"code": code, "message": msg}
    if msg.startswith(
        (
            "该爱奇艺视频已下线",
            "无法从爱奇艺页面获取",
            "爱奇艺未返回 vid",
            "爱奇艺拒绝了播放地址",
            "爱奇艺播放地址签名",
            "爱奇艺播放接口返回",
            "爱奇艺未返回可下载",
            "该爱奇艺视频存在地区限制",
        )
    ):
        code = "unavailable" if "已下线" in msg else "needs_cookie"
        if "地区限制" in msg:
            code = "geo_blocked"
        return {"code": code, "message": msg}
    if "iqiyi" in low and ("can't find any video" in low or "unable to extract" in low):
        return {
            "code": "needs_cookie",
            "message": (
                "爱奇艺页面结构已变更，yt-dlp 无法直接解析。"
                "本服务已尝试 API 兜底；若仍失败，请在 iqiyi.com 登录后导出 cookies.txt 到 backend/cookies.txt。"
            ),
        }
    if "无法识别视频链接" in msg or "无法从输入中识别" in msg:
        return {"code": "bad_url", "message": msg}
    return {"code": "generic", "message": f"解析失败：{msg}"}


def _sanitize_filename(name: str | None) -> str:
    """去掉 Windows/Unix 文件名非法字符。"""
    cleaned = re.sub(r'[\\/:*?"<>|\n\r\t]+', "_", name or "video")
    cleaned = cleaned.strip().strip(".")
    return cleaned or "video"


def _first_entry(info: dict) -> dict:
    """若是播放列表，取第一个条目。"""
    if info.get("_type") == "playlist" and info.get("entries"):
        entries = [e for e in info["entries"] if e]
        if entries:
            return entries[0]
    return info


def _douyin_ytdlp_url(url: str, browser: str | None = None) -> str | None:
    """抖音分享页失败时，尽量得到 yt-dlp 可用的 /video/{id} 链接。"""
    canon = canonical_douyin_url(url)
    if canon:
        return canon
    raw = extract_share_url(url) or url.strip()
    if "v.douyin.com" in raw.lower() or "v.iesdouyin.com" in raw.lower():
        return _resolve_short_via_ytdlp(raw, browser)
    return None


def _resolve_short_via_ytdlp(url: str, browser: str | None) -> str | None:
    """用浏览器 / cookies.txt 跟随短链，拿到含 video id 的地址。"""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
    }
    _apply_cookies(opts, browser)
    _apply_proxy_opts(opts, url)
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        final = info.get("webpage_url") or url
        return canonical_douyin_url(final)
    except Exception:
        return None


def _douyin_info_from_share(url: str) -> dict:
    """抖音：移动端分享页解析，公开视频通常无需登录。"""
    d = extract_douyin(url)
    return {
        "title": d["title"],
        "thumbnail": d["thumbnail"],
        "duration": d["duration"],
        "duration_string": None,
        "uploader": d["uploader"],
        "extractor": "Douyin",
        "webpage_url": url,
        "formats": [
            {
                "format_id": "douyin_nowm",
                "quality": "无水印",
                "ext": "mp4",
                "filesize": None,
            }
        ],
    }


def _bilibili_info_from_api(url: str, browser: str | None = None) -> dict:
    """B 站：匿名 Cookie + 非 WBI playurl，公开视频通常无需登录。"""
    d = extract_bilibili(url, browser=browser)
    formats = [
        {
            "format_id": q["format_id"],
            "quality": q["quality"],
            "ext": q.get("ext", "mp4"),
            "filesize": q.get("filesize"),
        }
        for q in d.get("qualities") or []
    ]
    result = {
        "title": d["title"],
        "thumbnail": d["thumbnail"],
        "duration": d["duration"],
        "duration_string": None,
        "uploader": d["uploader"],
        "extractor": "BiliBili",
        "webpage_url": d["webpage_url"],
        "formats": formats,
    }
    if d.get("login_hint"):
        result["login_hint"] = d["login_hint"]
    return result


def _x_info_from_twmd(url: str, browser: str | None = None) -> dict:
    d = extract_x(url, browser=browser)
    source = d.get("source") or "best"
    result = {
        "title": d["title"],
        "thumbnail": d.get("thumbnail"),
        "duration": d.get("duration"),
        "duration_string": None,
        "uploader": d.get("uploader"),
        "extractor": "X",
        "webpage_url": d["webpage_url"],
        "formats": [
            {
                "format_id": f"x_{source}_best",
                "quality": "最佳画质",
                "ext": "mp4",
                "filesize": None,
            }
        ],
    }
    from x_twmd import _load_x_tokens

    tokens = _load_x_tokens(browser)
    if source == "twmd" and not (tokens.get("auth_token") and tokens.get("ct0")):
        result["login_hint"] = (
            "该推文需 X 登录态（auth_token + ct0）。"
            "请在 x.com 登录后导出 cookies.txt 到 backend/cookies.txt，或勾选「读取浏览器登录态」。"
        )
    return result


def _xhs_info_from_api(url: str, browser: str | None = None) -> dict:
    d = extract_xiaohongshu(url, browser=browser)
    return {
        "title": d["title"],
        "thumbnail": d.get("thumbnail"),
        "duration": None,
        "duration_string": None,
        "uploader": d.get("uploader"),
        "extractor": "Xiaohongshu",
        "webpage_url": d["webpage_url"],
        "formats": [
            {
                "format_id": "xhs_video",
                "quality": "原画",
                "ext": "mp4",
                "filesize": None,
            }
        ],
    }


def _iqiyi_info_from_api(url: str, browser: str | None = None) -> dict:
    d = extract_iqiyi(url, browser=browser)
    formats = [
        {
            "format_id": q["format_id"],
            "quality": q["quality"],
            "ext": q.get("ext", "mp4"),
            "filesize": None,
        }
        for q in d.get("qualities") or []
    ]
    return {
        "title": d["title"],
        "thumbnail": d.get("thumbnail"),
        "duration": None,
        "duration_string": None,
        "uploader": None,
        "extractor": "IQiyi",
        "webpage_url": d["webpage_url"],
        "formats": formats,
    }


def _info_from_ytdlp_dict(info: dict, url: str) -> dict:
    """把 yt-dlp extract_info 结果整理成 API 响应格式。"""
    formats = info.get("formats") or []
    heights = sorted(
        {f.get("height") for f in formats if f.get("height")}, reverse=True
    )
    size_by_height: dict[int, int] = {}
    for f in formats:
        h = f.get("height")
        if not h:
            continue
        size = f.get("filesize") or f.get("filesize_approx")
        if size and (h not in size_by_height or size > size_by_height[h]):
            size_by_height[h] = size

    quality_options = [
        {
            "format_id": "bestvideo+bestaudio/best",
            "quality": "最佳画质",
            "ext": "mp4",
            "filesize": size_by_height.get(heights[0]) if heights else None,
        }
    ]
    for h in heights:
        quality_options.append(
            {
                "format_id": f"bestvideo[height<={h}]+bestaudio/best[height<={h}]",
                "quality": f"{h}p",
                "ext": "mp4",
                "filesize": size_by_height.get(h),
            }
        )

    if not any(q.get("filesize") for q in quality_options):
        top_size = info.get("filesize") or info.get("filesize_approx")
        if top_size and quality_options:
            quality_options[0]["filesize"] = top_size

    return {
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "duration_string": info.get("duration_string"),
        "uploader": info.get("uploader") or info.get("channel"),
        "extractor": info.get("extractor_key"),
        "webpage_url": info.get("webpage_url") or url,
        "formats": quality_options,
    }


def _extract_with_ytdlp(url: str, browser: str | None) -> dict:
    """yt-dlp 解析（含失败重试链）。"""

    def _extract(use_browser: str | None, clients: list | None = None) -> dict:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            "socket_timeout": 30,
        }
        _apply_pot_provider(opts)
        _apply_player_clients(opts, clients)
        _apply_js_runtime(opts)
        _apply_http_headers(opts, url)
        _apply_proxy_opts(opts, url)
        _apply_cookies(opts, use_browser)
        with YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False)

    def _run() -> dict:
        try:
            info = _extract(browser)
        except Exception as e:  # noqa: BLE001
            info = _recover(_extract, browser, e)
        return _first_entry(info)

    from ytdlp_cache import cached_extract

    return cached_extract(url, browser, _run)


def get_video_info(url: str, browser: str | None = None) -> dict:
    """解析视频元信息与可选清晰度（不下载）。"""
    url = normalize_url(url)
    if is_douyin_url(url):
        try:
            return _douyin_info_from_share(url)
        except Exception as primary:  # noqa: BLE001
            fallback = _douyin_ytdlp_url(url, browser)
            if fallback:
                try:
                    info = _extract_with_ytdlp(fallback, browser)
                    return _info_from_ytdlp_dict(info, fallback)
                except Exception as secondary:  # noqa: BLE001
                    sec = classify_error(secondary)
                    if sec["code"] in ("douyin_cookie", "needs_login"):
                        raise ValueError(sec["message"]) from secondary
            raise primary

    if _is_bilibili_url(url):
        try:
            return _bilibili_info_from_api(url, browser=browser)
        except Exception:
            pass

    if _is_x_url(url):
        return _x_info_from_twmd(url, browser=browser)

    if _is_xhs_url(url):
        return _xhs_info_from_api(url, browser=browser)

    if _is_iqiyi_url(url):
        return _iqiyi_info_from_api(url, browser=browser)

    if is_weibo_url(url):
        d = extract_weibo(url, browser=browser)
        return {
            "title": d["title"],
            "thumbnail": d.get("thumbnail"),
            "duration": d.get("duration"),
            "uploader": d.get("uploader"),
            "extractor": "Weibo",
            "webpage_url": d["webpage_url"],
            "formats": [
                {
                    "format_id": "weibo_best",
                    "quality": "默认",
                    "ext": "mp4",
                    "filesize": None,
                }
            ],
        }

    info = _extract_with_ytdlp(url, browser)
    return _info_from_ytdlp_dict(info, url)


def _cleanup_partial(task_id: str) -> None:
    """取消后删除未完成的临时文件。"""
    for f in glob.glob(os.path.join(DOWNLOAD_DIR, f"{task_id}.*")):
        try:
            os.remove(f)
        except OSError:
            pass


def _make_progress_hook(task_id: str, ydl_box: dict):
    def hook(d: dict):
        if is_cancel_requested(task_id):
            ydl = ydl_box.get("ydl")
            if ydl:
                ydl.cancel_download()
            return
        if wait_while_paused(task_id):
            ydl = ydl_box.get("ydl")
            if ydl:
                ydl.cancel_download()
            return

        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            downloaded = d.get("downloaded_bytes") or 0
            percent = (downloaded / total * 100) if total else 0.0
            update_task(
                task_id,
                status="downloading",
                percent=round(percent, 1),
                speed=d.get("speed"),
                eta=d.get("eta"),
            )
        elif status == "finished":
            update_task(task_id, status="processing", percent=99.0)

    return hook


def _run_ytdlp(opts: dict, task_id: str, extract_kwargs: dict) -> dict:
    """统一执行 yt-dlp 下载，注入可取消 / 可暂停的 progress_hook。"""
    ydl_box: dict = {}
    opts = dict(opts)
    opts["progress_hooks"] = [_make_progress_hook(task_id, ydl_box)]
    with YoutubeDL(opts) as ydl:
        ydl_box["ydl"] = ydl
        return ydl.extract_info(**extract_kwargs)


def _handle_download_error(task_id: str, err: Exception) -> None:
    if isinstance(err, DownloadCancelled) or is_cancel_requested(task_id):
        _cleanup_partial(task_id)
        update_task(task_id, status="cancelled", speed=None, eta=None, error=None)
        return
    info = classify_error(err)
    update_task(
        task_id, status="error", error=info["message"], error_code=info["code"]
    )


def _finalize_download(
    task_id: str,
    title: str | None,
    fallback_title: str | None,
    *,
    normalize_h264: bool = False,
) -> None:
    """下载完成后的统一收尾：定位成品文件并登记到任务表。"""
    matches = glob.glob(os.path.join(DOWNLOAD_DIR, f"{task_id}.*"))
    matches.sort(key=lambda p: (not p.lower().endswith(".mp4"), len(p)))
    if not matches:
        update_task(task_id, status="error", error="未找到下载文件")
        return
    filepath = matches[0]
    if normalize_h264:
        try:
            from video_normalize import ensure_h264_mp4

            filepath = ensure_h264_mp4(filepath)
        except Exception as e:  # noqa: BLE001
            _cleanup_partial(task_id)
            update_task(
                task_id,
                status="error",
                error=f"视频转 H.264 失败：{e}",
                error_code="transcode_failed",
            )
            return
    ext = os.path.splitext(filepath)[1].lstrip(".") or "mp4"
    nice_title = _sanitize_filename(title or fallback_title or task_id)
    update_task(
        task_id,
        status="finished",
        percent=100.0,
        filepath=filepath,
        filename=f"{nice_title}.{ext}",
        speed=None,
        eta=0,
    )


def _download_douyin(url: str, task_id: str, title: str | None) -> bool:
    """抖音分享页直链下载。优先复用本地已存文件，次选 4 线程分片下载，失败走 yt-dlp 兜底。"""
    try:
        d = extract_douyin(url)
    except Exception:
        return False

    target_mp4 = os.path.join(DOWNLOAD_DIR, f"{task_id}.mp4")

    # 1. 优先复用本地已下载或已由 AI 总结拉取的视频（0 秒极速落盘）
    try:
        from tasks import find_existing_video_file, register_video_cache

        existing = find_existing_video_file(url)
        if existing and os.path.isfile(existing) and os.path.getsize(existing) > 0:
            if os.path.abspath(existing) != os.path.abspath(target_mp4):
                shutil.copy2(existing, target_mp4)
            _finalize_download(task_id, title, d.get("title"))
            register_video_cache(url, target_mp4)
            return True
    except Exception:
        pass

    # 2. 尝试多线程分片并发下载（突破 CDN 单连接限速）
    try:
        from chunked_downloader import DownloadCancelled, download_file_chunked

        ok = download_file_chunked(
            d["play_url"],
            target_mp4,
            headers=DOUYIN_HEADERS,
            concurrency=4,
            task_id=task_id,
        )
        if ok and os.path.isfile(target_mp4) and os.path.getsize(target_mp4) > 0:
            _finalize_download(task_id, title, d.get("title"))
            try:
                from tasks import register_video_cache

                register_video_cache(url, target_mp4)
            except Exception:
                pass
            return True
    except DownloadCancelled:
        _cleanup_partial(task_id)
        update_task(task_id, status="cancelled", speed=None, eta=None)
        return True
    except Exception:
        pass

    # 3. 兜底回退：yt-dlp 原生单流下载
    outtmpl = os.path.join(DOWNLOAD_DIR, f"{task_id}.%(ext)s")
    opts = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "http_headers": DOUYIN_HEADERS,
    }
    if FFMPEG_LOCATION:
        opts["ffmpeg_location"] = FFMPEG_LOCATION
    try:
        _run_ytdlp(opts, task_id, {"url": d["play_url"], "download": True})
        if is_cancel_requested(task_id):
            _cleanup_partial(task_id)
            update_task(task_id, status="cancelled", speed=None, eta=None)
            return True
        _finalize_download(task_id, title, d.get("title"))
        try:
            from tasks import register_video_cache

            register_video_cache(url, target_mp4)
        except Exception:
            pass
        return True
    except Exception:
        _cleanup_partial(task_id)
        return False


def _download_bilibili(
    url: str,
    task_id: str,
    title: str | None,
    format_id: str | None = None,
    browser: str | None = None,
) -> bool:
    """B 站 DASH 直链下载（音视频分离时 ffmpeg 合并）。"""
    try:
        d = extract_bilibili(url, qn=parse_bilibili_qn(format_id), browser=browser)
    except Exception:
        return False

    base_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "http_headers": BILIBILI_HEADERS,
    }
    if FFMPEG_LOCATION:
        base_opts["ffmpeg_location"] = FFMPEG_LOCATION

    video_part = os.path.join(DOWNLOAD_DIR, f"{task_id}.video.mp4")
    audio_part = os.path.join(DOWNLOAD_DIR, f"{task_id}.audio.m4a")
    final_part = os.path.join(DOWNLOAD_DIR, f"{task_id}.mp4")

    try:
        v_opts = {**base_opts, "outtmpl": video_part}
        _run_ytdlp(v_opts, task_id, {"url": d["video_url"], "download": True})
        if is_cancel_requested(task_id):
            _cleanup_partial(task_id)
            update_task(task_id, status="cancelled", speed=None, eta=None)
            return True

        if d.get("audio_url"):
            a_opts = {**base_opts, "outtmpl": audio_part}
            _run_ytdlp(a_opts, task_id, {"url": d["audio_url"], "download": True})
            if is_cancel_requested(task_id):
                _cleanup_partial(task_id)
                update_task(task_id, status="cancelled", speed=None, eta=None)
                return True
            update_task(task_id, status="processing", percent=95.0)
            _ffmpeg_merge(video_part, audio_part, final_part)
            for p in (video_part, audio_part):
                try:
                    os.remove(p)
                except OSError:
                    pass
        else:
            os.replace(video_part, final_part)

        _finalize_download(task_id, title, d.get("title"))
        return True
    except Exception:
        _cleanup_partial(task_id)
        return False


def _download_x(
    url: str,
    task_id: str,
    title: str | None,
    browser: str | None = None,
) -> bool:
    try:
        d = extract_x(url, browser=browser)
    except Exception:
        return False

    outtmpl = os.path.join(DOWNLOAD_DIR, f"{task_id}.%(ext)s")
    opts = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "http_headers": X_HEADERS,
    }
    _apply_proxy_opts(opts, url)
    if FFMPEG_LOCATION:
        opts["ffmpeg_location"] = FFMPEG_LOCATION
    try:
        _run_ytdlp(opts, task_id, {"url": d["video_url"], "download": True})
        if is_cancel_requested(task_id):
            _cleanup_partial(task_id)
            update_task(task_id, status="cancelled", speed=None, eta=None)
            return True
        _finalize_download(task_id, title, d.get("title"))
        return True
    except Exception:
        _cleanup_partial(task_id)
        return False


def _download_xhs(
    url: str,
    task_id: str,
    title: str | None,
    browser: str | None = None,
) -> bool:
    try:
        d = extract_xiaohongshu(url, browser=browser)
    except Exception:
        return False

    outtmpl = os.path.join(DOWNLOAD_DIR, f"{task_id}.%(ext)s")
    opts = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "http_headers": XHS_HEADERS,
    }
    if FFMPEG_LOCATION:
        opts["ffmpeg_location"] = FFMPEG_LOCATION
    try:
        _run_ytdlp(opts, task_id, {"url": d["video_url"], "download": True})
        if is_cancel_requested(task_id):
            _cleanup_partial(task_id)
            update_task(task_id, status="cancelled", speed=None, eta=None)
            return True
        _finalize_download(task_id, title, d.get("title"))
        return True
    except Exception:
        _cleanup_partial(task_id)
        return False


def _download_iqiyi(
    url: str,
    task_id: str,
    title: str | None,
    format_id: str | None = None,
    browser: str | None = None,
) -> bool:
    try:
        d = extract_iqiyi(url, browser=browser)
    except Exception:
        return False

    stream_url = pick_iqiyi_stream(d, format_id)
    outtmpl = os.path.join(DOWNLOAD_DIR, f"{task_id}.%(ext)s")
    opts = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "http_headers": IQIYI_HEADERS,
    }
    if FFMPEG_LOCATION:
        opts["ffmpeg_location"] = FFMPEG_LOCATION
    try:
        _run_ytdlp(opts, task_id, {"url": stream_url, "download": True})
        if is_cancel_requested(task_id):
            _cleanup_partial(task_id)
            update_task(task_id, status="cancelled", speed=None, eta=None)
            return True
        _finalize_download(task_id, title, d.get("title"))
        return True
    except Exception:
        _cleanup_partial(task_id)
        return False


def _download_weibo(
    url: str,
    task_id: str,
    title: str | None,
    browser: str | None = None,
) -> bool:
    try:
        d = extract_weibo(url, browser=browser)
    except Exception:
        return False

    outtmpl = os.path.join(DOWNLOAD_DIR, f"{task_id}.%(ext)s")
    opts = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "http_headers": WEIBO_HEADERS,
    }
    _apply_proxy_opts(opts, url)
    if FFMPEG_LOCATION:
        opts["ffmpeg_location"] = FFMPEG_LOCATION
    try:
        _run_ytdlp(opts, task_id, {"url": d["video_url"], "download": True})
        if is_cancel_requested(task_id):
            _cleanup_partial(task_id)
            update_task(task_id, status="cancelled", speed=None, eta=None)
            return True
        _finalize_download(task_id, title, d.get("title"))
        return True
    except Exception:
        _cleanup_partial(task_id)
        return False


def download_video(
    url: str,
    format_id: str | None,
    task_id: str,
    title: str | None = None,
    browser: str | None = None,
) -> None:
    """后台执行：下载视频到本地，结束后在内存任务表登记文件路径。"""
    if is_cancel_requested(task_id):
        update_task(task_id, status="cancelled")
        clear_task_controls(task_id)
        return

    try:
        url = normalize_url(url)
    except ValueError as e:
        _handle_download_error(task_id, e)
        clear_task_controls(task_id)
        return

    if is_weibo_url(url):
        if _download_weibo(url, task_id, title, browser):
            clear_task_controls(task_id)
            return

    download_url = url
    if is_douyin_url(url):
        if _download_douyin(url, task_id, title):
            clear_task_controls(task_id)
            return
        fallback = _douyin_ytdlp_url(url, browser)
        if fallback:
            download_url = fallback
        else:
            try:
                resolve_douyin_url(url)
            except ValueError as e:
                _handle_download_error(task_id, e)
                clear_task_controls(task_id)
                return
            _handle_download_error(
                task_id,
                ValueError("抖音解析失败，请换用完整视频链接或提供浏览器 Cookie 后重试。"),
            )
            clear_task_controls(task_id)
            return

    if _is_x_url(url):
        if _download_x(url, task_id, title, browser):
            clear_task_controls(task_id)
            return
        _handle_download_error(
            task_id,
            ValueError(
                "X 视频下载失败。请确认链接含视频、代理可用；"
                "若推文受限，请在 x.com 登录后提供 Cookie 重试。"
            ),
        )
        clear_task_controls(task_id)
        return

    if _is_xhs_url(url):
        if _download_xhs(url, task_id, title, browser):
            clear_task_controls(task_id)
            return
        _handle_download_error(
            task_id,
            ValueError(
                "小红书下载失败。请使用 App/网页「分享」复制的完整链接（须含 xsec_token）；"
                "若提示 token 过期，请重新分享。通常无需登录或导出 Cookie。"
            ),
        )
        clear_task_controls(task_id)
        return

    if _is_iqiyi_url(url):
        if _download_iqiyi(url, task_id, title, format_id, browser):
            clear_task_controls(task_id)
            return
        _handle_download_error(
            task_id,
            ValueError(
                "爱奇艺下载失败。请在 iqiyi.com 登录后导出 cookies.txt 到 backend/cookies.txt，"
                "或勾选「读取浏览器登录态」后重试。"
            ),
        )
        clear_task_controls(task_id)
        return

    if _is_bilibili_url(url):
        if _download_bilibili(url, task_id, title, format_id, browser):
            clear_task_controls(task_id)
            return

    outtmpl = os.path.join(DOWNLOAD_DIR, f"{task_id}.%(ext)s")
    tiktok_dl = is_tiktok_url(download_url)
    default_fmt = _TIKTOK_YTDLP_FORMAT if tiktok_dl else "bestvideo+bestaudio/best"

    def _run(use_browser: str | None, clients: list | None = None) -> dict:
        opts = {
            "format": format_id or default_fmt,
            "outtmpl": outtmpl,
            "merge_output_format": "mp4",
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "socket_timeout": 30,
        }
        if FFMPEG_LOCATION:
            opts["ffmpeg_location"] = FFMPEG_LOCATION
        _apply_pot_provider(opts)
        _apply_player_clients(opts, clients)
        _apply_js_runtime(opts)
        _apply_http_headers(opts, download_url)
        _apply_proxy_opts(opts, download_url)
        _apply_cookies(opts, use_browser)
        return _run_ytdlp(opts, task_id, {"url": download_url, "download": True})

    try:
        try:
            info = _run(browser)
        except Exception as e:  # noqa: BLE001
            info = _recover(_run, browser, e)
        info = _first_entry(info)
        if is_cancel_requested(task_id):
            _cleanup_partial(task_id)
            update_task(task_id, status="cancelled", speed=None, eta=None)
            return
        _finalize_download(
            task_id, title, info.get("title"), normalize_h264=tiktok_dl
        )
    except Exception as e:  # noqa: BLE001
        _handle_download_error(task_id, e)
    finally:
        clear_task_controls(task_id)
