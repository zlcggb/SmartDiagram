"""Audit and observability API routes."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.audit import AgentRun, AgentTraceSpan, AuditEvent, HumanApprovalRequest, ToolCall
from app.models.common import utc_now
from app.services.access_control_service import can_access_project, is_tenant_admin
from app.services.budget_service import get_budget_metrics_snapshot, refresh_usage_rollup
from app.services.permission_service import build_permission_context, can_read_audit
from app.services.prometheus_metrics_service import build_prometheus_metrics
from app.services.queue_health_service import get_queue_health_snapshot

router = APIRouter(prefix="/audit", tags=["audit"])


async def _load_approval_requests(
    session: AsyncSession,
    permission_context: dict[str, Any],
    *,
    limit: int,
) -> list[HumanApprovalRequest]:
    """Load approval checkpoints visible in the current audit scope."""

    statement = (
        select(HumanApprovalRequest)
        .where(HumanApprovalRequest.tenant_id == permission_context["tenant_id"])
        .order_by(HumanApprovalRequest.created_at.desc())
        .limit(limit)
    )
    if permission_context.get("project_id"):
        statement = statement.where(HumanApprovalRequest.project_id == permission_context["project_id"])
    return list((await session.execute(statement)).scalars().all())


def _approval_metrics(approvals: list[HumanApprovalRequest]) -> dict[str, Any]:
    status_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}
    status_type_counts: dict[str, dict[str, int]] = {}
    oldest_pending_age_seconds: int | None = None
    now = utc_now()

    for approval in approvals:
        status = approval.status or "unknown"
        approval_type = approval.approval_type or "unknown"
        status_counts[status] = status_counts.get(status, 0) + 1
        type_counts[approval_type] = type_counts.get(approval_type, 0) + 1
        status_type_counts.setdefault(status, {})
        status_type_counts[status][approval_type] = status_type_counts[status].get(approval_type, 0) + 1
        if status == "pending" and approval.created_at:
            age = max(0, int((now - approval.created_at).total_seconds()))
            oldest_pending_age_seconds = age if oldest_pending_age_seconds is None else max(oldest_pending_age_seconds, age)

    return {
        "total": len(approvals),
        "pending": status_counts.get("pending", 0),
        "status_counts": status_counts,
        "type_counts": type_counts,
        "status_type_counts": status_type_counts,
        "oldest_pending_age_seconds": oldest_pending_age_seconds,
    }


def _permission_body(request: Request, query: dict[str, Any]) -> dict[str, Any]:
    return {
        "tenant_id": query.get("tenant_id") or request.headers.get("x-tenant-id"),
        "user_id": query.get("user_id") or request.headers.get("x-user-id"),
        "team_id": query.get("team_id") or request.headers.get("x-team-id"),
        "project_id": query.get("project_id") or request.headers.get("x-project-id"),
        "roles": query.get("roles") or request.headers.get("x-roles"),
        "scopes": query.get("scopes") or request.headers.get("x-scopes"),
    }


async def _authorize_audit_request(
    request: Request,
    session: AsyncSession,
    tenant_id: str | None,
    user_id: str | None,
    team_id: str | None,
    project_id: str | None,
    roles: str | None,
    scopes: str | None,
) -> dict[str, Any]:
    permission_context = build_permission_context(
        _permission_body(
            request,
            {
                "tenant_id": tenant_id,
                "user_id": user_id,
                "team_id": team_id,
                "project_id": project_id,
                "roles": roles,
                "scopes": scopes,
            },
        )
    )
    if not can_read_audit(permission_context):
        raise HTTPException(status_code=403, detail="Missing audit:read scope")

    requested_project = permission_context.get("project_id")
    if not requested_project and not is_tenant_admin(permission_context):
        raise HTTPException(status_code=403, detail="Project-scoped audit access requires project_id")
    if requested_project and not await can_access_project(
        session,
        permission_context,
        requested_project,
        "project:read",
    ):
        raise HTTPException(status_code=403, detail="Missing project access for audit")
    return permission_context


@router.get("/events")
async def list_audit_events(
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    """List sanitized audit events for a tenant or project."""

    permission_context = await _authorize_audit_request(
        request,
        session,
        tenant_id,
        user_id,
        team_id,
        project_id,
        roles,
        scopes,
    )
    statement = (
        select(AuditEvent)
        .where(AuditEvent.tenant_id == permission_context["tenant_id"])
        .order_by(AuditEvent.created_at.desc())
        .limit(limit)
    )
    if permission_context.get("project_id"):
        statement = statement.where(AuditEvent.project_id == permission_context["project_id"])
    if event_type:
        statement = statement.where(AuditEvent.event_type == event_type)

    events = list((await session.execute(statement)).scalars().all())
    return {
        "events": [
            {
                "id": event.id,
                "tenant_id": event.tenant_id,
                "project_id": event.project_id,
                "user_id": event.user_id,
                "conversation_id": event.conversation_id,
                "agent_run_id": event.agent_run_id,
                "event_type": event.event_type,
                "severity": event.severity,
                "message": event.message,
                "metadata": event.metadata_json,
                "created_at": event.created_at.isoformat() if event.created_at else None,
            }
            for event in events
        ],
        "count": len(events),
    }


@router.get("/agent-runs")
async def list_agent_runs(
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    """List Agent Harness runs for observability dashboards."""

    permission_context = await _authorize_audit_request(
        request,
        session,
        tenant_id,
        user_id,
        team_id,
        project_id,
        roles,
        scopes,
    )
    statement = (
        select(AgentRun)
        .where(AgentRun.tenant_id == permission_context["tenant_id"])
        .order_by(AgentRun.started_at.desc())
        .limit(limit)
    )
    if permission_context.get("project_id"):
        statement = statement.where(AgentRun.project_id == permission_context["project_id"])
    if status:
        statement = statement.where(AgentRun.status == status)

    runs = list((await session.execute(statement)).scalars().all())
    return {
        "agent_runs": [
            {
                "id": run.id,
                "tenant_id": run.tenant_id,
                "project_id": run.project_id,
                "user_id": run.user_id,
                "conversation_id": run.conversation_id,
                "status": run.status,
                "task_type": run.task_type,
                "engine_type": run.engine_type,
                "cost_estimate": run.cost_estimate,
                "started_at": run.started_at.isoformat() if run.started_at else None,
                "ended_at": run.ended_at.isoformat() if run.ended_at else None,
                "error_message": run.error_message,
                "execution_step_count": len(run.execution_steps_json or []),
            }
            for run in runs
        ],
        "count": len(runs),
    }


@router.get("/agent-runs/{run_id}/trace")
async def get_agent_run_trace(
    run_id: str,
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Return OpenTelemetry-style graph spans for one Agent Harness run."""

    permission_context = await _authorize_audit_request(
        request,
        session,
        tenant_id,
        user_id,
        team_id,
        project_id,
        roles,
        scopes,
    )
    run = await session.get(AgentRun, run_id)
    if not run or run.tenant_id != permission_context["tenant_id"]:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if permission_context.get("project_id") and run.project_id != permission_context["project_id"]:
        raise HTTPException(status_code=404, detail="Agent run not found")

    statement = (
        select(AgentTraceSpan)
        .where(AgentTraceSpan.tenant_id == permission_context["tenant_id"])
        .where(AgentTraceSpan.agent_run_id == run_id)
        .order_by(AgentTraceSpan.started_at.asc())
    )
    if permission_context.get("project_id"):
        statement = statement.where(AgentTraceSpan.project_id == permission_context["project_id"])

    spans = list((await session.execute(statement)).scalars().all())
    return {
        "run_id": run_id,
        "trace_id": spans[0].trace_id if spans else None,
        "span_count": len(spans),
        "spans": [
            {
                "id": span.id,
                "trace_id": span.trace_id,
                "span_id": span.span_id,
                "parent_span_id": span.parent_span_id,
                "name": span.name,
                "span_type": span.span_type,
                "status": span.status,
                "duration_ms": span.duration_ms,
                "attributes": span.attributes_json,
                "started_at": span.started_at.isoformat() if span.started_at else None,
                "ended_at": span.ended_at.isoformat() if span.ended_at else None,
            }
            for span in spans
        ],
    }


