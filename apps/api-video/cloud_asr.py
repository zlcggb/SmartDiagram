"""云端语音转写：支持百炼 Qwen3-ASR / 硅基流动 SenseVoice（OpenAI 兼容）。

ASR 与 LLM 可分离配置（DeepSeek 总结 + 千问转写）。
"""
import base64
import os
import re
import subprocess

from asr_postprocess import (
    clean_spoken_text,
    repair_segments_list,
    split_sentences_smart,
)
from downloader import DOWNLOAD_DIR, _ffmpeg_bin
from transcript import TranscriptError, _safe_remove

ASR_CHUNK_SECONDS = int(os.environ.get("ASR_CHUNK_SECONDS", "0")) or None
ASR_MAX_MB = int(os.environ.get("ASR_MAX_MB", "45"))
ASR_MODE = os.environ.get("ASR_MODE", "auto").strip().lower()
ASR_PARALLEL = max(1, int(os.environ.get("ASR_PARALLEL", "6")))
ASR_RETRIES = max(1, int(os.environ.get("ASR_RETRIES", "2")))

_SENT_SPLIT = re.compile(
    r"(?<=[。！？!?；;\n])\s*|(?<!\d)(?<![a-zA-Z])\.(?!\d)(?![a-zA-Z])\s*"
)

_ASR_PROVIDERS = {
    "dashscope": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen3-asr-flash",
        "keys": ("DASHSCOPE_API_KEY", "ASR_API_KEY"),
        "chunk_seconds": 280,
        "max_mb": 9,
    },
    "siliconflow": {
        "base_url": "https://api.siliconflow.cn/v1",
        "model": "FunAudioLLM/SenseVoiceSmall",
        "keys": ("SILICONFLOW_API_KEY",),
        "chunk_seconds": 1200,
        "max_mb": 45,
    },
    "gemini": {
        "base_url": "",
        "model": "gemini-3.5-flash-lite",
        "keys": ("ASR_API_KEY", "VIDEO_LLM_API_KEY", "LLM_API_KEY", "OPENAI_API_KEY", "OPENAI_COMPATIBLE_API_KEY"),
        "chunk_seconds": 75,
        "max_mb": 25,
    },
}


def _first_env(*names: str) -> str | None:
    for name in names:
        val = (os.environ.get(name) or "").strip()
        if val:
            return val
    return None


def get_asr_provider() -> str:
    explicit = (os.environ.get("ASR_PROVIDER") or "").strip().lower()
    if explicit in _ASR_PROVIDERS:
        return explicit
    if _first_env("DASHSCOPE_API_KEY"):
        return "dashscope"
    if _first_env("SILICONFLOW_API_KEY"):
        return "siliconflow"
    return "gemini"


def get_asr_api_key() -> str | None:
    cfg = _ASR_PROVIDERS[get_asr_provider()]
    return _first_env(*cfg["keys"])


def get_asr_base_url() -> str:
    override = (os.environ.get("ASR_BASE_URL") or "").strip()
    if override:
        return override.rstrip("/")
    p = get_asr_provider()
    if p == "gemini":
        llm_base = _first_env("VIDEO_LLM_BASE_URL", "LLM_BASE_URL", "OPENAI_BASE_URL", "OPENAI_COMPATIBLE_BASE_URL")
        if llm_base:
            return llm_base.rstrip("/")
        return "https://api.openai.com/v1"
    return _ASR_PROVIDERS[p]["base_url"]


def get_asr_model() -> str:
    override = _first_env("VIDEO_ASR_MODEL", "ASR_MODEL")
    if override:
        return override
    return _ASR_PROVIDERS[get_asr_provider()]["model"]


def _chunk_seconds() -> int:
    if ASR_CHUNK_SECONDS:
        return ASR_CHUNK_SECONDS
    return _ASR_PROVIDERS[get_asr_provider()]["chunk_seconds"]


def _max_chunk_mb() -> int:
    provider_max = _ASR_PROVIDERS[get_asr_provider()]["max_mb"]
    return min(ASR_MAX_MB, provider_max)


def is_cloud_asr_available() -> bool:
    return bool(get_asr_api_key()) and ASR_MODE in ("auto", "cloud")


