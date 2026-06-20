"""Prometheus exposition helpers for Agent Harness observability."""

from typing import Any

from app.models.audit import AgentRun, AuditEvent


def _escape_label(value: Any) -> str:
    text = str(value or "")
    return text.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _labels(labels: dict[str, Any]) -> str:
    clean = {key: value for key, value in labels.items() if value not in (None, "")}
    if not clean:
        return ""
    label_text = ",".join(f'{key}="{_escape_label(value)}"' for key, value in sorted(clean.items()))
    return f"{{{label_text}}}"


def _sample(name: str, value: int | float, labels: dict[str, Any] | None = None) -> str:
    return f"{name}{_labels(labels or {})} {value}"


def _metric_header(name: str, metric_type: str, help_text: str) -> list[str]:
    return [
        f"# HELP {name} {help_text}",
        f"# TYPE {name} {metric_type}",
    ]


def build_prometheus_metrics(
    *,
    runs: list[AgentRun],
    events: list[AuditEvent],
    budget_snapshot: dict[str, Any],
    approval_summary: dict[str, Any] | None = None,
    queue_health: dict[str, Any] | None = None,
    tenant_id: str,
    project_id: str | None,
) -> str:
    """Build Prometheus text exposition for tenant/project metrics."""

    base_labels = {
        "tenant_id": tenant_id,
        "project_id": project_id or "",
    }
    lines: list[str] = []

    run_counts: dict[tuple[str, str], int] = {}
    input_tokens = 0
    output_tokens = 0
    total_tokens = 0
    estimated_cost = 0.0
    step_counts: dict[tuple[str, str, str], int] = {}
    for run in runs:
        key = (run.status or "unknown", run.engine_type or "unknown")
        run_counts[key] = run_counts.get(key, 0) + 1
        usage = run.token_usage_json or {}
        input_tokens += int(usage.get("estimated_input_tokens") or 0)
        output_tokens += int(usage.get("estimated_output_tokens") or 0)
        total_tokens += int(
            usage.get("estimated_total_tokens")
            or (
                int(usage.get("estimated_input_tokens") or 0)
                + int(usage.get("estimated_output_tokens") or 0)
            )
        )
        estimated_cost += float(run.cost_estimate or 0.0)
        for step in run.execution_steps_json or []:
            step_key = (
                str(step.get("id") or "unknown"),
                str(step.get("phase") or "unknown"),
                str(step.get("status") or "unknown"),
            )
            step_counts[step_key] = step_counts.get(step_key, 0) + 1

    lines.extend(_metric_header("smartdiagram_agent_runs_total", "counter", "Agent runs by status and engine."))
    for (status, engine_type), count in sorted(run_counts.items()):
        lines.append(
            _sample(
                "smartdiagram_agent_runs_total",
                count,
                {**base_labels, "status": status, "engine_type": engine_type},
            )
        )
    if not run_counts:
        lines.append(_sample("smartdiagram_agent_runs_total", 0, {**base_labels, "status": "none", "engine_type": "none"}))

    lines.extend(
        _metric_header(
            "smartdiagram_agent_tokens_estimated_total",
            "counter",
            "Estimated Agent token usage.",
        )
    )
    lines.append(_sample("smartdiagram_agent_tokens_estimated_total", input_tokens, {**base_labels, "token_type": "input"}))
    lines.append(_sample("smartdiagram_agent_tokens_estimated_total", output_tokens, {**base_labels, "token_type": "output"}))
    lines.append(_sample("smartdiagram_agent_tokens_estimated_total", total_tokens, {**base_labels, "token_type": "total"}))

    lines.extend(
        _metric_header(
            "smartdiagram_agent_cost_estimated_total",
            "counter",
            "Estimated Agent cost in configured currency units.",
        )
    )
    lines.append(_sample("smartdiagram_agent_cost_estimated_total", round(estimated_cost, 8), base_labels))

    lines.extend(
        _metric_header(
            "smartdiagram_agent_execution_steps",
            "counter",
            "Agent Harness execution steps by step id, phase and status.",
        )
    )
    for (step_id, phase, status), count in sorted(step_counts.items()):
        lines.append(
            _sample(
                "smartdiagram_agent_execution_steps",
                count,
                {**base_labels, "step_id": step_id, "phase": phase, "status": status},
            )
        )
    if not step_counts:
        lines.append(
            _sample(
                "smartdiagram_agent_execution_steps",
                0,
                {**base_labels, "step_id": "none", "phase": "none", "status": "none"},
            )
        )

    event_type_counts: dict[tuple[str, str], int] = {}
    for event in events:
        key = (event.event_type or "unknown", event.severity or "info")
        event_type_counts[key] = event_type_counts.get(key, 0) + 1

    lines.extend(_metric_header("smartdiagram_audit_events_total", "counter", "Audit events by type and severity."))
    for (event_type, severity), count in sorted(event_type_counts.items()):
        lines.append(
            _sample(
                "smartdiagram_audit_events_total",
                count,
                {**base_labels, "event_type": event_type, "severity": severity},
            )
        )
    if not event_type_counts:
        lines.append(_sample("smartdiagram_audit_events_total", 0, {**base_labels, "event_type": "none", "severity": "none"}))

    approval_summary = approval_summary or {}
    approval_status_type_counts = approval_summary.get("status_type_counts") or {}
    lines.extend(
        _metric_header(
            "smartdiagram_approval_requests",
            "gauge",
            "Human approval requests by status and approval type.",
        )
    )
    if approval_status_type_counts:
        for status, type_counts in sorted(approval_status_type_counts.items()):
            for approval_type, count in sorted((type_counts or {}).items()):
                lines.append(
                    _sample(
                        "smartdiagram_approval_requests",
                        int(count or 0),
                        {**base_labels, "status": status, "approval_type": approval_type},
                    )
                )
    else:
        lines.append(
            _sample(
                "smartdiagram_approval_requests",
                0,
                {**base_labels, "status": "none", "approval_type": "none"},
            )
        )

    lines.extend(
        _metric_header(
            "smartdiagram_approval_oldest_pending_age_seconds",
            "gauge",
            "Age in seconds of the oldest pending human approval request.",
        )
    )
    lines.append(
        _sample(
            "smartdiagram_approval_oldest_pending_age_seconds",
            int(approval_summary.get("oldest_pending_age_seconds") or 0),
            base_labels,
        )
    )

    budget = budget_snapshot.get("budget") or {}
    usage = budget_snapshot.get("usage") or {}
    remaining = budget_snapshot.get("remaining") or {}
    budget_labels = {
        **base_labels,
        "period": budget_snapshot.get("period", ""),
        "scope": budget_snapshot.get("scope", ""),
        "source": usage.get("source", "agent_runs"),
    }
    lines.extend(
        _metric_header(
            "smartdiagram_budget_usage",
            "gauge",
            "Current tenant or project budget usage.",
        )
    )
    lines.append(
        _sample(
            "smartdiagram_budget_usage",
            float(usage.get("estimated_cost") or 0.0),
            {**budget_labels, "resource": "cost"},
        )
    )
    lines.append(
        _sample(
            "smartdiagram_budget_usage",
            int(usage.get("estimated_total_tokens") or 0),
            {**budget_labels, "resource": "tokens"},
        )
    )
    if budget:
        lines.extend(
            _metric_header(
                "smartdiagram_budget_limit",
                "gauge",
                "Configured tenant budget limit.",
            )
        )
        lines.append(
            _sample(
                "smartdiagram_budget_limit",
                float(budget.get("monthly_cost_limit") or 0.0),
                {**budget_labels, "resource": "cost"},
            )
        )
        lines.append(
            _sample(
                "smartdiagram_budget_limit",
                int(budget.get("monthly_token_limit") or 0),
                {**budget_labels, "resource": "tokens"},
            )
        )
    if remaining:
        lines.extend(
            _metric_header(
                "smartdiagram_budget_remaining",
                "gauge",
                "Remaining tenant budget.",
            )
        )
        if remaining.get("cost") is not None:
            lines.append(
                _sample(
                    "smartdiagram_budget_remaining",
                    float(remaining.get("cost") or 0.0),
                    {**budget_labels, "resource": "cost"},
                )
            )
        if remaining.get("tokens") is not None:
            lines.append(
                _sample(
                    "smartdiagram_budget_remaining",
                    int(remaining.get("tokens") or 0),
                    {**budget_labels, "resource": "tokens"},
                )
            )

    queue_health = queue_health or {}
    queues = queue_health.get("queues") or {}
    lines.extend(
        _metric_header(
            "smartdiagram_queue_jobs",
            "gauge",
            "Worker queue jobs by queue and status.",
        )
    )
    if queues:
        for queue_name, queue in sorted(queues.items()):
            status_counts = queue.get("status_counts") or {}
            if status_counts:
                for status, count in sorted(status_counts.items()):
                    lines.append(
                        _sample(
                            "smartdiagram_queue_jobs",
                            int(count or 0),
                            {**base_labels, "queue": queue_name, "status": status},
                        )
                    )
            else:
                lines.append(
                    _sample(
                        "smartdiagram_queue_jobs",
                        0,
                        {**base_labels, "queue": queue_name, "status": "none"},
                    )
                )
    else:
        lines.append(_sample("smartdiagram_queue_jobs", 0, {**base_labels, "queue": "none", "status": "none"}))

    lines.extend(
        _metric_header(
            "smartdiagram_queue_oldest_queued_age_seconds",
            "gauge",
            "Age in seconds of the oldest queued worker job.",
        )
    )
    if queues:
        for queue_name, queue in sorted(queues.items()):
            lines.append(
                _sample(
                    "smartdiagram_queue_oldest_queued_age_seconds",
                    int(queue.get("oldest_queued_age_seconds") or 0),
                    {**base_labels, "queue": queue_name},
                )
            )
    else:
        lines.append(_sample("smartdiagram_queue_oldest_queued_age_seconds", 0, {**base_labels, "queue": "none"}))

    return "\n".join(lines) + "\n"
