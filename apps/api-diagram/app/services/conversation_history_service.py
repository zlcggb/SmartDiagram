"""Authorized conversation history browsing helpers."""

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AgentRun, AuditEvent
from app.models.conversation import Conversation, Message
from app.models.diagram import Diagram, DiagramVersion
from app.services.access_control_service import can_access_project, is_tenant_admin
from app.state.agent_runtime import PermissionContext


MAX_SUMMARY_CHARS = 1200
MAX_MESSAGE_CHARS = 900
MAX_RECENT_MESSAGES = 12


def _clip_text(value: Any, max_chars: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_chars:
        return text
    return f"{text[: max_chars - 3].rstrip()}..."


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else ""


def _duration_ms(started_at: Any, ended_at: Any) -> float:
    if not started_at or not ended_at:
        return 0.0
    if isinstance(started_at, datetime) and isinstance(ended_at, datetime):
        return round(max(0.0, (ended_at - started_at).total_seconds() * 1000), 3)
    return 0.0


def _serialize_agent_step(step: dict[str, Any], index: int) -> dict[str, Any]:
    duration_ms = float(step.get("duration_ms") or 0.0)
    return {
        "id": str(step.get("id") or f"step_{index + 1}"),
        "label": _clip_text(step.get("label") or step.get("id") or f"Step {index + 1}", 180),
        "agent": step.get("agent") or "",
        "phase": step.get("phase") or "",
        "status": step.get("status") or "",
        "started_at": step.get("started_at") or "",
        "ended_at": step.get("ended_at") or "",
        "duration_ms": duration_ms,
        "duration_seconds": round(duration_ms / 1000, 3),
        "error": _clip_text(step.get("error"), 240),
    }


def _serialize_agent_process(agent_run: AgentRun | None) -> dict[str, Any] | None:
    """Serialize visible Agent execution metadata, not hidden chain-of-thought."""

    if not agent_run:
        return None

    raw_steps = agent_run.execution_steps_json or []
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
        "started_at": _iso(agent_run.started_at),
        "ended_at": _iso(agent_run.ended_at),
        "duration_ms": duration_ms,
        "duration_seconds": round(duration_ms / 1000, 3),
        "step_count": len(steps),
        "steps": steps,
        "token_usage": {
            "estimated_prompt_tokens": token_usage.get("estimated_prompt_tokens", 0),
            "estimated_completion_tokens": token_usage.get("estimated_completion_tokens", 0),
            "estimated_total_tokens": token_usage.get("estimated_total_tokens", 0),
            "stream_event_count": token_usage.get("stream_event_count", 0),
        },
        "cost_estimate": agent_run.cost_estimate,
    }


async def _can_access_conversation(
    session: AsyncSession,
    permission_context: PermissionContext,
    conversation: Conversation,
) -> bool:
    tenant_id = permission_context.get("tenant_id") or "local"
    user_id = permission_context.get("user_id") or "anonymous"
    if conversation.tenant_id != tenant_id:
        return False
    if conversation.project_id:
        return await can_access_project(
            session,
            permission_context,
            conversation.project_id,
            required_scope="diagram:read",
        )
    if is_tenant_admin(permission_context):
        return True
    if conversation.created_by and conversation.created_by == user_id:
        return True
    team_id = permission_context.get("team_id")
    return bool(team_id and conversation.team_id and conversation.team_id == team_id)