def _ffprobe_bin() -> str:
    ff = _ffmpeg_bin()
    base = os.path.basename(ff).lower()
    if base.startswith("ffmpeg"):
        probe = ff[: -len(base)] + base.replace("ffmpeg", "ffprobe")
        if os.path.isfile(probe):
            return probe
    return "ffprobe"


def _probe_duration(path: str) -> float:
    cmd = [
        _ffprobe_bin(),
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    try:
        out = subprocess.run(cmd, check=True, capture_output=True, text=True)
        return float((out.stdout or "").strip() or 0)
    except (subprocess.CalledProcessError, ValueError) as e:
        raise TranscriptError("无法读取音频时长。") from e


def _export_mp3_segment(
    src: str, out: str, *, start: float = 0.0, duration: float | None = None
) -> None:
    cmd = [_ffmpeg_bin(), "-y"]
    if start > 0:
        cmd.extend(["-ss", str(start)])
    cmd.extend(["-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k"])
    if duration is not None and duration > 0:
        cmd.extend(["-t", str(duration)])
    cmd.append(out)
    subprocess.run(cmd, check=True, capture_output=True)


def _detect_silence_midpoints(wav_path: str) -> list[float]:
    """用 ffmpeg silencedetect 探测音频中的自然说话停顿中心点（耗时 ~0.3s），失败则安全回退空列表。"""
    cmd = [
        _ffmpeg_bin(),
        "-i",
        wav_path,
        "-vn",
        "-af",
        "silencedetect=noise=-30dB:d=0.25",
        "-f",
        "null",
        "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        stderr = proc.stderr or ""
        starts = [float(x) for x in re.findall(r"silence_start:\s*([0-9.]+)", stderr)]
        ends = [float(x) for x in re.findall(r"silence_end:\s*([0-9.]+)", stderr)]
        return [(s + e) / 2.0 for s, e in zip(starts, ends) if e > s]
    except Exception:
        return []


def _prepare_chunks(wav_path: str, work_id: str) -> list[tuple[str, float, float]]:
    from concurrent.futures import ThreadPoolExecutor

    duration = _probe_duration(wav_path)
    if duration <= 0:
        raise TranscriptError("音频时长为 0。")

    max_bytes = _max_chunk_mb() * 1024 * 1024
    seg_limit = float(_chunk_seconds())
    silence_mids = _detect_silence_midpoints(wav_path) if duration > seg_limit else []
    plan: list[tuple[str, float, float]] = []
    start = 0.0
    idx = 0
    while start < duration - 0.01:
        rem = duration - start
        if rem <= seg_limit:
            seg_dur = rem
        else:
            target_end = start + seg_limit
            win_low = start + seg_limit * 0.65
            win_high = min(duration - 5.0, start + seg_limit + 12.0)
            candidates = [m for m in silence_mids if win_low <= m <= win_high]
            if candidates:
                best_cut = min(candidates, key=lambda m: abs(m - target_end))
                seg_dur = best_cut - start
            else:
                seg_dur = seg_limit

        out = os.path.join(DOWNLOAD_DIR, f"asr_{work_id}_{idx}.mp3")
        end = start + seg_dur
        plan.append((out, start, end))
        start = end
        idx += 1

    def _export_one(item: tuple[str, float, float]) -> tuple[str, float, float]:
        out, s, e = item
        seg_dur = e - s
        _export_mp3_segment(wav_path, out, start=s, duration=seg_dur)
        if os.path.getsize(out) > max_bytes:
            _safe_remove(out)
            raise TranscriptError(
                f"音频切块后超过 {_max_chunk_mb()}MB 上限，请调小 ASR_CHUNK_SECONDS。"
            )
        return item

    workers = min(6, len(plan)) if plan else 1
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_export_one, plan))


