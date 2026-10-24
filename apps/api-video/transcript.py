"""转写来源层：优先抓平台字幕，无字幕时下载音频用 faster-whisper 本地转写。

返回统一的带时间戳分段：[{"start": float秒, "end": float秒, "text": str}, ...]

本模块为新增文件，复用 downloader/bilibili 中已存在的辅助函数（仅 import，不修改），
遵循开闭原则。
"""
import glob
import os
import re
import subprocess

# HuggingFace 模型下载镜像（faster-whisper 首次会从 HF 拉模型）。
# 国内直连 huggingface.co 常失败，默认走 hf-mirror；用户可用 HF_ENDPOINT 覆盖。
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

from yt_dlp import YoutubeDL

# 复用既有下载器的网络/cookie/ffmpeg 辅助（不修改其逻辑）
from downloader import (
    DOWNLOAD_DIR,
    FFMPEG_LOCATION,
    _apply_cookies,
    _apply_http_headers,
    _apply_js_runtime,
    _apply_player_clients,
    _apply_pot_provider,
    _apply_proxy_opts,
    _ffmpeg_bin,
    _recover,
)
from url_normalize import (
    is_douyin_url,
    is_weibo_url,
    is_xhs_url,
    normalize_url,
)
from bilibili import (
    DOWNLOAD_HEADERS as BILIBILI_HEADERS,
    _SESSION as BILIBILI_SESSION,
    _api_get as _bili_api_get,
    _warm_session as _bili_warm,
    extract_avid,
    extract_bilibili,
    extract_bvid,
    is_bilibili_url,
)
from douyin import DOWNLOAD_HEADERS as DOUYIN_HEADERS
from douyin import extract_douyin
from iqiyi import DOWNLOAD_HEADERS as IQIYI_HEADERS
from iqiyi import extract_iqiyi, is_iqiyi_url, pick_iqiyi_stream
from x_twmd import DOWNLOAD_HEADERS as X_HEADERS
from x_twmd import extract_x, is_x_url
from xiaohongshu import DOWNLOAD_HEADERS as XHS_HEADERS
from xiaohongshu import extract_xiaohongshu
from weibo import DOWNLOAD_HEADERS as WEIBO_HEADERS
from weibo import extract_weibo
from summary_tasks import ensure_not_cancelled

# 字幕语言优先级（中文优先，其次英文）
SUBTITLE_LANGS = [
    "zh-Hans",
    "zh-CN",
    "zh-Hant",
    "zh",
    "zh-TW",
    "en",
    "en-US",
    "en-GB",
]

# 本地 Whisper：显式 local 模式用 WHISPER_MODEL；云端失败兜底用更小更快的 WHISPER_FALLBACK_MODEL
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_FALLBACK_MODEL = os.environ.get("WHISPER_FALLBACK_MODEL", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

_whisper_model = None
_whisper_fallback_model = None


class TranscriptError(RuntimeError):
    """转写失败（无字幕且音频转写也失败）。"""


# ---------------------------------------------------------------------------
# 字幕解析（VTT / SRT）
# ---------------------------------------------------------------------------

_TS_RE = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})"
)
_TAG_RE = re.compile(r"<[^>]+>")


