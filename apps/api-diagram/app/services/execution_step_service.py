"""Execution-step aggregation for Agent Harness observability."""

from __future__ import annotations

from datetime import datetime
from typing import Any


DIAGRAM_AGENT_NAMES = {
    "excalidraw": "excalidraw_agent",
    "mermaid": "mermaid_agent",
    "flow": "flow_agent",
    "mindmap": "mindmap_agent",
    "charts": "charts_agent",
    "drawio": "drawio_agent",
    "infographic": "infographic_agent",
}

STEP_SPAN_NAMES = {
    "router": {"router"},
    "planner": {"planner_agent"},
    "knowledge": {"knowledge_agent"},
    "designer": {"design_agent"},
    "validator": {"validator_agent"},
    "repair": {"repair_agent"},
    "consistency": {"consistency_agent"},
    "export": {"export_agent"},
}

AUDIT_EVENT_TO_STEP = {
    "runtime.guard.evaluated": "router",
    "tenant.budget.evaluated": "router",
    "planner.plan.created": "planner",
    "knowledge.retrieve": "knowledge",
    "design.output.optimized": "designer",
    "validator.output.checked": "validator",
    "repair.output.checked": "repair",
    "consistency.knowledge.checked": "consistency",
    "export.plan.created": "export",
}

TOOL_PREFIX_TO_STEP = {
    "planner.": "planner",
    "knowledge.": "knowledge",
    "design.": "designer",
    "validator.": "validator",
    "repair.": "repair",
    "consistency.": "consistency",
    "export.": "export",
}


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _iso_min(values: list[Any]) -> str | None:
    parsed = [item for item in (_parse_datetime(value) for value in values) if item]
    return min(parsed).isoformat() if parsed else None


def _iso_max(values: list[Any]) -> str | None:
    parsed = [item for item in (_parse_datetime(value) for value in values) if item]
    return max(parsed).isoformat() if parsed else None


def _step_for_tool(tool_name: str) -> str:
    for prefix, step_id in TOOL_PREFIX_TO_STEP.items():
        if tool_name.startswith(prefix):
            return step_id
    return ""


def _tool_summary(tool_call: dict[str, Any]) -> dict[str, Any]:
    return {
        "tool_name": tool_call.get("tool_name", ""),
        "status": tool_call.get("status", "unknown"),
        "input_summary": tool_call.get("input_summary", ""),
        "output_summary": tool_call.get("output_summary", ""),
        "error": tool_call.get("error") or tool_call.get("error_message", ""),
    }


def _event_summary(raw_event: dict[str, Any]) -> dict[str, Any]:
    return {
        "event_type": raw_event.get("type") or raw_event.get("event_type", ""),
        "severity": raw_event.get("severity", "info"),
        "message": raw_event.get("message", ""),
    }


def _status_from_inputs(
    *,
    base_status: str,
    spans: list[dict[str, Any]],
    audit_events: list[dict[str, Any]],
    validation_events: list[dict[str, Any]],
    tool_calls: list[dict[str, Any]],
) -> str:
    if any(span.get("status") == "failed" for span in spans):
        return "failed"
    if any(call.get("status") == "failed" for call in tool_calls):
        return "failed"
    if validation_events and any(not event.get("ok") for event in validation_events):
        return "failed"
    if spans or audit_events or tool_calls or validation_events:
        return "succeeded"
    if base_status in {"succeeded", "failed", "skipped", "needs_user_input"}:
        return base_status
    return "pending"


def _span_names_for_step(step: dict[str, Any]) -> set[str]:
    step_id = str(step.get("id") or "")
    if step_id == "chart":
        engine = str((step.get("metadata") or {}).get("engine_type") or step.get("agent") or "")
        return {DIAGRAM_AGENT_NAMES.get(engine, f"{engine}_agent")}
    return set(STEP_SPAN_NAMES.get(step_id, set()))


def build_execution_steps(
    *,
    execution_plan: list[dict[str, Any]],
    trace_spans: list[dict[str, Any]],
    validation_events: list[dict[str, Any]],
    audit_events: list[dict[str, Any]],
    tool_calls: list[dict[str, Any]],
    final_status: str,
) -> list[dict[str, Any]]:
    """Merge plan, trace spans, audit events and tool calls into stable steps."""

    audit_by_step: dict[str, list[dict[str, Any]]] = {}
    for raw_event in audit_events:
        event_type = raw_event.get("type") or raw_event.get("event_type") or ""
        step_id = AUDIT_EVENT_TO_STEP.get(event_type)
        if step_id:
            audit_by_step.setdefault(step_id, []).append(raw_event)

    tools_by_step: dict[str, list[dict[str, Any]]] = {}
    for tool_call in tool_calls:
        step_id = _step_for_tool(str(tool_call.get("tool_name") or ""))
        if step_id:
            tools_by_step.setdefault(step_id, []).append(tool_call)

    steps: list[dict[str, Any]] = []
    for index, step in enumerate(execution_plan):
        step_id = str(step.get("id") or f"step_{index + 1}")
        span_names = _span_names_for_step(step)
        matching_spans = [
            span
            for span in trace_spans
            if str(span.get("name") or "") in span_names
        ]
        step_validation_events = validation_events if step_id == "validator" else []
        step_audit_events = audit_by_step.get(step_id, [])
        step_tool_calls = tools_by_step.get(step_id, [])
        duration_ms = round(sum(float(span.get("duration_ms") or 0.0) for span in matching_spans), 3)
        status = _status_from_inputs(
            base_status=str(step.get("status") or "pending"),
            spans=matching_spans,
            audit_events=step_audit_events,
            validation_events=step_validation_events,
            tool_calls=step_tool_calls,
        )
        if final_status == "failed" and status == "pending":
            status = "skipped"

        errors = []
        for span in matching_spans:
            if span.get("status") == "failed":
                errors.append(str((span.get("attributes") or {}).get("data.error") or "span_failed"))
        for tool_call in step_tool_calls:
            if tool_call.get("status") == "failed":
                errors.append(str(tool_call.get("error") or tool_call.get("error_message") or "tool_failed"))
        for validation in step_validation_events:
            if not validation.get("ok"):
                errors.extend(str(error) for error in validation.get("errors") or [])

        started_at = _iso_min([span.get("started_at") for span in matching_spans])
        ended_at = _iso_max([span.get("ended_at") for span in matching_spans])
        steps.append(
            {
                "id": step_id,
                "label": step.get("label", ""),
                "agent": step.get("agent", ""),
                "phase": step.get("phase", ""),
                "status": status,
                "started_at": started_at,
                "ended_at": ended_at,
                "duration_ms": duration_ms,
                "error": "; ".join(error for error in errors if error)[:500],
                "metadata": {
                    **(step.get("metadata") or {}),
                    "span_ids": [span.get("span_id") for span in matching_spans],
                    "span_names": [span.get("name") for span in matching_spans],
                    "trace_duration_ms": duration_ms,
                    "audit_events": [_event_summary(event) for event in step_audit_events],
                    "tool_calls": [_tool_summary(call) for call in step_tool_calls],
                    "validation_events": step_validation_events,
                },
            }
        )

    return steps
