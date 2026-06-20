"""Authorized historical diagram discovery for long-term project memory."""

import hashlib
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AgentRun, AuditEvent
from app.models.conversation import Conversation, Message
from app.models.diagram import Diagram, DiagramVersion
from app.services.access_control_service import can_access_project, is_tenant_admin
from app.services.audit_service import ensure_principals
from app.state.agent_runtime import PermissionContext


MAX_SCAN_LIMIT = 200


def _clip(value: Any, max_chars: int = 500) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_chars:
        return text
    return f"{text[: max_chars - 3].rstrip()}..."


def _code_hash(code: str) -> str:
    return hashlib.sha256((code or "").encode("utf-8")).hexdigest()[:16]


def _duration_ms(started_at: Any, ended_at: Any) -> float:
    if not started_at or not ended_at:
        return 0.0
    return round(max((ended_at - started_at).total_seconds() * 1000, 0.0), 3)


def _terms(text: str) -> set[str]:
    terms: set[str] = set()
    for token in re.findall(r"[\w\u4e00-\u9fff]+", (text or "").lower()):
        terms.add(token)
        cjk = [ch for ch in token if "\u4e00" <= ch <= "\u9fff"]
        if cjk:
            terms.update(cjk)
            terms.update("".join(cjk[index : index + 2]) for index in range(len(cjk) - 1))
    return terms


def _matches_query(diagram: Diagram, version: DiagramVersion | None, conversation: Conversation | None, query: str) -> bool:
    if not query:
        return True
    haystack = " ".join(
        [
            diagram.title,
            diagram.engine_type,
            diagram.task_type,
            (version.design_concept if version else ""),
            (conversation.summary if conversation else ""),
        ]
    ).lower()
    if query.lower() in haystack:
        return True
    query_terms = _terms(query)
    if not query_terms:
        return True
    haystack_terms = _terms(haystack)
    return bool(query_terms & haystack_terms)


def _can_read_unprojected_diagram(diagram: Diagram, permission_context: PermissionContext) -> bool:
    if is_tenant_admin(permission_context):
        return True
    user_id = permission_context.get("user_id") or "anonymous"
    if diagram.owner_user_id == user_id:
        return True
    if diagram.visibility == "tenant":
        return True
    if diagram.visibility == "team":
        diagram_team_id = (diagram.metadata_json or {}).get("team_id")
        return bool(diagram_team_id and diagram_team_id == permission_context.get("team_id"))
    return False


def _serialize_agent_step(step: dict[str, Any], index: int) -> dict[str, Any]:
    """Return one UI-safe historical execution step."""

    duration_ms = float(step.get("duration_ms") or 0.0)
    return {
        "id": str(step.get("id") or f"step_{index + 1}"),
        "label": _clip(step.get("label") or step.get("phase") or step.get("agent") or "Agent step", 120),
        "agent": str(step.get("agent") or ""),
        "phase": str(step.get("phase") or ""),
        "status": str(step.get("status") or "unknown"),
        "started_at": step.get("started_at") or "",
        "ended_at": step.get("ended_at") or "",
        "duration_ms": duration_ms,
        "duration_seconds": round(duration_ms / 1000, 3),
        "error": _clip(step.get("error") or "", 240),
    }


def _serialize_agent_process(agent_run: AgentRun | None, assistant_message: Message | None) -> dict[str, Any] | None:
    """Return persisted Agent execution context for history cards."""

    if not agent_run:
        return None

    raw_steps = agent_run.execution_steps_json or []
    if not raw_steps and agent_run.execution_plan_json:
        raw_steps = agent_run.execution_plan_json
    steps = [
        _serialize_agent_step(step, index)
        for index, step in enumerate(raw_steps)
        if isinstance(step, dict)
    ]
    duration_ms = _duration_ms(agent_run.started_at, agent_run.ended_at)
    if not duration_ms and steps:
        duration_ms = round(sum(float(step.get("duration_ms") or 0.0) for step in steps), 3)
    token_usage = agent_run.token_usage_json or {}
    return {
        "run_id": agent_run.id,
        "status": agent_run.status,
        "started_at": agent_run.started_at.isoformat() if agent_run.started_at else "",
        "ended_at": agent_run.ended_at.isoformat() if agent_run.ended_at else "",
        "duration_ms": duration_ms,
        "duration_seconds": round(duration_ms / 1000, 3),
        "step_count": len(steps),
        "steps": steps,
        "assistant_content": _clip(assistant_message.content if assistant_message else "", 900),
        "token_usage": {
            "estimated_input_tokens": int(token_usage.get("estimated_input_tokens") or 0),
            "estimated_output_tokens": int(token_usage.get("estimated_output_tokens") or 0),
            "estimated_total_tokens": int(token_usage.get("estimated_total_tokens") or 0),
            "stream_event_count": int(token_usage.get("stream_event_count") or 0),
        },
        "cost_estimate": round(float(agent_run.cost_estimate or 0.0), 8),
    }


async def _message_for_version(
    session: AsyncSession,
    version: DiagramVersion | None,
    tenant_id: str,
) -> Message | None:
    if not version or not version.message_id:
        return None
    message = await session.get(Message, version.message_id)
    if not message or message.tenant_id != tenant_id:
        return None
    return message