def _transcribe_siliconflow(path: str, api_key: str) -> str:
    import httpx
    import time

    url = f"{get_asr_base_url().rstrip('/')}/audio/transcriptions"
    headers = {"Authorization": f"Bearer {api_key}"}
    last_err: Exception | None = None
    for attempt in range(ASR_RETRIES):
        try:
            with open(path, "rb") as f:
                files = {"file": (os.path.basename(path), f, "audio/mpeg")}
                data = {"model": get_asr_model()}
                with httpx.Client(trust_env=False, timeout=httpx.Timeout(600.0)) as client:
                    resp = client.post(url, headers=headers, files=files, data=data)
            if resp.status_code >= 400:
                detail = resp.text[:200] if resp.text else resp.reason_phrase
                raise TranscriptError(f"云端转写 HTTP {resp.status_code}：{detail}")
            body = resp.json() if resp.content else {}
            text = (body.get("text") or "").strip()
            if text:
                return text
            last_err = TranscriptError("云端转写返回空文本")
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt + 1 < ASR_RETRIES:
                time.sleep(1.5 * (attempt + 1))
    raise last_err or TranscriptError("云端转写失败")


def _transcribe_dashscope(path: str, api_key: str) -> str:
    import httpx
    import time

    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    data_uri = f"data:audio/mpeg;base64,{b64}"
    url = f"{get_asr_base_url().rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": get_asr_model(),
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "input_audio", "input_audio": {"data": data_uri}}
                ],
            }
        ],
        "stream": False,
        "extra_body": {"asr_options": {"enable_itn": True}},
    }
    last_err: Exception | None = None
    for attempt in range(ASR_RETRIES):
        try:
            with httpx.Client(trust_env=False, timeout=httpx.Timeout(600.0)) as client:
                resp = client.post(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                detail = resp.text[:240] if resp.text else resp.reason_phrase
                raise TranscriptError(f"千问 ASR HTTP {resp.status_code}：{detail}")
            body = resp.json() if resp.content else {}
            choices = body.get("choices") or []
            if choices:
                text = (choices[0].get("message") or {}).get("content") or ""
                text = text.strip()
                if text:
                    return text
            last_err = TranscriptError("千问 ASR 返回空文本")
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt + 1 < ASR_RETRIES:
                time.sleep(1.5 * (attempt + 1))
    raise last_err or TranscriptError("千问 ASR 失败")


def build_asr_system_prompt(topic_context: str | None = None) -> str:
    """根据视频主题/标题动态构建高精度转写 System Prompt。"""
    base_rules = (
        "你是一位专业的高精度中英双语语音转写与校对专家。\n"
        "请准确转写输入音频中的全部演讲与对话内容，遵循以下最高准则：\n\n"
        "1. 【语言与文字规范（严禁繁体）】：\n"
        "   - 必须 100% 全程输出规范的【简体中文】与标准中文全角标点符号（。！？，、）。\n"
        "   - 严禁在任何段落输出繁体字（正体字）、严禁夹杂任何日文假名或乱码。\n\n"
        "2. 【口音校正与书面级轻度顺滑】：\n"
        "   - 演讲者可能带有地方口音（如平翘舌 z/zh、c/ch、s/sh 混淆，l/n 混淆，前后鼻音混淆，吞音连读）。请结合上下文逻辑校正同音错别字。\n"
        "   - 自动过滤无意义的独立语气废词（如独立的“啊”、“呃”、“嗯”）以及口吃重复字（如“我我”记为“我”、“不仅仅仅”记为“不仅仅”），使句子通顺易读。\n\n"
        "3. 【数字、小数点与专业术语保护】：\n"
        "   - 遇到小数或版本号（如 0.5、9.0、3.11、0到1）必须保持紧凑完整，严禁在小数点处断句或换行。\n"
        "   - 准确识别 AI 与技术领域高频术语并保留标准大小写拼写（如：Agent、RAG、Graph RAG、Embedding、LangChain、LangGraph、MCP、Skills、Deep Agent、Harness、Agent Loop、Claude Code、WorkBuddy、AI Infra、AI RTC、Transformer、Docker、Serverless、SLB、NAT、Python、Java），严禁按发音汉字谐音音译！\n\n"
        "4. 【输出格式】：\n"
        "   - 仅输出准确转写的正文内容，绝不添加任何前言、寒暄、分析或总结说明。"
    )

    clean_ctx = (topic_context or "").strip()
    if not clean_ctx:
        return base_rules

    context_guidance = (
        f"\n\n【本期内容主题与背景指引】：\n"
        f"当前音视频主题/标题为：《{clean_ctx}》。\n"
        f"请基于上述背景与领域，优先激活与本主题相关的垂直行业专业词库，重点精准识别该领域的专业名词与缩写，杜绝按非专业日常字词谐音生拼硬凑。"
    )
    return base_rules + context_guidance


def _transcribe_gemini(path: str, api_key: str, topic_context: str | None = None) -> str:
    import base64
    import httpx
    import time

    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    url = f"{get_asr_base_url().rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    user_prompt = (
        f"请结合主题《{topic_context.strip()}》直接准确转写这段音频（全程必须使用简体中文，保护小数如0.5/9.0不断裂）："
        if topic_context and topic_context.strip()
        else "请直接准确转写这段音频的全部语音内容（全程必须使用简体中文，保护小数如0.5/9.0不断裂）："
    )
    payload = {
        "model": get_asr_model(),
        "messages": [
            {
                "role": "system",
                "content": build_asr_system_prompt(topic_context),
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": user_prompt,
                    },
                    {
                        "type": "input_audio",
                        "input_audio": {"data": b64, "format": "mp3"},
                    },
                ],
            },
        ],
        "temperature": 0.1,
    }
    last_err: Exception | None = None
    for attempt in range(ASR_RETRIES):
        try:
            with httpx.Client(trust_env=False, timeout=httpx.Timeout(120.0), verify=False) as client:
                resp = client.post(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                detail = resp.text[:240] if resp.text else resp.reason_phrase
                raise TranscriptError(f"Gemini ASR HTTP {resp.status_code}：{detail}")
            body = resp.json() if resp.content else {}
            choices = body.get("choices") or []
            if choices:
                text = (choices[0].get("message") or {}).get("content") or ""
                text = clean_spoken_text(text)
                if text:
                    return text
            last_err = TranscriptError("Gemini ASR 返回空文本")
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt + 1 < ASR_RETRIES:
                time.sleep(1.5 * (attempt + 1))
    raise last_err or TranscriptError("Gemini ASR 失败")


def _transcribe_file(path: str, topic_context: str | None = None) -> str:
    api_key = get_asr_api_key()
    if not api_key:
        raise TranscriptError("未配置 ASR API Key。")
    p = get_asr_provider()
    if p == "dashscope":
        return clean_spoken_text(_transcribe_dashscope(path, api_key))
    if p == "gemini":
        return _transcribe_gemini(path, api_key, topic_context=topic_context)
    return clean_spoken_text(_transcribe_siliconflow(path, api_key))


def _text_to_segments(text: str, start: float, end: float) -> list:
    parts = split_sentences_smart(text)
    if not parts:
        return []
    total_chars = sum(len(p) for p in parts) or 1
    span = max(end - start, 1.0)
    segments = []
    cursor = start
    for part in parts:
        seg_len = span * len(part) / total_chars
        segments.append({"start": cursor, "end": cursor + seg_len, "text": part})
        cursor += seg_len
    if segments:
        segments[-1]["end"] = end
    return segments


def transcribe_audio(
    wav_path: str,
    work_id: str,
    progress=None,
    topic_context: str | None = None,
    on_chunk_done=None,
) -> list:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    chunks = _prepare_chunks(wav_path, work_id)
    done = 0

    def _one(item: tuple[int, str, float, float]) -> tuple[int, list]:
        idx, path, start, end = item
        try:
            text = _transcribe_file(path, topic_context=topic_context)
            return idx, _text_to_segments(text, start, end)
        finally:
            _safe_remove(path)

    indexed = [(i, p, s, e) for i, (p, s, e) in enumerate(chunks)]
    workers = min(ASR_PARALLEL, len(indexed)) if indexed else 1
    results: dict[int, list] = {}
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_one, it): it[0] for it in indexed}
            for fut in as_completed(futures):
                idx, segs = fut.result()
                results[idx] = segs
                done += 1
                if on_chunk_done:
                    current_accumulated = []
                    for i in range(len(chunks)):
                        if i in results:
                            current_accumulated.extend(results[i])
                    current_accumulated = repair_segments_list(current_accumulated)
                    try:
                        on_chunk_done(idx, segs, current_accumulated)
                    except Exception:
                        pass
                if progress:
                    progress(done, len(chunks))
        all_segments: list = []
        for i in range(len(chunks)):
            all_segments.extend(results.get(i, []))
        all_segments = repair_segments_list(all_segments)
    except Exception:
        for path, _, _ in chunks:
            _safe_remove(path)
        raise
    return all_segments