@router.get("/agent-runs/{run_id}/steps")
async def get_agent_run_steps(
    run_id: str,
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Return normalized Agent Harness execution steps for one run."""

    permission_context = await _authorize_audit_request(
        request,
        session,
        tenant_id,
        user_id,
        team_id,
        project_id,
        roles,
        scopes,
    )
    run = await session.get(AgentRun, run_id)
    if not run or run.tenant_id != permission_context["tenant_id"]:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if permission_context.get("project_id") and run.project_id != permission_context["project_id"]:
        raise HTTPException(status_code=404, detail="Agent run not found")

    tool_statement = (
        select(ToolCall)
        .where(ToolCall.tenant_id == permission_context["tenant_id"])
        .where(ToolCall.agent_run_id == run_id)
        .order_by(ToolCall.started_at.asc())
    )
    if permission_context.get("project_id"):
        tool_statement = tool_statement.where(ToolCall.project_id == permission_context["project_id"])
    tool_calls = list((await session.execute(tool_statement)).scalars().all())

    return {
        "run_id": run_id,
        "status": run.status,
        "task_type": run.task_type,
        "engine_type": run.engine_type,
        "execution_plan": run.execution_plan_json or [],
        "execution_steps": run.execution_steps_json or [],
        "tool_calls": [
            {
                "id": tool.id,
                "tool_name": tool.tool_name,
                "status": tool.status,
                "input_summary": tool.input_summary,
                "output_summary": tool.output_summary,
                "error_message": tool.error_message,
                "cost_estimate": tool.cost_estimate,
                "started_at": tool.started_at.isoformat() if tool.started_at else None,
                "ended_at": tool.ended_at.isoformat() if tool.ended_at else None,
            }
            for tool in tool_calls
        ],
    }


@router.post("/usage-rollups/refresh")
async def refresh_audit_usage_rollup(
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    period: str | None = Query(default=None),
    scope: str = Query(default="auto", pattern="^(auto|tenant|project)$"),
    session: AsyncSession = Depends(get_session),
):
    """Refresh a pre-aggregated usage rollup for metrics at scale."""

    permission_context = await _authorize_audit_request(
        request,
        session,
        tenant_id,
        user_id,
        team_id,
        project_id,
        roles,
        scopes,
    )
    tenant_admin = is_tenant_admin(permission_context)
    target_project_id = permission_context.get("project_id")

    if scope == "tenant":
        if not tenant_admin:
            raise HTTPException(status_code=403, detail="Tenant rollup refresh requires tenant admin role")
        target_project_id = None
    elif scope == "project":
        if not target_project_id:
            raise HTTPException(status_code=400, detail="Project rollup refresh requires project_id")
    elif scope == "auto":
        target_project_id = None if tenant_admin else target_project_id

    rollup = await refresh_usage_rollup(
        session,
        permission_context,
        period=period,
        project_id=target_project_id,
    )
    session.add(
        AuditEvent(
            tenant_id=permission_context["tenant_id"],
            project_id=target_project_id,
            user_id=permission_context.get("user_id") or "anonymous",
            event_type="tenant.usage_rollup.refreshed",
            message="Usage rollup refreshed for audit metrics.",
            metadata_json={
                "period": rollup["period"],
                "scope": rollup["scope"],
                "project_id": target_project_id,
                "run_count": rollup["run_count"],
                "estimated_cost": rollup["estimated_cost"],
                "estimated_total_tokens": rollup["estimated_total_tokens"],
            },
        )
    )
    await session.commit()
    return {"rollup": rollup}


@router.get("/metrics")
async def get_audit_metrics(
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
    session: AsyncSession = Depends(get_session),
):
    """Return operational metrics for Agent runs and audit events."""

    permission_context = await _authorize_audit_request(
        request,
        session,
        tenant_id,
        user_id,
        team_id,
        project_id,
        roles,
        scopes,
    )
    run_statement = (
        select(AgentRun)
        .where(AgentRun.tenant_id == permission_context["tenant_id"])
        .order_by(AgentRun.started_at.desc())
        .limit(limit)
    )
    event_statement = (
        select(AuditEvent)
        .where(AuditEvent.tenant_id == permission_context["tenant_id"])
        .order_by(AuditEvent.created_at.desc())
        .limit(limit)
    )
    if permission_context.get("project_id"):
        run_statement = run_statement.where(AgentRun.project_id == permission_context["project_id"])
        event_statement = event_statement.where(AuditEvent.project_id == permission_context["project_id"])

    runs = list((await session.execute(run_statement)).scalars().all())
    events = list((await session.execute(event_statement)).scalars().all())
    approvals = await _load_approval_requests(
        session,
        permission_context,
        limit=limit,
    )

    status_counts: dict[str, int] = {}
    engine_counts: dict[str, int] = {}
    event_type_counts: dict[str, int] = {}
    severity_counts: dict[str, int] = {}
    step_status_counts: dict[str, int] = {}
    step_phase_counts: dict[str, int] = {}
    total_estimated_input_tokens = 0
    total_estimated_output_tokens = 0
    total_estimated_cost = 0.0

    for run in runs:
        status_counts[run.status] = status_counts.get(run.status, 0) + 1
        if run.engine_type:
            engine_counts[run.engine_type] = engine_counts.get(run.engine_type, 0) + 1
        usage = run.token_usage_json or {}
        total_estimated_input_tokens += int(usage.get("estimated_input_tokens") or 0)
        total_estimated_output_tokens += int(usage.get("estimated_output_tokens") or 0)
        total_estimated_cost += float(run.cost_estimate or 0.0)
        for step in run.execution_steps_json or []:
            status = str(step.get("status") or "unknown")
            phase = str(step.get("phase") or "unknown")
            step_status_counts[status] = step_status_counts.get(status, 0) + 1
            step_phase_counts[phase] = step_phase_counts.get(phase, 0) + 1

    for event in events:
        event_type_counts[event.event_type] = event_type_counts.get(event.event_type, 0) + 1
        severity_counts[event.severity] = severity_counts.get(event.severity, 0) + 1

    tenant_admin = is_tenant_admin(permission_context)
    budget_snapshot = await get_budget_metrics_snapshot(
        session,
        permission_context,
        include_tenant_limits=tenant_admin,
        project_id=permission_context.get("project_id"),
    )
    queue_health = await get_queue_health_snapshot(
        session,
        permission_context,
        project_id=permission_context.get("project_id"),
    )

    return {
        "agent_runs": {
            "total": len(runs),
            "status_counts": status_counts,
            "engine_counts": engine_counts,
            "estimated_input_tokens": total_estimated_input_tokens,
            "estimated_output_tokens": total_estimated_output_tokens,
            "estimated_cost": round(total_estimated_cost, 8),
        },
        "audit_events": {
            "total": len(events),
            "event_type_counts": dict(sorted(event_type_counts.items())[:50]),
            "severity_counts": severity_counts,
        },
        "execution_steps": {
            "status_counts": step_status_counts,
            "phase_counts": step_phase_counts,
        },
        "approval_requests": _approval_metrics(approvals),
        "budget": budget_snapshot,
        "queue_health": queue_health,
    }


@router.get("/queue-health")
async def get_queue_health(
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Return export and knowledge worker queue health."""

    permission_context = await _authorize_audit_request(
        request,
        session,
        tenant_id,
        user_id,
        team_id,
        project_id,
        roles,
        scopes,
    )
    return await get_queue_health_snapshot(
        session,
        permission_context,
        project_id=permission_context.get("project_id"),
    )


@router.get("/prometheus", response_class=PlainTextResponse)
async def get_prometheus_metrics(
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
    session: AsyncSession = Depends(get_session),
):
    """Return Prometheus text metrics for scrape-style observability."""

    permission_context = await _authorize_audit_request(
        request,
        session,
        tenant_id,
        user_id,
        team_id,
        project_id,
        roles,
        scopes,
    )
    run_statement = (
        select(AgentRun)
        .where(AgentRun.tenant_id == permission_context["tenant_id"])
        .order_by(AgentRun.started_at.desc())
        .limit(limit)
    )
    event_statement = (
        select(AuditEvent)
        .where(AuditEvent.tenant_id == permission_context["tenant_id"])
        .order_by(AuditEvent.created_at.desc())
        .limit(limit)
    )
    if permission_context.get("project_id"):
        run_statement = run_statement.where(AgentRun.project_id == permission_context["project_id"])
        event_statement = event_statement.where(AuditEvent.project_id == permission_context["project_id"])

    runs = list((await session.execute(run_statement)).scalars().all())
    events = list((await session.execute(event_statement)).scalars().all())
    approvals = await _load_approval_requests(
        session,
        permission_context,
        limit=limit,
    )
    tenant_admin = is_tenant_admin(permission_context)
    budget_snapshot = await get_budget_metrics_snapshot(
        session,
        permission_context,
        include_tenant_limits=tenant_admin,
        project_id=permission_context.get("project_id"),
    )
    queue_health = await get_queue_health_snapshot(
        session,
        permission_context,
        project_id=permission_context.get("project_id"),
    )
    content = build_prometheus_metrics(
        runs=runs,
        events=events,
        approval_summary=_approval_metrics(approvals),
        budget_snapshot=budget_snapshot,
        queue_health=queue_health,
        tenant_id=permission_context["tenant_id"],
        project_id=permission_context.get("project_id"),
    )
    return PlainTextResponse(
        content,
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