async def _load_recent_messages(
    session: AsyncSession,
    tenant_id: str,
    conversation_id: str,
    limit: int,
) -> list[Message]:
    statement = (
        select(Message)
        .where(
            Message.tenant_id == tenant_id,
            Message.conversation_id == conversation_id,
        )
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    records = list((await session.execute(statement)).scalars().all())
    records.reverse()
    return records


async def _load_agent_run(
    session: AsyncSession,
    cache: dict[str, AgentRun | None],
    tenant_id: str,
    run_id: str | None,
) -> AgentRun | None:
    if not run_id:
        return None
    if run_id not in cache:
        run = await session.get(AgentRun, run_id)
        cache[run_id] = run if run and run.tenant_id == tenant_id else None
    return cache[run_id]


async def _serialize_message(
    session: AsyncSession,
    cache: dict[str, AgentRun | None],
    message: Message,
    version_snapshots: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    metadata = message.metadata_json or {}
    run_id = str(metadata.get("agent_run_id") or "")
    agent_run = await _load_agent_run(session, cache, message.tenant_id, run_id)
    snapshot = (version_snapshots or {}).get(message.diagram_version_id or "") if message.diagram_version_id else None
    return {
        "id": message.id,
        "role": message.role,
        "content": _clip_text(message.content, MAX_MESSAGE_CHARS),
        "engine_type": message.engine_type,
        "task_type": message.task_type,
        "diagram_version_id": message.diagram_version_id,
        "created_at": _iso(message.created_at),
        "agent_process": _serialize_agent_process(agent_run) if message.role == "assistant" else None,
        # Per-message diagram snapshot for restoring historical versions
        "code": snapshot["code"] if snapshot else None,
        "design_concept": snapshot.get("design_concept") if snapshot else None,
        "diagram_id": snapshot["diagram_id"] if snapshot else None,
    }


async def _load_current_diagram_snapshot(
    session: AsyncSession,
    permission_context: PermissionContext,
    conversation: Conversation,
) -> dict[str, Any] | None:
    """Load the current diagram version needed to hydrate the active canvas."""

    version_id = conversation.current_diagram_version_id
    tenant_id = permission_context.get("tenant_id") or "local"
    if not version_id:
        return None

    version = await session.get(DiagramVersion, version_id)
    if (
        not version
        or version.tenant_id != tenant_id
        or version.conversation_id != conversation.id
    ):
        return None

    diagram = await session.get(Diagram, version.diagram_id)
    if not diagram or diagram.tenant_id != tenant_id:
        return None
    if diagram.project_id and not await can_access_project(
        session,
        permission_context,
        diagram.project_id,
        required_scope="diagram:read",
    ):
        return None

    return {
        "diagram_id": diagram.id,
        "diagram_version_id": version.id,
        "version_number": version.version_number,
        "title": diagram.title,
        "engine_type": version.engine_type or diagram.engine_type,
        "task_type": version.task_type or diagram.task_type,
        "design_concept": version.design_concept,
        "code": version.code,
        "created_at": _iso(version.created_at),
        "updated_at": _iso(diagram.updated_at),
    }


def _matches_query(conversation: Conversation, messages: list[Message], query: str) -> bool:
    if not query:
        return True
    haystacks = [
        conversation.title,
        conversation.summary,
        str((conversation.context_json or {}).get("short_term_memory") or ""),
    ]
    haystacks.extend(message.content for message in messages)
    lowered_query = query.lower()
    return any(lowered_query in str(value or "").lower() for value in haystacks)


async def search_authorized_conversation_history(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    query: str = "",
    project_id: str | None = None,
    status: str = "",
    include_messages: bool = False,
    include_current_diagram: bool = False,
    limit: int = 20,
) -> dict[str, Any]:
    """Search conversations visible to the current permission context."""

    # ── Security: reject anonymous/guest history queries ──
    # All guests share the same identity, so allowing queries would
    # expose other visitors' conversations.
    querying_user = permission_context.get("user_id") or "anonymous"
    if querying_user == "anonymous":
        return {"conversations": [], "count": 0, "limit": limit,
                "include_messages": include_messages,
                "include_current_diagram": include_current_diagram}

    scopes = set(permission_context.get("scopes") or [])
    if "diagram:read" not in scopes and not is_tenant_admin(permission_context):
        raise PermissionError("missing_diagram_read_scope")

    tenant_id = permission_context.get("tenant_id") or "local"
    requested_project_id = project_id or permission_context.get("project_id")
    if requested_project_id and not await can_access_project(
        session,
        permission_context,
        requested_project_id,
        required_scope="diagram:read",
    ):
        raise PermissionError("project_access_denied")

    statement = (
        select(Conversation)
        .where(Conversation.tenant_id == tenant_id)
        .order_by(Conversation.updated_at.desc())
        .limit(max(limit * 4, limit))
    )
    if requested_project_id:
        statement = statement.where(Conversation.project_id == requested_project_id)
    if status:
        statement = statement.where(Conversation.status == status)

    conversations = list((await session.execute(statement)).scalars().all())
    agent_run_cache: dict[str, AgentRun | None] = {}
    items: list[dict[str, Any]] = []
    normalized_query = " ".join(str(query or "").split())

    for conversation in conversations:
        if len(items) >= limit:
            break
        if not await _can_access_conversation(session, permission_context, conversation):
            continue
        recent_messages = await _load_recent_messages(
            session,
            tenant_id=tenant_id,
            conversation_id=conversation.id,
            limit=MAX_RECENT_MESSAGES,
        )
        if not _matches_query(conversation, recent_messages, normalized_query):
            continue
        # Batch-load diagram version snapshots for all messages with a diagram_version_id
        version_snapshots: dict[str, dict[str, Any]] = {}
        if include_messages:
            version_ids = [
                m.diagram_version_id
                for m in recent_messages
                if m.diagram_version_id and m.role == "assistant"
            ]
            if version_ids:
                stmt = select(DiagramVersion).where(DiagramVersion.id.in_(version_ids))
                versions = list((await session.execute(stmt)).scalars().all())
                for v in versions:
                    if v.tenant_id == tenant_id:
                        version_snapshots[v.id] = {
                            "diagram_id": v.diagram_id,
                            "code": v.code,
                            "design_concept": v.design_concept,
                            "engine_type": v.engine_type,
                            "task_type": v.task_type,
                        }
        serialized_messages = [
            await _serialize_message(session, agent_run_cache, message, version_snapshots)
            for message in recent_messages
        ] if include_messages else []
        current_diagram = (
            await _load_current_diagram_snapshot(session, permission_context, conversation)
            if include_current_diagram
            else None
        )
        items.append(
            {
                "conversation_id": conversation.id,
                "title": conversation.title,
                "status": conversation.status,
                "summary": _clip_text(conversation.summary, MAX_SUMMARY_CHARS),
                "tenant_id": conversation.tenant_id,
                "project_id": conversation.project_id,
                "team_id": conversation.team_id,
                "created_by": conversation.created_by,
                "current_diagram_version_id": conversation.current_diagram_version_id,
                "context": {
                    "last_engine_type": (conversation.context_json or {}).get("last_engine_type", ""),
                    "last_task_type": (conversation.context_json or {}).get("last_task_type", ""),
                    "short_term_memory": (conversation.context_json or {}).get("short_term_memory") or {},
                },
                "message_count": len(recent_messages),
                "messages": serialized_messages,
                "current_diagram": current_diagram,
                "created_at": _iso(conversation.created_at),
                "updated_at": _iso(conversation.updated_at),
            }
        )

    session.add(
        AuditEvent(
            tenant_id=tenant_id,
            project_id=requested_project_id,
            user_id=permission_context.get("user_id") or "anonymous",
            event_type="conversation.history.searched",
            severity="info",
            message="Conversation history searched.",
            metadata_json={
                "query_present": bool(normalized_query),
                "project_id": requested_project_id,
                "status": status,
                "include_messages": include_messages,
                "include_current_diagram": include_current_diagram,
                "result_count": len(items),
            },
        )
    )
    return {
        "conversations": items,
        "count": len(items),
        "limit": limit,
        "include_messages": include_messages,
        "include_current_diagram": include_current_diagram,
    }
