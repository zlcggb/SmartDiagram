"""Server settings from environment variables (all prefixed JEFF_)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_list(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [x.strip() for x in raw.split(",") if x.strip()]


@dataclass
class Settings:
    backend: str = os.environ.get("JEFF_BACKEND", "torch")
    model_path: str = os.environ.get("JEFF_MODEL", "models/gliformer-large-v1")
    # Aliases preserve the SDK's default model name.
    model_name: str = os.environ.get("JEFF_MODEL_NAME", "gliformer-large-v1")
    model_aliases: list[str] = field(default_factory=lambda: _env_list("JEFF_MODEL_ALIASES") or ["jev-latest", "jev"])
    device: str | None = os.environ.get("JEFF_DEVICE")
    dtype: str | None = os.environ.get("JEFF_DTYPE")
    # GPU backend (see jeff.backends.torch_backend).
    attn_kernel: str = os.environ.get("JEFF_ATTN", "auto")  # auto | flash | eager
    compile_model: bool = os.environ.get("JEFF_COMPILE", "0") == "1"
    compile_mode: str | None = os.environ.get("JEFF_COMPILE_MODE") or None  # e.g. reduce-overhead, max-autotune
    pad_multiple: int = int(os.environ.get("JEFF_PAD_MULTIPLE", "0"))  # 0 = pad to longest only
    warmup: bool = os.environ.get("JEFF_WARMUP", "0") == "1"

    # CPU arm (JEFF_BACKEND=onnx)
    quant: str = os.environ.get("JEFF_QUANT", "fp32")  # fp32 | int8
    onnx_path: str | None = os.environ.get("JEFF_ONNX_PATH") or None
    threads: int | None = int(os.environ.get("JEFF_THREADS", "0")) or None

    # Auth: empty list disables auth (local dev).
    api_keys: list[str] = field(default_factory=lambda: _env_list("JEFF_API_KEYS"))

    # Dynamic batching.
    max_batch: int = int(os.environ.get("JEFF_MAX_BATCH", "16"))
    max_wait_ms: float = float(os.environ.get("JEFF_MAX_WAIT_MS", "5"))
    max_queue: int = int(os.environ.get("JEFF_MAX_QUEUE", "256"))  # beyond this -> 529

    # Per-key rate limit, requests per second (0 disables).
    rate_limit_rps: float = float(os.environ.get("JEFF_RATE_LIMIT_RPS", "0"))
    rate_limit_burst: int = int(os.environ.get("JEFF_RATE_LIMIT_BURST", "20"))

    # Request limits -> 422.
    max_questions: int = int(os.environ.get("JEFF_MAX_QUESTIONS", "64"))
    max_labels_per_question: int = int(os.environ.get("JEFF_MAX_LABELS", "64"))
    max_state_chars: int = int(os.environ.get("JEFF_MAX_STATE_CHARS", "20000"))

    # Prompt rendering (see jeff.core.groups.PromptOptions).
    noul_mode: str = os.environ.get(
        "JEFF_NOUL_MODE", "yes_no"
    )  # single | single_named | yes_no (base checkpoint: single)
    isolate: str = os.environ.get("JEFF_ISOLATE", "nouls")  # none | nouls | all
    state_format: str = os.environ.get("JEFF_STATE_FORMAT", "kv")  # kv | json | values
    # Calibrates probabilities/confidence/noul, not score; 1.0 disables scaling.
    temperature: float = float(os.environ.get("JEFF_TEMPERATURE", "3.2"))

    host: str = os.environ.get("JEFF_HOST", "0.0.0.0")
    port: int = int(os.environ.get("JEFF_PORT", "8000"))