async def _resolve_agent_history(
    session: AsyncSession,
    version: DiagramVersion | None,
    tenant_id: str,
) -> tuple[Message | None, AgentRun | None]:
    """Resolve the original Agent run for generated, branched, or rollback versions."""

    message = await _message_for_version(session, version, tenant_id)
    run_id = (message.metadata_json or {}).get("agent_run_id") if message else None
    if not run_id and version:
        version_metadata = version.validation_json or {}
        source_version_id = (
            (version_metadata.get("rollback") or {}).get("from_version_id")
            or (version_metadata.get("branch") or {}).get("from_version_id")
        )
        if source_version_id:
            source_version = await session.get(DiagramVersion, source_version_id)
            if source_version and source_version.tenant_id == tenant_id:
                source_message = await _message_for_version(session, source_version, tenant_id)
                source_run_id = (source_message.metadata_json or {}).get("agent_run_id") if source_message else None
                if source_run_id:
                    message = source_message
                    run_id = source_run_id

    if not run_id:
        return message, None

    agent_run = await session.get(AgentRun, str(run_id))
    if not agent_run or agent_run.tenant_id != tenant_id:
        return message, None
    return message, agent_run


def serialize_history_item(
    diagram: Diagram,
    version: DiagramVersion | None,
    conversation: Conversation | None,
    *,
    include_code: bool = False,
    assistant_message: Message | None = None,
    agent_run: AgentRun | None = None,
) -> dict[str, Any]:
    """Return a safe historical diagram payload."""

    payload = {
        "diagram_id": diagram.id,
        "title": diagram.title,
        "engine_type": diagram.engine_type,
        "task_type": diagram.task_type,
        "visibility": diagram.visibility,
        "project_id": diagram.project_id,
        "conversation_id": diagram.conversation_id,
        "owner_user_id": diagram.owner_user_id,
        "current_version_id": diagram.current_version_id,
        "created_at": diagram.created_at.isoformat() if diagram.created_at else "",
        "updated_at": diagram.updated_at.isoformat() if diagram.updated_at else "",
        "conversation": {
            "summary": _clip(conversation.summary, 500) if conversation else "",
            "status": conversation.status if conversation else "",
            "current_diagram_version_id": conversation.current_diagram_version_id if conversation else "",
        },
        "current_version": None,
    }
    if version:
        version_payload = {
            "diagram_version_id": version.id,
            "version_number": version.version_number,
            "engine_type": version.engine_type,
            "task_type": version.task_type,
            "design_concept": _clip(version.design_concept, 700),
            "code_hash": _code_hash(version.code),
            "created_by": version.created_by,
            "created_at": version.created_at.isoformat() if version.created_at else "",
            "validation": version.validation_json or {},
            "agent_process": _serialize_agent_process(agent_run, assistant_message),
        }
        if include_code:
            version_payload["code"] = version.code
        else:
            version_payload["code_preview"] = _clip(version.code, 500)
        payload["current_version"] = version_payload
    return payload


async def search_authorized_diagram_history(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    query: str = "",
    project_id: str | None = None,
    engine_type: str = "",
    task_type: str = "",
    include_code: bool = False,
    limit: int = 20,
) -> dict[str, Any]:
    """Search historical diagrams visible to a caller."""

    if "diagram:read" not in permission_context.get("scopes", []):
        raise PermissionError("missing_scope")

    tenant_id = permission_context.get("tenant_id") or "local"
    user_id = permission_context.get("user_id") or "anonymous"
    resolved_project_id = project_id or permission_context.get("project_id")
    await ensure_principals(session, permission_context, None)
    if resolved_project_id and not await can_access_project(
        session,
        permission_context,
        resolved_project_id,
        "diagram:read",
    ):
        raise PermissionError("missing_project_access")

    bounded_limit = max(1, min(int(limit or 20), 100))
    scan_limit = min(MAX_SCAN_LIMIT, max(bounded_limit * 5, 50))
    statement = (
        select(Diagram)
        .where(Diagram.tenant_id == tenant_id)
        .order_by(Diagram.updated_at.desc(), Diagram.created_at.desc())
        .limit(scan_limit)
    )
    if resolved_project_id:
        statement = statement.where(Diagram.project_id == resolved_project_id)
    if engine_type:
        statement = statement.where(Diagram.engine_type == engine_type)
    if task_type:
        statement = statement.where(Diagram.task_type == task_type)

    diagrams = list((await session.execute(statement)).scalars().all())
    results: list[dict[str, Any]] = []
    for diagram in diagrams:
        if diagram.tenant_id != tenant_id:
            continue
        if diagram.project_id:
            if not await can_access_project(session, permission_context, diagram.project_id, "diagram:read"):
                continue
        elif not _can_read_unprojected_diagram(diagram, permission_context):
            continue

        version = await session.get(DiagramVersion, diagram.current_version_id) if diagram.current_version_id else None
        conversation = await session.get(Conversation, diagram.conversation_id) if diagram.conversation_id else None
        if version and version.tenant_id != tenant_id:
            version = None
        if conversation and conversation.tenant_id != tenant_id:
            conversation = None
        assistant_message, agent_run = await _resolve_agent_history(session, version, tenant_id)
        if not _matches_query(diagram, version, conversation, query):
            continue
        results.append(
            serialize_history_item(
                diagram,
                version,
                conversation,
                include_code=include_code,
                assistant_message=assistant_message,
                agent_run=agent_run,
            )
        )
        if len(results) >= bounded_limit:
            break

    session.add(
        AuditEvent(
            tenant_id=tenant_id,
            project_id=resolved_project_id,
            user_id=user_id,
            event_type="diagram.history.searched",
            severity="info",
            message="Searched authorized historical diagrams.",
            metadata_json={
                "query_present": bool(query),
                "engine_type": engine_type,
                "task_type": task_type,
                "include_code": include_code,
                "result_count": len(results),
                "limit": bounded_limit,
            },
        )
    )
    await session.flush()
    return {
        "status": "ok",
        "tenant_id": tenant_id,
        "project_id": resolved_project_id,
        "query": query,
        "engine_type": engine_type,
        "task_type": task_type,
        "count": len(results),
        "diagrams": results,
    }
