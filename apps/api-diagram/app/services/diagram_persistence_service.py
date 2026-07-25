"""Non-blocking persistence for generated diagram versions."""

import asyncio
import json
from typing import Any, TypedDict

from sqlalchemy import select

from app.core.db import async_session
from app.core.logger import logger
from app.models.audit import AgentRun, AuditEvent
from app.models.common import new_id, utc_now
from app.models.conversation import Conversation, Message
from app.models.diagram import Diagram, DiagramVersion
from app.artifacts.catalog import artifact_family_for_engine, is_office_artifact
from app.services.access_control_service import ensure_project_membership, ensure_team_membership
from app.services.audit_service import AUDIT_TIMEOUT_SECONDS, ensure_principals
from app.services.conversation_memory_service import update_conversation_summary
from app.state.agent_runtime import PermissionContext


class DiagramPersistenceResult(TypedDict):
    persisted: bool
    conversation_id: str
    diagram_id: str
    diagram_version_id: str
    version_number: int


def create_conversation_id() -> str:
    """Create a stable conversation id for clients that did not provide one."""

    return new_id()


def _title_from_message(message: str, fallback: str) -> str:
    title = " ".join((message or "").strip().split())
    if not title:
        return fallback
    return title[:80]


def _office_title_from_code(diagram_code: str, fallback: str) -> str:
    try:
        payload = json.loads(diagram_code)
    except json.JSONDecodeError:
        return fallback
    if not isinstance(payload, dict):
        return fallback
    email = payload.get("email") if isinstance(payload.get("email"), dict) else {}
    title = str(email.get("subject") or payload.get("title") or "").strip()
    return title[:80] if title else fallback


async def _next_version_number(session, diagram_id: str) -> int:
    statement = (
        select(DiagramVersion.version_number)
        .where(DiagramVersion.diagram_id == diagram_id)
        .order_by(DiagramVersion.version_number.desc())
        .limit(1)
    )
    current = (await session.execute(statement)).scalar_one_or_none()
    return int(current or 0) + 1


