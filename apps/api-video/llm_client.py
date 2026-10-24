"""LLM 客户端：OpenAI 兼容接口，支持 DeepSeek / 百炼 DashScope / 硅基流动。

- 全部走环境变量，Key 不入库。
- trust_env=False，避免海外代理误路由国内 API。
- LLM_PROVIDER：deepseek | dashscope | siliconflow（可省略，按 Key 自动推断）
"""
import json
import os
import re
from typing import Optional

LLM_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "120"))
LLM_MAX_RETRIES = int(os.environ.get("LLM_MAX_RETRIES", "2"))

VISION_MODEL_DEFAULT = "qwen-plus"
VISION_MODEL = os.environ.get("VISION_MODEL", VISION_MODEL_DEFAULT)

_PROVIDERS = {
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "keys": ("DEEPSEEK_API_KEY", "LLM_API_KEY"),
    },
    "dashscope": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
        "keys": ("DASHSCOPE_API_KEY", "LLM_API_KEY"),
    },
    "siliconflow": {
        "base_url": "https://api.siliconflow.cn/v1",
        "model": "deepseek-ai/DeepSeek-V4-Pro",
        "keys": ("LLM_API_KEY", "SILICONFLOW_API_KEY"),
    },
}


class LLMConfigError(RuntimeError):
    """未配置 API Key 等导致无法调用大模型。"""


_client = None
_client_sig: tuple[str, str, str] | None = None


def _first_env(*names: str) -> Optional[str]:
    for name in names:
        val = (os.environ.get(name) or "").strip()
        if val:
            return val
    return None


