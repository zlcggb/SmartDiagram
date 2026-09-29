"""Per-analysis model selection and token accounting for recruit AI calls.

A run is scoped to the current asyncio task (and tasks it spawns), so OCR, rubric and
evaluation calls made deep inside the services are attributed to the analysis that
triggered them without threading extra parameters through every layer.
"""

from __future__ import annotations

import os
import re
from contextvars import ContextVar
from typing import Any

MODEL_ROLES: dict[str, str] = {
    "screening": "TALENT_EVAL_MODEL",
    "rubric": "TALENT_RUBRIC_MODEL",
    "ocr": "RESUME_OCR_MODEL",
}
_IMAGE_TOKEN_ESTIMATE = 1000
_RUN: ContextVar[dict[str, Any] | None] = ContextVar("recruit_ai_run", default=None)


def begin_ai_run(models: dict[str, str] | None = None) -> None:
    _RUN.set({"models": {role: value for role, value in (models or {}).items() if value}, "calls": []})


def role_model(role: str) -> str | None:
    """Tenant setting for this run, then the role's env var; None falls back to MODEL_ID."""

    run = _RUN.get()
    return ((run or {}).get("models") or {}).get(role) or os.getenv(MODEL_ROLES[role]) or None


def with_usage(llm: Any) -> Any:
    """OpenAI-compatible streams only report token usage when explicitly asked to."""

    if "stream_usage" in type(llm).model_fields:
        llm.stream_usage = True
    return llm


def add_usage(total: dict[str, int] | None, usage: Any) -> dict[str, int] | None:
    if not usage:
        return total
    total = dict(total or {})
    for key in ("input_tokens", "output_tokens", "total_tokens"):
        total[key] = total.get(key, 0) + int(usage.get(key) or 0)
    return total


def _estimate_tokens(text: str) -> int:
    cjk = len(re.findall(r"[\u3000-\u9fff\uff00-\uffef]", text or ""))
    return cjk + max(0, len(text or "") - cjk) // 4


def record_usage(
    role: str,
    llm: Any,
    usage: dict[str, int] | None,
    *,
    prompt_text: str = "",
    output_text: str = "",
    images: int = 0,
) -> None:
    run = _RUN.get()
    if run is None:
        return
    if usage and (usage.get("input_tokens") or usage.get("output_tokens")):
        input_tokens, output_tokens, estimated = int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0), False
    else:
        input_tokens = _estimate_tokens(prompt_text) + images * _IMAGE_TOKEN_ESTIMATE
        output_tokens, estimated = _estimate_tokens(output_text), True
    run["calls"].append({
        "role": role,
        "model": str(getattr(llm, "model_name", None) or getattr(llm, "model", None) or ""),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "estimated": estimated,
    })


def usage_summary() -> dict[str, Any] | None:
    run = _RUN.get()
    calls = list((run or {}).get("calls") or [])
    if not calls:
        return None
    return {
        "input_tokens": sum(call["input_tokens"] for call in calls),
        "output_tokens": sum(call["output_tokens"] for call in calls),
        "total_tokens": sum(call["total_tokens"] for call in calls),
        "estimated": any(call["estimated"] for call in calls),
        "calls": calls,
    }
