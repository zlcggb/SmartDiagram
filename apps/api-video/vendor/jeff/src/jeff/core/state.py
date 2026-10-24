"""Render state as text: key/value lines for objects, item lines for arrays, JSON for nested values."""

from __future__ import annotations

import json
from typing import Any

STATE_FORMATS = ("kv", "json", "values")


def serialize_state(state: Any, fmt: str = "kv") -> str:
    if fmt not in STATE_FORMATS:
        raise ValueError(f"state format must be one of {STATE_FORMATS}, got {fmt!r}")
    if isinstance(state, str):
        return state
    if fmt == "json" and isinstance(state, (dict, list)):
        return json.dumps(state, ensure_ascii=False, indent=None)
    if isinstance(state, dict):
        if fmt == "values":
            return "\n".join(_scalar(v) for v in state.values())
        return "\n".join(f"{k}: {_scalar(v)}" for k, v in state.items())
    if isinstance(state, list):
        return "\n".join(_scalar(v) for v in state)
    return _scalar(state)


def _scalar(v: Any) -> str:
    if isinstance(v, str):
        return v
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