def _ts_to_seconds(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000.0


def parse_subtitle_file(path: str) -> list:
    """解析 VTT/SRT 字幕文件为带时间戳分段，去重相邻重复文本（自动字幕常见）。"""
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    segments = []
    blocks = re.split(r"\n\s*\n", content)
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        ts_line = None
        text_lines = []
        for ln in lines:
            if _TS_RE.search(ln):
                ts_line = ln
                continue
            if ln.strip().upper() == "WEBVTT":
                continue
            if ln.strip().isdigit() and ts_line is None:
                continue  # SRT 序号行
            if ts_line is not None:
                text_lines.append(ln)
        if ts_line is None:
            continue
        m = _TS_RE.search(ts_line)
        start = _ts_to_seconds(m.group(1), m.group(2), m.group(3), m.group(4))
        end = _ts_to_seconds(m.group(5), m.group(6), m.group(7), m.group(8))
        text = " ".join(text_lines)
        text = _TAG_RE.sub("", text)  # 去掉 <c>/<00:00:00.000> 等内联标签
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        if segments and segments[-1]["text"] == text:
            segments[-1]["end"] = end  # 合并自动字幕重复行
            continue
        segments.append({"start": start, "end": end, "text": text})
    return segments


# ---------------------------------------------------------------------------
# 字幕抓取（yt-dlp）
# ---------------------------------------------------------------------------


def _pick_best_subtitle(prefix: str) -> str | None:
    """在已下载的字幕文件中按语言优先级挑选最合适的一个。"""
    files = glob.glob(os.path.join(DOWNLOAD_DIR, f"{prefix}*.vtt")) + glob.glob(
        os.path.join(DOWNLOAD_DIR, f"{prefix}*.srt")
    )
    if not files:
        return None

    def score(path: str) -> int:
        name = os.path.basename(path).lower()
        for i, lang in enumerate(SUBTITLE_LANGS):
            if f".{lang.lower()}." in name:
                return i
        return len(SUBTITLE_LANGS) + 1

    files.sort(key=score)
    return files[0]


def fetch_subtitles(url: str, browser: str | None, work_id: str) -> list | None:
    """用 yt-dlp 抓取平台字幕（含自动字幕），成功返回分段，无字幕返回 None。"""
    url = normalize_url(url)
    low = url.lower()
    if "youtube.com" in low or "youtu.be" in low:
        from youtube_subtitles import fetch_youtube_subtitles

        yt_subs = fetch_youtube_subtitles(url, browser)
        if yt_subs:
            return yt_subs

    prefix = f"sub_{work_id}"
    outtmpl = os.path.join(DOWNLOAD_DIR, f"{prefix}.%(ext)s")

    def _run(use_browser: str | None, clients: list | None = None) -> dict:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            "socket_timeout": 30,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": SUBTITLE_LANGS,
            "subtitlesformat": "vtt/srt/best",
            "outtmpl": outtmpl,
        }
        _apply_pot_provider(opts)
        _apply_player_clients(opts, clients)
        _apply_js_runtime(opts)
        _apply_http_headers(opts, url)
        _apply_proxy_opts(opts, url)
        _apply_cookies(opts, use_browser)
        with YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=True)

    try:
        try:
            _run(browser)
        except Exception as e:  # noqa: BLE001
            _recover(_run, browser, e)
    except Exception:  # noqa: BLE001
        # 字幕抓取失败不致命，交给音频转写兜底
        return None

    path = _pick_best_subtitle(prefix)
    if not path:
        return None
    try:
        segments = parse_subtitle_file(path)
    finally:
        _cleanup(prefix)
    return segments or None


# ---------------------------------------------------------------------------
# 音频下载 + 本地 Whisper 转写
# ---------------------------------------------------------------------------