async def _persist_generated_diagram(
    permission_context: PermissionContext,
    conversation_id: str,
    user_message: str,
    assistant_content: str,
    diagram_code: str,
    design_concept: str,
    task_type: str,
    engine_type: str,
    validation_events: list[dict[str, Any]],
    run_id: str | None,
    diagram_id: str | None,
) -> DiagramPersistenceResult:
    tenant_id = permission_context.get("tenant_id") or "local"
    user_id = permission_context.get("user_id") or "anonymous"
    project_id = permission_context.get("project_id")
    team_id = permission_context.get("team_id")
    artifact_family = artifact_family_for_engine(engine_type)
    artifact_metadata = {
        "team_id": team_id,
        "artifact_family": artifact_family,
        "artifact_type": engine_type if artifact_family != "general" else "",
    }
    fallback_title = _title_from_message(user_message, f"{engine_type or 'diagram'} artifact")
    title = _office_title_from_code(diagram_code, fallback_title) if is_office_artifact(engine_type) else fallback_title

    async with async_session() as session:
        created_principals = await ensure_principals(session, permission_context, conversation_id)
        if created_principals.get("team"):
            await ensure_team_membership(session, permission_context)
        if created_principals.get("project"):
            await ensure_project_membership(
                session,
                permission_context,
                scopes=[
                    "project:read",
                    "project:write",
                    "diagram:read",
                    "diagram:write",
                    "artifact:read",
                    "artifact:write",
                    "export:basic",
                    "export:pdf",
                    "export:pptx",
                ],
            )

        conversation = await session.get(Conversation, conversation_id)
        if conversation:
            conversation.updated_at = utc_now()
            if not conversation.title:
                conversation.title = _title_from_message(user_message, "SmartDiagram conversation")
            conversation.context_json = {
                **(conversation.context_json or {}),
                "last_engine_type": engine_type,
                "last_task_type": task_type,
            }

        user_msg = Message(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            role="user",
            content=user_message,
            metadata_json={"agent_run_id": run_id},
        )
        session.add(user_msg)

        diagram = await session.get(Diagram, diagram_id) if diagram_id else None
        if diagram and diagram.tenant_id != tenant_id:
            diagram = None
        if not diagram:
            diagram = Diagram(
                tenant_id=tenant_id,
                project_id=project_id,
                conversation_id=conversation_id,
                owner_user_id=user_id,
                title=title,
                engine_type=engine_type,
                task_type=task_type,
                metadata_json=artifact_metadata,
            )
            session.add(diagram)
            await session.flush()
            version_number = 1
        else:
            diagram.updated_at = utc_now()
            diagram.engine_type = engine_type or diagram.engine_type
            diagram.task_type = task_type or diagram.task_type
            diagram.metadata_json = {
                **(diagram.metadata_json or {}),
                **artifact_metadata,
            }
            version_number = await _next_version_number(session, diagram.id)

        assistant_msg = Message(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            role="assistant",
            content=assistant_content,
            engine_type=engine_type,
            task_type=task_type,
            metadata_json={"agent_run_id": run_id},
        )
        session.add(assistant_msg)
        await session.flush()

        version = DiagramVersion(
            tenant_id=tenant_id,
            diagram_id=diagram.id,
            conversation_id=conversation_id,
            message_id=assistant_msg.id,
            version_number=version_number,
            engine_type=engine_type,
            task_type=task_type,
            code=diagram_code,
            design_concept=design_concept,
            validation_json={
                "events": validation_events,
                "ok": all(event.get("ok", True) for event in validation_events),
                "artifact_family": artifact_family,
                "artifact_type": engine_type if artifact_family != "general" else "",
            },
            created_by=user_id,
        )
        session.add(version)
        await session.flush()

        assistant_msg.diagram_version_id = version.id
        diagram.current_version_id = version.id
        if conversation:
            await update_conversation_summary(
                session,
                permission_context=permission_context,
                conversation_id=conversation_id,
                user_message=user_message,
                assistant_content=assistant_content,
                design_concept=design_concept,
                task_type=task_type,
                engine_type=engine_type,
                diagram_version_id=version.id,
            )

        persisted_run_id = run_id if run_id and await session.get(AgentRun, run_id) else None
        session.add(
            AuditEvent(
                tenant_id=tenant_id,
                project_id=project_id,
                user_id=user_id,
                conversation_id=conversation_id,
                agent_run_id=persisted_run_id,
                event_type="diagram.version.created",
                severity="info",
                message="Generated artifact version persisted.",
                metadata_json={
                    "diagram_id": diagram.id,
                    "diagram_version_id": version.id,
                    "version_number": version.version_number,
                    "engine_type": engine_type,
                    "task_type": task_type,
                    "artifact_family": artifact_family,
                    "artifact_type": engine_type if artifact_family != "general" else "",
                    "validation_count": len(validation_events),
                },
            )
        )

        await session.commit()
        return {
            "persisted": True,
            "conversation_id": conversation_id,
            "diagram_id": diagram.id,
            "diagram_version_id": version.id,
            "version_number": version.version_number,
        }


async def persist_generated_diagram(
    permission_context: PermissionContext,
    conversation_id: str,
    user_message: str,
    assistant_content: str,
    diagram_code: str,
    design_concept: str,
    task_type: str,
    engine_type: str,
    validation_events: list[dict[str, Any]] | None = None,
    run_id: str | None = None,
    diagram_id: str | None = None,
) -> DiagramPersistenceResult | None:
    """Try to save a generated diagram without blocking the chat stream."""

    if not diagram_code.strip() or not engine_type:
        return None
    # ── Security: never persist conversations for anonymous/guest users ──
    # All guests share tenant_id="anonymous-local" + user_id="anonymous",
    # so persisting would leak data between unrelated visitors.
    user_id = permission_context.get("user_id") or "anonymous"
    if user_id == "anonymous":
        return None
    try:
        return await asyncio.wait_for(
            _persist_generated_diagram(
                permission_context=permission_context,
                conversation_id=conversation_id,
                user_message=user_message,
                assistant_content=assistant_content,
                diagram_code=diagram_code,
                design_concept=design_concept,
                task_type=task_type,
                engine_type=engine_type,
                validation_events=validation_events or [],
                run_id=run_id,
                diagram_id=diagram_id,
            ),
            timeout=AUDIT_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning(f"Diagram persistence skipped: {exc}")
        return {
            "persisted": False,
            "conversation_id": conversation_id,
            "diagram_id": diagram_id or "",
            "diagram_version_id": "",
            "version_number": 0,
        }
