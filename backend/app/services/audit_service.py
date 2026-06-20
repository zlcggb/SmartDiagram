"""Non-blocking audit persistence for Agent Harness runs."""

import asyncio
from datetime import datetime
from typing import Any

from app.core.db import async_session
from app.core.logger import logger
from app.models.audit import AgentRun, AgentTraceSpan, AuditEvent, ToolCall
from app.models.common import new_id, utc_now
from app.models.conversation import Conversation
from app.models.project import Project
from app.models.tenant import Team, Tenant, User
from app.services.execution_step_service import build_execution_steps
from app.state.agent_runtime import PermissionContext

AUDIT_TIMEOUT_SECONDS = 1.5


def create_agent_run_id() -> str:
    """Create a stable run id even when persistence is unavailable."""

    return new_id()


def _safe_model_config(model_config: dict[str, Any] | None) -> dict[str, Any]:
    """Persist non-secret model routing metadata only."""

    config = model_config or {}
    return {
        "model_id": config.get("model_id", ""),
        "has_api_key": bool(config.get("api_key")),
        "has_base_url": bool(config.get("base_url")),
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


async def ensure_principals(
    session,
    permission_context: PermissionContext,
    conversation_id: str | None,
) -> dict[str, bool]:
    """Create local-dev identity rows required by foreign keys."""

    tenant_id = permission_context.get("tenant_id") or "local"
    user_id = permission_context.get("user_id") or "anonymous"
    team_id = permission_context.get("team_id")
    project_id = permission_context.get("project_id")
    created = {
        "tenant": False,
        "user": False,
        "team": False,
        "project": False,
        "conversation": False,
    }

    if not await session.get(Tenant, tenant_id):
        session.add(Tenant(id=tenant_id, name=tenant_id, slug=tenant_id))
        created["tenant"] = True

    if user_id and not await session.get(User, user_id):
        session.add(
            User(
                id=user_id,
                tenant_id=tenant_id,
                email=f"{user_id}@local.smartdiagram",
                display_name=user_id,
                role=(permission_context.get("roles") or ["member"])[0],
            )
        )
        created["user"] = True

    if team_id and not await session.get(Team, team_id):
        session.add(
            Team(
                id=team_id,
                tenant_id=tenant_id,
                name=team_id,
                created_by=user_id,
            )
        )
        created["team"] = True

    if project_id and not await session.get(Project, project_id):
        session.add(
            Project(
                id=project_id,
                tenant_id=tenant_id,
                team_id=team_id,
                name=project_id,
                created_by=user_id,
            )
        )
        created["project"] = True

    if conversation_id and not await session.get(Conversation, conversation_id):
        session.add(
            Conversation(
                id=conversation_id,
                tenant_id=tenant_id,
                team_id=team_id,
                project_id=project_id,
                created_by=user_id,
                title="SmartDiagram Agent conversation",
            )
        )
        created["conversation"] = True

    await session.flush()
    return created


async def _persist_agent_run_start(
    run_id: str,
    permission_context: PermissionContext,
    model_config: dict[str, Any] | None,
    conversation_id: str | None,
    token_usage: dict[str, Any],
    cost_estimate: float,
) -> bool:
    tenant_id = permission_context.get("tenant_id") or "local"
    user_id = permission_context.get("user_id") or "anonymous"

    async with async_session() as session:
        await ensure_principals(session, permission_context, conversation_id)
        session.add(
            AgentRun(
                id=run_id,
                tenant_id=tenant_id,
                user_id=user_id,
                project_id=permission_context.get("project_id"),
                conversation_id=conversation_id,
                status="running",
                model_config_json=_safe_model_config(model_config),
                token_usage_json=token_usage,
                cost_estimate=cost_estimate,
            )
        )
        session.add(
            AuditEvent(
                tenant_id=tenant_id,
                project_id=permission_context.get("project_id"),
                user_id=user_id,
                conversation_id=conversation_id,
                agent_run_id=run_id,
                event_type="agent.run.start",
                message="Agent run started.",
                metadata_json={
                    "team_id": permission_context.get("team_id"),
                    "roles": permission_context.get("roles", []),
                    "scopes": permission_context.get("scopes", []),
                    "estimated_cost": cost_estimate,
                    "token_usage": token_usage,
                },
            )
        )
        await session.commit()
    return True


async def persist_agent_run_start(
    run_id: str,
    permission_context: PermissionContext,
    model_config: dict[str, Any] | None = None,
    conversation_id: str | None = None,
    token_usage: dict[str, Any] | None = None,
    cost_estimate: float = 0.0,
) -> bool:
    """Try to persist a run start without blocking the diagram path."""

    try:
        return await asyncio.wait_for(
            _persist_agent_run_start(
                run_id=run_id,
                permission_context=permission_context,
                model_config=model_config,
                conversation_id=conversation_id,
                token_usage=token_usage or {},
                cost_estimate=cost_estimate,
            ),
            timeout=AUDIT_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning(f"Agent audit start persistence skipped: {exc}")
        return False


def _audit_event_from_state(
    raw_event: dict[str, Any],
    run_id: str,
    permission_context: PermissionContext,
    conversation_id: str | None,
) -> AuditEvent:
    event_type = raw_event.get("type") or raw_event.get("event_type") or "agent.event"
    return AuditEvent(
        tenant_id=raw_event.get("tenant_id") or permission_context.get("tenant_id") or "local",
        project_id=raw_event.get("project_id") or permission_context.get("project_id"),
        user_id=raw_event.get("actor_user_id")
        or raw_event.get("user_id")
        or permission_context.get("user_id")
        or "anonymous",
        conversation_id=conversation_id,
        agent_run_id=run_id,
        event_type=event_type,
        severity=raw_event.get("severity", "info"),
        message=raw_event.get("message", ""),
        metadata_json=raw_event.get("metadata") or raw_event.get("metadata_json") or {},
    )


async def _persist_agent_run_finish(
    run_id: str,
    permission_context: PermissionContext,
    status: str,
    task_type: str,
    engine_type: str,
    execution_plan: list[dict[str, Any]],
    validation_events: list[dict[str, Any]],
    audit_events: list[dict[str, Any]],
    tool_calls: list[dict[str, Any]],
    error_message: str,
    conversation_id: str | None,
    token_usage: dict[str, Any],
    cost_estimate: float,
    trace_spans: list[dict[str, Any]],
) -> bool:
    tenant_id = permission_context.get("tenant_id") or "local"
    user_id = permission_context.get("user_id") or "anonymous"

    async with async_session() as session:
        run = await session.get(AgentRun, run_id)
        if not run:
            return False

        run.status = status
        run.intent = engine_type
        run.task_type = task_type
        run.engine_type = engine_type
        run.execution_plan_json = execution_plan
        run.execution_steps_json = build_execution_steps(
            execution_plan=execution_plan,
            trace_spans=trace_spans,
            validation_events=validation_events,
            audit_events=audit_events,
            tool_calls=tool_calls,
            final_status=status,
        )
        if token_usage:
            run.token_usage_json = {
                **(run.token_usage_json or {}),
                **token_usage,
            }
        run.cost_estimate = cost_estimate
        run.error_message = error_message
        run.ended_at = utc_now()

        for raw_event in audit_events:
            if isinstance(raw_event, dict):
                session.add(
                    _audit_event_from_state(
                        raw_event,
                        run_id=run_id,
                        permission_context=permission_context,
                        conversation_id=conversation_id,
                    )
                )

        for span in trace_spans:
            started_at = _parse_datetime(span.get("started_at")) or utc_now()
            session.add(
                AgentTraceSpan(
                    tenant_id=tenant_id,
                    project_id=permission_context.get("project_id"),
                    user_id=user_id,
                    conversation_id=conversation_id,
                    agent_run_id=run_id,
                    trace_id=str(span.get("trace_id") or ""),
                    span_id=str(span.get("span_id") or ""),
                    parent_span_id=span.get("parent_span_id"),
                    name=str(span.get("name") or ""),
                    span_type=str(span.get("span_type") or "chain"),
                    status=str(span.get("status") or "succeeded"),
                    duration_ms=float(span.get("duration_ms") or 0.0),
                    attributes_json=span.get("attributes") or {},
                    started_at=started_at,
                    ended_at=_parse_datetime(span.get("ended_at")),
                )
            )

        for tool_call in tool_calls:
            session.add(
                ToolCall(
                    tenant_id=tenant_id,
                    project_id=permission_context.get("project_id"),
                    user_id=user_id,
                    conversation_id=conversation_id,
                    agent_run_id=run_id,
                    tool_name=str(tool_call.get("tool_name") or "unknown"),
                    status=str(tool_call.get("status") or "succeeded"),
                    input_summary=str(tool_call.get("input_summary") or "")[:1000],
                    output_summary=str(tool_call.get("output_summary") or "")[:1000],
                    input_json=tool_call.get("input_json") or {},
                    output_json=tool_call.get("output_json") or {},
                    error_message=str(tool_call.get("error") or tool_call.get("error_message") or "")[:1000],
                    cost_estimate=float(tool_call.get("cost_estimate") or 0.0),
                    started_at=_parse_datetime(tool_call.get("started_at")) or utc_now(),
                    ended_at=_parse_datetime(tool_call.get("ended_at")),
                )
            )

        for validation in validation_events:
            session.add(
                AuditEvent(
                    tenant_id=tenant_id,
                    project_id=permission_context.get("project_id"),
                    user_id=user_id,
                    conversation_id=conversation_id,
                    agent_run_id=run_id,
                    event_type="output.validation",
                    severity="info" if validation.get("ok") else "warning",
                    message="Output validation completed.",
                    metadata_json=validation,
                )
            )

        session.add(
            AuditEvent(
                tenant_id=tenant_id,
                project_id=permission_context.get("project_id"),
                user_id=user_id,
                conversation_id=conversation_id,
                agent_run_id=run_id,
                event_type="agent.run.finish",
                severity="info" if status == "succeeded" else "error",
                message=f"Agent run {status}.",
                metadata_json={
                    "task_type": task_type,
                    "engine_type": engine_type,
                    "validation_count": len(validation_events),
                    "audit_event_count": len(audit_events),
                    "tool_call_count": len(tool_calls),
                    "execution_step_count": len(run.execution_steps_json or []),
                    "trace_span_count": len(trace_spans),
                    "estimated_cost": cost_estimate,
                    "token_usage": token_usage,
                },
            )
        )
        await session.commit()
    return True


async def persist_agent_run_finish(
    run_id: str,
    permission_context: PermissionContext,
    status: str,
    task_type: str = "",
    engine_type: str = "",
    execution_plan: list[dict[str, Any]] | None = None,
    validation_events: list[dict[str, Any]] | None = None,
    audit_events: list[dict[str, Any]] | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
    error_message: str = "",
    conversation_id: str | None = None,
    token_usage: dict[str, Any] | None = None,
    cost_estimate: float = 0.0,
    trace_spans: list[dict[str, Any]] | None = None,
) -> bool:
    """Try to persist the final run state without affecting the response."""

    try:
        return await asyncio.wait_for(
            _persist_agent_run_finish(
                run_id=run_id,
                permission_context=permission_context,
                status=status,
                task_type=task_type,
                engine_type=engine_type,
                execution_plan=execution_plan or [],
                validation_events=validation_events or [],
                audit_events=audit_events or [],
                tool_calls=tool_calls or [],
                error_message=error_message,
                conversation_id=conversation_id,
                token_usage=token_usage or {},
                cost_estimate=cost_estimate,
                trace_spans=trace_spans or [],
            ),
            timeout=AUDIT_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning(f"Agent audit finish persistence skipped: {exc}")
        return False