def _to_wav(src: str, work_id: str) -> str:
    """用 ffmpeg 转成 16k 单声道 wav，保证 Whisper 兼容性。"""
    out = os.path.join(DOWNLOAD_DIR, f"audio_{work_id}.wav")
    cmd = [
        _ffmpeg_bin(),
        "-y",
        "-i",
        src,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        out,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out


def _download_bilibili_audio(url: str, browser: str | None, work_id: str) -> str:
    """B 站走 DASH audio_url 直链下载（比下整段视频轻量）。"""
    import requests

    from platform_cookies import get_anonymous_cookie_file, prepare_session_cookies

    last_err: Exception | None = None
    audio_urls: list[str] = []
    for attempt in range(2):
        try:
            data = extract_bilibili(url, browser=browser)
            audio_urls = list(data.get("audio_urls") or [])
            if not audio_urls and data.get("audio_url"):
                audio_urls = [data["audio_url"]]
            if audio_urls:
                break
            raise TranscriptError("B 站未返回独立音频流。")
        except (ValueError, TranscriptError) as e:
            last_err = e
            if attempt == 0:
                get_anonymous_cookie_file(refresh=True)
                prepare_session_cookies(BILIBILI_SESSION, browser)
                continue
            raise TranscriptError(f"B 站解析失败：{e}") from e

    sess = requests.Session()
    sess.trust_env = False
    proxies = {"http": None, "https": None}
    resp = None
    for audio_url in audio_urls:
        try:
            resp = sess.get(
                audio_url,
                headers=BILIBILI_HEADERS,
                stream=True,
                timeout=120,
                proxies=proxies,
            )
            resp.raise_for_status()
            break
        except requests.RequestException as e:
            last_err = e
            resp = None
    if resp is None:
        raise TranscriptError(f"B 站音频下载失败：{last_err}") from last_err

    raw = os.path.join(DOWNLOAD_DIR, f"audio_{work_id}.m4a")
    with open(raw, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1 << 16):
            if chunk:
                f.write(chunk)
    try:
        return _to_wav(raw, work_id)
    finally:
        _safe_remove(raw)


def _download_douyin_audio(url: str, work_id: str) -> str:
    """抖音走分享页 / iteminfo API 直链，采用 4 线程分块并发拉取并缓存原视频。"""
    data = extract_douyin(url)
    play_url = data.get("play_url")
    if not play_url:
        raise TranscriptError("抖音未返回播放地址。")

    raw = os.path.join(DOWNLOAD_DIR, f"audio_{work_id}.mp4")

    # 1. 尝试 4 线程分片并发拉取
    chunked_ok = False
    try:
        from chunked_downloader import download_file_chunked

        chunked_ok = download_file_chunked(
            play_url, raw, headers=DOUYIN_HEADERS, concurrency=4
        )
    except Exception:
        chunked_ok = False

    # 2. 失败降级单流下载
    if not chunked_ok or not os.path.isfile(raw) or os.path.getsize(raw) == 0:
        import requests

        sess = requests.Session()
        sess.trust_env = False
        resp = sess.get(play_url, headers=DOUYIN_HEADERS, stream=True, timeout=120)
        resp.raise_for_status()
        with open(raw, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 16):
                if chunk:
                    f.write(chunk)

    # 3. 登记缓存供后续直接复用，并转为 wav
    try:
        from tasks import register_video_cache

        register_video_cache(url, raw)
    except Exception:
        pass

    try:
        return _to_wav(raw, work_id)
    except Exception as e:
        _safe_remove(raw)
        raise e


def _download_stream_to_wav(
    stream_url: str,
    work_id: str,
    headers: dict,
    *,
    overseas_proxy: bool = False,
) -> str:
    """通用：CDN 直链下载后转 wav（X / 小红书 / 微博等）。"""
    import requests

    from url_normalize import get_system_proxy

    sess = requests.Session()
    if overseas_proxy:
        proxy = get_system_proxy()
        proxies = {"http": proxy, "https": proxy} if proxy else None
        sess.trust_env = bool(proxy)
    else:
        sess.trust_env = False
        proxies = {"http": None, "https": None}
    resp = sess.get(
        stream_url, headers=headers, stream=True, timeout=120, proxies=proxies
    )
    resp.raise_for_status()
    raw = os.path.join(DOWNLOAD_DIR, f"audio_{work_id}.mp4")
    with open(raw, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1 << 16):
            if chunk:
                f.write(chunk)
    try:
        return _to_wav(raw, work_id)
    finally:
        _safe_remove(raw)


def _download_x_audio(url: str, browser: str | None, work_id: str) -> str:
    data = extract_x(url, browser=browser)
    return _download_stream_to_wav(
        data["video_url"], work_id, X_HEADERS, overseas_proxy=True
    )


def _download_xhs_audio(url: str, browser: str | None, work_id: str) -> str:
    data = extract_xiaohongshu(url, browser=browser)
    return _download_stream_to_wav(data["video_url"], work_id, XHS_HEADERS)


def _download_weibo_audio(url: str, browser: str | None, work_id: str) -> str:
    data = extract_weibo(url, browser=browser)
    return _download_stream_to_wav(data["video_url"], work_id, WEIBO_HEADERS)


def _download_iqiyi_audio(url: str, browser: str | None, work_id: str) -> str:
    """爱奇艺：iqiyi.py 拿 dash/m3u8，再 ffmpeg 拉流（与 downloader 同源，不走页面 yt-dlp）。"""
    data = extract_iqiyi(url, browser=browser)
    stream = pick_iqiyi_stream(data, None)
    m3u8_path = None
    try:
        if stream.strip().startswith("#EXTM3U"):
            m3u8_path = os.path.join(DOWNLOAD_DIR, f"aud_{work_id}.m3u8")
            with open(m3u8_path, "w", encoding="utf-8") as f:
                f.write(stream)
            src = m3u8_path
        else:
            src = stream
        wav = os.path.join(DOWNLOAD_DIR, f"audio_{work_id}.wav")
        cmd = [
            _ffmpeg_bin(),
            "-y",
            "-headers",
            f"Referer: {IQIYI_HEADERS['Referer']}\r\n",
            "-i",
            src,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            wav,
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        if not os.path.isfile(wav) or os.path.getsize(wav) < 1000:
            raise TranscriptError("爱奇艺音频下载失败。")
        return wav
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or b"").decode("utf-8", errors="ignore")[-200:]
        raise TranscriptError(f"爱奇艺音频转码失败：{detail or e}") from e
    finally:
        if m3u8_path:
            _safe_remove(m3u8_path)


def _download_ytdlp_audio(url: str, browser: str | None, work_id: str) -> str:
    """通用：yt-dlp 下载 bestaudio，再转 wav。"""
    prefix = f"aud_{work_id}"
    outtmpl = os.path.join(DOWNLOAD_DIR, f"{prefix}.%(ext)s")

    def _run(use_browser: str | None, clients: list | None = None) -> dict:
        opts = {
            "format": "bestaudio/best",
            "outtmpl": outtmpl,
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
        _apply_http_headers(opts, url)
        _apply_proxy_opts(opts, url)
        _apply_cookies(opts, use_browser)
        with YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=True)

    try:
        _run(browser)
    except Exception as e:  # noqa: BLE001
        _recover(_run, browser, e)

    files = glob.glob(os.path.join(DOWNLOAD_DIR, f"{prefix}.*"))
    if not files:
        raise TranscriptError("音频下载失败。")
    src = files[0]
    try:
        return _to_wav(src, work_id)
    finally:
        _safe_remove(src)


def _ensure_hf_direct() -> None:
    """让 HF 模型下载绕过海外代理，直连国内镜像。

    项目启动会设 HTTP_PROXY/HTTPS_PROXY=10808（给海外视频站用）；但 Whisper 模型
    走 hf-mirror（国内站），若经海外代理会连不上并报 "locate file on the Hub" 失败。
    这里把 HF 相关域名加入 NO_PROXY，使 huggingface_hub 的 requests 直连镜像。
    """
    hf_hosts = [
        "huggingface.co",
        "hf-mirror.com",
        ".hf-mirror.com",
        ".huggingface.co",
        "cdn-lfs.hf-mirror.com",
    ]
    for key in ("NO_PROXY", "no_proxy"):
        cur = [h for h in os.environ.get(key, "").split(",") if h]
        for h in hf_hosts:
            if h not in cur:
                cur.append(h)
        os.environ[key] = ",".join(cur)
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def _get_whisper_model(*, fallback: bool = False):
    global _whisper_model, _whisper_fallback_model
    if fallback:
        if _whisper_fallback_model is not None:
            return _whisper_fallback_model
        model_name = WHISPER_FALLBACK_MODEL
        target = "_whisper_fallback_model"
    else:
        if _whisper_model is not None:
            return _whisper_model
        model_name = WHISPER_MODEL
        target = "_whisper_model"

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:  # noqa: BLE001
        raise TranscriptError(
            "缺少 faster-whisper 依赖，请先 pip install -r requirements.txt。"
        ) from e
    _ensure_hf_direct()
    try:
        loaded = WhisperModel(
            model_name, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE
        )
    except Exception as e:  # noqa: BLE001
        raise TranscriptError(
            "语音模型加载失败：首次需要联网从镜像下载 Whisper 模型（"
            f"{model_name}，约数百 MB）。请确认能访问 {os.environ.get('HF_ENDPOINT')}，"
            "或改用更小模型（设 WHISPER_FALLBACK_MODEL=tiny）后重试。"
        ) from e
    if fallback:
        _whisper_fallback_model = loaded
    else:
        _whisper_model = loaded
    return loaded


def transcribe_audio(wav_path: str, *, on_progress=None, fallback: bool = False) -> list:
    """本地 faster-whisper 转写，返回带时间戳分段。"""
    from asr_postprocess import repair_segments_list

    model = _get_whisper_model(fallback=fallback)
    segments_gen, info = model.transcribe(
        wav_path,
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    duration = float(getattr(info, "duration", 0) or 0)
    out = []
    for seg in segments_gen:
        text = (seg.text or "").strip()
        if text:
            out.append({"start": float(seg.start), "end": float(seg.end), "text": text})
        if on_progress and duration > 0:
            on_progress(min(float(seg.end) / duration, 1.0))
    if not out:
        return []
    return repair_segments_list(out)


# ---------------------------------------------------------------------------
# 统一入口
# ---------------------------------------------------------------------------


_BILI_VIEW_API = "https://api.bilibili.com/x/web-interface/view"
_BILI_PLAYER_API = "https://api.bilibili.com/x/player/wbi/v2"
# 字幕语言优先级：人工中文 > AI 中文 > 英文 > 其它
_BILI_SUB_LANG_PRIORITY = ["zh-Hans", "zh-CN", "zh", "zh-Hant", "ai-zh", "en", "ai-en"]


def _browser_bilibili_cookies(browser: str | None) -> dict | None:
    """从指定浏览器读取 B 站登录 Cookie（SESSDATA 等），用于拉取需登录的 CC/AI 字幕。"""
    if not browser:
        return None
    try:
        from yt_dlp.cookies import extract_cookies_from_browser

        jar = extract_cookies_from_browser(browser)
        cookies = {}
        for c in jar:
            if "bilibili.com" in (getattr(c, "domain", "") or ""):
                cookies[c.name] = c.value
        return cookies or None
    except Exception:  # noqa: BLE001
        return None


def _pick_bilibili_subtitle(subtitles: list) -> dict | None:
    if not subtitles:
        return None
    by_lan = {(s.get("lan") or "").lower(): s for s in subtitles}
    for lan in _BILI_SUB_LANG_PRIORITY:
        if lan.lower() in by_lan:
            return by_lan[lan.lower()]
    return subtitles[0]


def fetch_bilibili_subtitles(url: str, browser: str | None) -> list | None:
    """抓取 B 站原生字幕（CC/AI），返回带时间戳分段；无字幕返回 None。

    多数 B 站字幕需登录态，故用浏览器 Cookie 调 player 接口；字幕正文为
    {"body": [{"from": 秒, "to": 秒, "content": "..."}]} 的 JSON。
    """
    import requests
    from asr_postprocess import repair_segments_list

    bvid = extract_bvid(url)
    if not bvid:
        return None
    page_url = f"https://www.bilibili.com/video/{bvid}"
    _bili_warm(page_url)
    try:
        view = _bili_api_get(_BILI_VIEW_API, {"bvid": bvid})
    except Exception:  # noqa: BLE001
        return None
    cid = view.get("cid")
    pages = view.get("pages") or []
    if not cid and pages:
        cid = pages[0].get("cid")
    if not cid:
        return None
    aid = view.get("aid") or extract_avid(url)

    cookies = _browser_bilibili_cookies(browser)
    sess = requests.Session()
    sess.trust_env = False  # B 站直连，勿走海外代理
    params = {"bvid": bvid, "cid": cid}
    if aid:
        params["aid"] = aid
    try:
        resp = sess.get(
            _BILI_PLAYER_API,
            params=params,
            headers={**BILIBILI_HEADERS, "Referer": page_url},
            cookies=cookies,
            timeout=20,
        )
        resp.raise_for_status()
        data = (resp.json() or {}).get("data") or {}
    except Exception:  # noqa: BLE001
        return None

    subtitles = (data.get("subtitle") or {}).get("subtitles") or []
    chosen = _pick_bilibili_subtitle(subtitles)
    if not chosen:
        return None
    sub_url = chosen.get("subtitle_url") or ""
    if sub_url.startswith("//"):
        sub_url = "https:" + sub_url
    if not sub_url:
        return None
    try:
        sresp = sess.get(sub_url, headers=BILIBILI_HEADERS, timeout=30)
        sresp.raise_for_status()
        body = (sresp.json() or {}).get("body") or []
    except Exception:  # noqa: BLE001
        return None

    segments = []
    for it in body:
        text = (it.get("content") or "").strip()
        if not text:
            continue
        segments.append(
            {
                "start": float(it.get("from", 0) or 0),
                "end": float(it.get("to", 0) or 0),
                "text": text,
            }
        )
    return repair_segments_list(segments) or None


def get_transcript(
    url: str,
    browser: str | None,
    work_id: str,
    progress=None,
    prompt: str | None = None,
) -> dict:
    """获取转写：平台字幕 → 云端 ASR → 本地 Whisper。

    返回 {"source": "subtitle"|"cloud_asr"|"asr", "segments": [...]}。
    progress(stage, percent) 可选，用于前端进度条。
    """
    url = normalize_url(url)

    # 自动解析当前视频标题/主题，作为 ASR 先验上下文
    video_title = None
    try:
        if is_douyin_url(url):
            d = extract_douyin(url)
            video_title = d.get("title")
        elif is_bilibili_url(url):
            bvid = extract_bvid(url)
            if bvid:
                view = _bili_api_get(_BILI_VIEW_API, {"bvid": bvid})
                video_title = (view or {}).get("title")
        elif is_xhs_url(url):
            d = extract_xiaohongshu(url, browser=browser)
            video_title = d.get("title")
    except Exception:
        pass

    topic_parts = []
    if video_title and video_title.strip():
        topic_parts.append(video_title.strip())
    if prompt and prompt.strip():
        topic_parts.append(prompt.strip())
    topic_context = " | ".join(topic_parts) if topic_parts else None


    def _report(percent: float, message: str | None = None):
        ensure_not_cancelled(work_id)
        if progress:
            if message is not None:
                progress("transcribing", percent, message)
            else:
                progress("transcribing", percent)

    _report(8)

    # 1) 平台字幕（静默尝试；跳过无外挂字幕流的短视频平台以避免 2~4s 无效 yt-dlp 探测）
    segments = None
    if is_bilibili_url(url):
        try:
            segments = fetch_bilibili_subtitles(url, browser)
        except Exception:  # noqa: BLE001
            segments = None
    if not segments and not (
        is_douyin_url(url) or is_xhs_url(url) or is_weibo_url(url) or is_iqiyi_url(url)
    ):
        try:
            segments = fetch_subtitles(url, browser, work_id)
        except Exception:  # noqa: BLE001
            segments = None
    if segments:
        return _enrich_with_vision(
            {"source": "subtitle", "segments": segments},
            url=url,
            browser=browser,
            work_id=work_id,
            progress=progress,
        )

    _report(18, "正在获取视频字幕…")

    # 2) 优先检查是否已有本地下载完成的视频（或当前正在下载），复用提取音频（0网络等待）
    wav = None
    try:
        from tasks import find_existing_video_file, wait_for_existing_download
        existing_video = find_existing_video_file(url)
        if not existing_video:
            def _sync_progress(pct, spd):
                spd_str = f" ({spd / 1024 / 1024:.1f} MB/s)" if spd else ""
                _report(18, f"正在协同下载中… {pct:.1f}%{spd_str}")

            existing_video = wait_for_existing_download(url, timeout=300.0, on_progress=_sync_progress)
    except Exception:
        existing_video = None

    if existing_video and os.path.isfile(existing_video) and os.path.getsize(existing_video) > 0:
        _report(25, "复用本地视频，正在提取音频…")
        try:
            wav = _to_wav(existing_video, work_id)
            _report(28)
            source, segments = _run_asr_on_wav(
                wav, work_id, progress, topic_context=topic_context
            )
            return _enrich_with_vision(
                {"source": source, "segments": segments},
                url=url,
                browser=browser,
                work_id=work_id,
                progress=progress,
            )
        finally:
            if wav:
                _safe_remove(wav)

    # 3) 无本地缓存 → 走网络下载音频
    try:
        if is_bilibili_url(url):
            wav = _download_bilibili_audio(url, browser, work_id)
        elif is_douyin_url(url):
            try:
                wav = _download_douyin_audio(url, work_id)
            except ValueError as e:
                # 保留 douyin.py 的明确报错（网络 / 失效 / 极少数需 Cookie）
                raise TranscriptError(str(e)) from e
        elif is_iqiyi_url(url):
            try:
                wav = _download_iqiyi_audio(url, browser, work_id)
            except ValueError as e:
                raise TranscriptError(str(e)) from e
        elif is_x_url(url):
            try:
                wav = _download_x_audio(url, browser, work_id)
            except ValueError as e:
                raise TranscriptError(str(e)) from e
        elif is_xhs_url(url):
            try:
                wav = _download_xhs_audio(url, browser, work_id)
            except ValueError as e:
                raise TranscriptError(str(e)) from e
        elif is_weibo_url(url):
            try:
                wav = _download_weibo_audio(url, browser, work_id)
            except ValueError as e:
                raise TranscriptError(str(e)) from e
        else:
            wav = _download_ytdlp_audio(url, browser, work_id)
        _report(28)
        source, segments = _run_asr_on_wav(
            wav, work_id, progress, topic_context=topic_context
        )
        return _enrich_with_vision(
            {"source": source, "segments": segments},
            url=url,
            browser=browser,
            work_id=work_id,
            progress=progress,
        )
    finally:
        if wav:
            _safe_remove(wav)


def _enrich_with_vision(
    transcript: dict,
    *,
    url: str | None = None,
    file_path: str | None = None,
    browser: str | None = None,
    work_id: str,
    progress=None,
) -> dict:
    """方案 A/E：按需画面分析 enrichment。"""
    try:
        from vision_transcript import enrich_transcript_with_vision

        return enrich_transcript_with_vision(
            transcript,
            url=url,
            file_path=file_path,
            browser=browser,
            work_id=work_id,
            progress=progress,
        )
    except Exception as e:
        from vision_transcript import VisionAnalysisError

        if isinstance(e, VisionAnalysisError):
            raise TranscriptError(str(e)) from e
        raise


def get_transcript_from_file(
    file_path: str,
    work_id: str,
    progress=None,
    filename: str = "",
    prompt: str | None = None,
) -> dict:
    """本地上传文件转写：ffmpeg 抽音 → 云端 ASR → Whisper 兜底。"""
    if not os.path.isfile(file_path):
        raise TranscriptError("上传文件不存在或已过期，请重新上传")

    from video_normalize import ensure_h264_mp4

    try:
        file_path = ensure_h264_mp4(file_path)
    except Exception as e:  # noqa: BLE001
        raise TranscriptError(f"视频格式转换失败（HEVC→H.264）：{e}") from e

    topic_parts = []
    fname = filename or os.path.basename(file_path)
    if fname:
        base_name = os.path.splitext(fname)[0]
        if base_name and not base_name.startswith("upload_") and len(base_name) > 2:
            topic_parts.append(base_name)
    if prompt and prompt.strip():
        topic_parts.append(prompt.strip())
    topic_context = " | ".join(topic_parts) if topic_parts else None

    def _report(percent: float):
        ensure_not_cancelled(work_id)
        if progress:
            progress("transcribing", percent)

    _report(8)
    ext = os.path.splitext(file_path)[1].lower()
    wav = None
    delete_wav = False
    try:
        if ext == ".wav":
            wav = file_path
        else:
            wav = _to_wav(file_path, work_id)
            delete_wav = True
        _report(28)
        source, segments = _run_asr_on_wav(
            wav, work_id, progress, topic_context=topic_context
        )
        return _enrich_with_vision(
            {"source": source, "segments": segments},
            file_path=file_path,
            work_id=work_id,
            progress=progress,
        )
    finally:
        if delete_wav and wav:
            _safe_remove(wav)


def _user_asr_hint(err: Exception | None, *, cloud_tried: bool) -> str:
    """给前端展示的转写说明（产品向文案，不要求用户登录）。"""
    if not cloud_tried:
        return "正在本机识别语音（较慢），请稍候…"
    if not err:
        return "未找到视频字幕，正在本机识别语音，请稍候…"
    msg = str(err)
    if "401" in msg:
        return "云端转写鉴权失败，请联系管理员检查 API Key 后重试。"
    if "403" in msg:
        return "云端转写暂不可用（账户或权限），正在本机识别…"
    if "429" in msg:
        return "云端转写繁忙，正在本机识别…"
    if "空" in msg:
        return "云端转写未得到有效结果，正在本机识别…"
    if "HTTP" in msg:
        return f"云端转写暂不可用，正在本机识别…"
    return "正在本机识别语音，请稍候…"


def _format_timestamp(seconds: float) -> str:
    s = int(seconds or 0)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"


def _run_asr_on_wav(
    wav: str,
    work_id: str,
    progress=None,
    topic_context: str | None = None,
) -> tuple[str, list]:
    from cloud_asr import ASR_MODE, is_cloud_asr_available, transcribe_audio as cloud_transcribe
    from llm_client import is_configured

    def _p(stage: str, percent: float | None = None, message: str | None = None, **extra):
        if progress:
            try:
                progress(stage, percent, message, **extra)
            except TypeError:
                if message is not None:
                    progress(stage, percent, message)
                else:
                    progress(stage, percent)

    cloud_tried = False
    cloud_err: Exception | None = None
    if is_cloud_asr_available():
        cloud_tried = True
        _p("transcribing", 30, "未找到平台字幕，正在云端识别语音…")
        try:

            def _cloud_prog(done: int, total: int):
                _p("transcribing", 28 + int(32 * done / max(total, 1)))

            def _on_chunk_done(idx: int, segs: list, all_segs: list):
                fmt_segs = [
                    {
                        "start": int(s.get("start", 0)),
                        "time": _format_timestamp(s.get("start", 0)),
                        "text": s.get("text", ""),
                    }
                    for s in all_segs
                ]
                latest_text = segs[-1]["text"] if segs else ""
                _p(
                    "transcribing",
                    None,
                    f"已转写 {len(all_segs)} 句：{latest_text[:28]}...",
                    partial_transcript=fmt_segs,
                )

            segments = cloud_transcribe(
                wav,
                work_id,
                _cloud_prog,
                topic_context=topic_context,
                on_chunk_done=_on_chunk_done,
            )
            if segments:
                return "cloud_asr", segments
            cloud_err = TranscriptError("云端转写返回空结果")
        except Exception as e:  # noqa: BLE001
            cloud_err = e
            if ASR_MODE == "cloud":
                raise TranscriptError(f"云端转写失败：{e}") from e
    elif is_configured():
        cloud_err = TranscriptError("云端 ASR 未启用（ASR_MODE=local）")
    else:
        cloud_err = None

    hint = _user_asr_hint(cloud_err, cloud_tried=cloud_tried)
    _p("local_asr", 63, hint)

    def _local_prog(ratio: float):
        _p("local_asr", 63 + int(27 * ratio))

    segments = transcribe_audio(wav, on_progress=_local_prog, fallback=True)
    if not segments:
        detail = f"（{cloud_err}）" if cloud_err else ""
        raise TranscriptError(f"语音识别未得到结果{detail}，请换视频或稍后重试。")
    _p("transcribing", 92)
    return "asr", segments


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------


def _safe_remove(path: str) -> None:
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def _cleanup(prefix: str) -> None:
    for f in glob.glob(os.path.join(DOWNLOAD_DIR, f"{prefix}*")):
        _safe_remove(f)
