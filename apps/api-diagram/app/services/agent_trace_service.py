"""OpenTelemetry-style tracing helpers for Agent graph execution."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from app.models.common import utc_now
from app.state.agent_runtime import PermissionContext


_MAX_ATTRIBUTE_TEXT = 240


def _span_id() -> str:
    return uuid4().hex[:16]


def _trace_id() -> str:
    return uuid4().hex


def _iso(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _duration_ms(started_at: str | None, ended_at: str | None) -> float:
    start = _parse_iso(started_at)
    end = _parse_iso(ended_at)
    if not start or not end:
        return 0.0
    return round(max((end - start).total_seconds() * 1000, 0.0), 3)


def _safe_value(value: Any, *, preserve_short_text: bool = False) -> Any:
    """Keep span attributes useful without persisting prompt/output payloads."""

    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        if not preserve_short_text:
            return {
                "type": "string",
                "length": len(value),
            }
        return value[:_MAX_ATTRIBUTE_TEXT]
    if isinstance(value, list | tuple):
        return {
            "type": "list",
            "length": len(value),
        }
    if isinstance(value, dict):
        return {
            "type": "object",
            "keys": sorted(str(key) for key in value.keys())[:20],
        }
    return str(type(value).__name__)


def _event_data_summary(event: dict[str, Any]) -> dict[str, Any]:
    data = event.get("data")
    if not isinstance(data, dict):
        return {}
    summary: dict[str, Any] = {}
    for key in ("input", "output", "chunk", "error"):
        if key in data:
            summary[f"data.{key}"] = _safe_value(
                data.get(key),
                preserve_short_text=(key == "error"),
            )
    return summary


def _span_type(event_name: str) -> str:
    if not event_name.startswith("on_"):
        return "event"
    trimmed = event_name.removeprefix("on_")
    for suffix in ("_start", "_end", "_error"):
        if trimmed.endswith(suffix):
            return trimmed[: -len(suffix)]
    return trimmed


def _is_start_event(event_name: str) -> bool:
    return event_name.endswith("_start")


def _is_end_event(event_name: str) -> bool:
    return event_name.endswith("_end")


def _is_error_event(event_name: str) -> bool:
    return event_name.endswith("_error")


class AgentTraceRecorder:
    """Record LangGraph stream events as OpenTelemetry-compatible spans."""

    def __init__(
        self,
        run_id: str,
        permission_context: PermissionContext,
        conversation_id: str | None = None,
    ):
        self.run_id = run_id
        self.permission_context = permission_context
        self.conversation_id = conversation_id
        self.trace_id = _trace_id()
        self._spans: list[dict[str, Any]] = []
        self._open_by_langgraph_run_id: dict[str, dict[str, Any]] = {}
        self._span_id_by_langgraph_run_id: dict[str, str] = {}

    def observe_langgraph_event(self, event: dict[str, Any]) -> None:
        """Convert one LangGraph event into a span lifecycle update."""

        event_name = str(event.get("event") or "")
        if not event_name:
            return
        if _is_start_event(event_name):
            self._start_span(event)
        elif _is_end_event(event_name):
            self._end_span(event, "succeeded")
        elif _is_error_event(event_name):
            self._end_span(event, "failed")

    def _start_span(self, event: dict[str, Any]) -> None:
        langgraph_run_id = str(event.get("run_id") or "")
        if not langgraph_run_id or langgraph_run_id in self._open_by_langgraph_run_id:
            return

        parent_span_id = None
        for parent_id in reversed(event.get("parent_ids") or []):
            parent_span_id = self._span_id_by_langgraph_run_id.get(str(parent_id))
            if parent_span_id:
                break

        span = {
            "trace_id": self.trace_id,
            "span_id": _span_id(),
            "parent_span_id": parent_span_id,
            "name": str(event.get("name") or _span_type(str(event.get("event") or ""))),
            "span_type": _span_type(str(event.get("event") or "")),
            "status": "running",
            "started_at": _iso(),
            "ended_at": None,
            "duration_ms": 0.0,
            "attributes": {
                "agent_run_id": self.run_id,
                "conversation_id": self.conversation_id,
                "tenant_id": self.permission_context.get("tenant_id") or "local",
                "project_id": self.permission_context.get("project_id"),
                "user_id": self.permission_context.get("user_id") or "anonymous",
                "langgraph.event": event.get("event"),
                "langgraph.name": event.get("name"),
                "langgraph.run_id": langgraph_run_id,
                "langgraph.parent_count": len(event.get("parent_ids") or []),
                **_event_data_summary(event),
            },
        }
        self._open_by_langgraph_run_id[langgraph_run_id] = span
        self._span_id_by_langgraph_run_id[langgraph_run_id] = span["span_id"]
        self._spans.append(span)

    def _end_span(self, event: dict[str, Any], status: str) -> None:
        langgraph_run_id = str(event.get("run_id") or "")
        span = self._open_by_langgraph_run_id.pop(langgraph_run_id, None)
        if not span:
            return
        span["status"] = status
        span["ended_at"] = _iso()
        span["duration_ms"] = _duration_ms(span.get("started_at"), span.get("ended_at"))
        span["attributes"].update(
            {
                "langgraph.end_event": event.get("event"),
                "otel.status_code": "OK" if status == "succeeded" else "ERROR",
                **_event_data_summary(event),
            }
        )

    def finish(self, status: str = "succeeded") -> list[dict[str, Any]]:
        """Close open spans and return JSON-serializable span records."""

        final_status = "succeeded" if status == "succeeded" else "failed"
        for span in list(self._open_by_langgraph_run_id.values()):
            span["status"] = final_status
            span["ended_at"] = _iso()
            span["duration_ms"] = _duration_ms(span.get("started_at"), span.get("ended_at"))
            span["attributes"]["otel.status_code"] = "OK" if final_status == "succeeded" else "ERROR"
            span["attributes"]["closed_by"] = "agent_trace_recorder.finish"
        self._open_by_langgraph_run_id.clear()
        return [dict(span) for span in self._spans]

    def to_audit_event(self, spans: list[dict[str, Any]]) -> dict[str, Any]:
        failed_count = sum(1 for span in spans if span.get("status") == "failed")
        total_duration_ms = round(sum(float(span.get("duration_ms") or 0.0) for span in spans), 3)
        return {
            "type": "agent.trace.completed",
            "actor_user_id": self.permission_context.get("user_id"),
            "tenant_id": self.permission_context.get("tenant_id"),
            "project_id": self.permission_context.get("project_id"),
            "message": "Agent graph trace spans recorded.",
            "metadata": {
                "trace_id": self.trace_id,
                "span_count": len(spans),
                "failed_span_count": failed_count,
                "total_duration_ms": total_duration_ms,
            },
        }