def get_llm_provider() -> str:
    explicit = (os.environ.get("VIDEO_LLM_PROVIDER") or os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if explicit:
        return explicit
    if (os.environ.get("VIDEO_LLM_BASE_URL") or os.environ.get("LLM_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or "").strip():
        return "custom"
    if _first_env("DEEPSEEK_API_KEY"):
        return "deepseek"
    if _first_env("DASHSCOPE_API_KEY") and not _first_env("SILICONFLOW_API_KEY"):
        return "dashscope"
    return "siliconflow"


def get_llm_api_key() -> Optional[str]:
    # 优先视频模块专属或通用大模型 Key 环境变量（兼容 SmartDiagram 根 .env）
    generic = _first_env("VIDEO_LLM_API_KEY", "LLM_API_KEY", "OPENAI_API_KEY", "OPENAI_COMPATIBLE_API_KEY")
    if generic:
        return generic
    provider = get_llm_provider()
    if provider in _PROVIDERS:
        cfg = _PROVIDERS[provider]
        return _first_env(*cfg["keys"])
    return _first_env("DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "SILICONFLOW_API_KEY")


def get_llm_base_url() -> str:
    override = _first_env("VIDEO_LLM_BASE_URL", "LLM_BASE_URL", "OPENAI_BASE_URL", "OPENAI_COMPATIBLE_BASE_URL")
    if override:
        return override.rstrip("/")
    provider = get_llm_provider()
    if provider in _PROVIDERS:
        return _PROVIDERS[provider]["base_url"]
    return "https://api.openai.com/v1"


def get_llm_model() -> str:
    override = _first_env("VIDEO_LLM_MODEL", "LLM_MODEL", "MODEL_ID", "OPENAI_COMPATIBLE_MODEL")
    if override:
        return override
    provider = get_llm_provider()
    if provider in _PROVIDERS:
        return _PROVIDERS[provider]["model"]
    return "gemini-2.5-flash"


# 兼容旧 import
LLM_BASE_URL = get_llm_base_url()
LLM_MODEL = get_llm_model()


def _get_client():
    """懒加载 OpenAI 兼容客户端。"""
    global _client, _client_sig
    provider = get_llm_provider()
    api_key = get_llm_api_key()
    base_url = get_llm_base_url()
    sig = (provider, api_key or "", base_url)
    if _client is not None and _client_sig == sig:
        return _client
    if not api_key:
        raise LLMConfigError(
            "未配置大模型 API Key。可在 local.env 中设置 LLM_API_KEY（或 DEEPSEEK_API_KEY / DASHSCOPE_API_KEY）。"
            "修改后请重启后端服务。"
        )
    try:
        import httpx
        from openai import OpenAI
    except ImportError as e:  # noqa: BLE001
        raise LLMConfigError(
            "缺少依赖 openai/httpx，请先 pip install -r requirements.txt。"
        ) from e

    http_client = httpx.Client(trust_env=False, timeout=httpx.Timeout(LLM_TIMEOUT))
    _client = OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=LLM_TIMEOUT,
        max_retries=LLM_MAX_RETRIES,
        http_client=http_client,
    )
    _client_sig = sig
    return _client


def is_configured() -> bool:
    return bool(get_llm_api_key())


def is_vision_model_configured() -> bool:
    return is_configured() and bool((VISION_MODEL or "").strip())


def get_vision_model() -> str:
    explicit = (os.environ.get("VISION_MODEL") or "").strip()
    if explicit:
        return explicit
    if get_llm_provider() == "custom":
        return get_llm_model()
    return (VISION_MODEL or VISION_MODEL_DEFAULT).strip()


def chat_vision(
    messages: list,
    *,
    model: Optional[str] = None,
    temperature: float = 0.2,
    max_tokens: int = 1024,
) -> str:
    vision_model = (model or get_vision_model()).strip()
    if not vision_model:
        raise LLMConfigError("未配置 VISION_MODEL。")
    return chat(
        messages,
        model=vision_model,
        temperature=temperature,
        max_tokens=max_tokens,
    )


def chat(
    messages: list,
    *,
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> str:
    client = _get_client()
    resp = client.chat.completions.create(
        model=model or get_llm_model(),
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return (resp.choices[0].message.content or "").strip()


def chat_stream(
    messages: list,
    *,
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 4096,
):
    """流式调用大模型，逐块 yield 文本增量 (delta)。"""
    client = _get_client()
    stream = client.chat.completions.create(
        model=model or get_llm_model(),
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = getattr(chunk.choices[0].delta, "content", None)
        if delta:
            yield delta


def _repair_json_text(raw: str) -> str:
    """修补模型 JSON 里常见语法问题（尾随逗号等）。"""
    text = raw.strip()
    # 去掉对象/数组结尾前的多余逗号
    text = re.sub(r",\s*}", "}", text)
    text = re.sub(r",\s*]", "]", text)
    return text


def _extract_json(text: str):
    if not text:
        raise ValueError("模型返回为空")
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fenced.group(1).strip() if fenced else text.strip()
    attempts: list[str] = [candidate]
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start != -1 and end != -1 and end > start:
        attempts.append(candidate[start : end + 1])
    last_err: json.JSONDecodeError | None = None
    for raw in attempts:
        for variant in (raw, _repair_json_text(raw)):
            try:
                return json.loads(variant)
            except json.JSONDecodeError as e:
                last_err = e
                continue
    if last_err is not None:
        raise ValueError(f"无法从模型输出解析 JSON：{last_err}") from last_err
    raise ValueError("无法从模型输出解析 JSON")


def chat_json(
    messages: list,
    *,
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 4096,
):
    text = chat(
        messages, model=model, temperature=temperature, max_tokens=max_tokens
    )
    try:
        return _extract_json(text)
    except ValueError:
        # 模型偶发输出非法 JSON，再要一次纯 JSON
        retry_messages = list(messages) + [
            {"role": "assistant", "content": text[:8000]},
            {
                "role": "user",
                "content": (
                    "你上一轮的输出不是合法 JSON（可能有未转义引号或多余逗号）。"
                    "请只输出修正后的完整 JSON 对象，不要 markdown 围栏或其它说明。"
                ),
            },
        ]
        text2 = chat(
            retry_messages,
            model=model,
            temperature=0.1,
            max_tokens=max_tokens,
        )
        return _extract_json(text2)
