"""Enterprise diagram version branching, rollback, and diff services."""

import difflib
import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent
from app.models.common import utc_now
from app.models.conversation import Conversation, Message
from app.models.diagram import Diagram, DiagramVersion
from app.services.access_control_service import can_access_project
from app.services.audit_service import ensure_principals
from app.state.agent_runtime import PermissionContext


MAX_DIFF_LINES = 160


def _hash_code(code: str) -> str:
    return hashlib.sha256((code or "").encode("utf-8")).hexdigest()[:16]


def _normalize_lines(code: str) -> list[str]:
    return (code or "").splitlines()


def _safe_json_loads(code: str) -> Any:
    try:
        return json.loads(code)
    except Exception:
        return None


def _collection_by_id(value: Any) -> dict[str, Any]:
    if not isinstance(value, list):
        return {}
    result: dict[str, Any] = {}
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or f"index:{index}")
        result[item_id] = item
    return result


def _label_for_item(item: Any) -> str:
    if not isinstance(item, dict):
        return ""
    data = item.get("data")
    if isinstance(data, dict) and data.get("label") is not None:
        return str(data.get("label"))
    if item.get("label") is not None:
        return str(item.get("label"))
    if item.get("name") is not None:
        return str(item.get("name"))
    return ""


def _collection_diff(base: Any, target: Any) -> dict[str, Any]:
    base_by_id = _collection_by_id(base)
    target_by_id = _collection_by_id(target)
    base_ids = set(base_by_id)
    target_ids = set(target_by_id)
    changed_ids = sorted(
        item_id
        for item_id in base_ids & target_ids
        if base_by_id[item_id] != target_by_id[item_id]
    )
    label_changes = []
    for item_id in changed_ids:
        before = _label_for_item(base_by_id[item_id])
        after = _label_for_item(target_by_id[item_id])
        if before != after:
            label_changes.append(
                {
                    "id": item_id,
                    "before": before,
                    "after": after,
                }
            )
    return {
        "added_ids": sorted(target_ids - base_ids)[:50],
        "removed_ids": sorted(base_ids - target_ids)[:50],
        "changed_ids": changed_ids[:50],
        "label_changes": label_changes[:20],
        "base_count": len(base_by_id),
        "target_count": len(target_by_id),
    }


def _structured_json_diff(base_code: str, target_code: str) -> dict[str, Any]:
    base = _safe_json_loads(base_code)
    target = _safe_json_loads(target_code)
    if not isinstance(base, dict) or not isinstance(target, dict):
        return {"available": False, "reason": "not_json_object"}

    base_keys = set(base)
    target_keys = set(target)
    top_level_changed = sorted(
        key
        for key in base_keys & target_keys
        if base.get(key) != target.get(key)
    )
    result: dict[str, Any] = {
        "available": True,
        "top_level": {
            "added_keys": sorted(target_keys - base_keys),
            "removed_keys": sorted(base_keys - target_keys),
            "changed_keys": top_level_changed,
        },
    }
    if "nodes" in base or "nodes" in target:
        result["nodes"] = _collection_diff(base.get("nodes"), target.get("nodes"))
    if "edges" in base or "edges" in target:
        result["edges"] = _collection_diff(base.get("edges"), target.get("edges"))
    if "series" in base or "series" in target:
        result["series"] = {
            "base_count": len(base.get("series") or []) if isinstance(base.get("series"), list) else 0,
            "target_count": len(target.get("series") or []) if isinstance(target.get("series"), list) else 0,
            "changed": base.get("series") != target.get("series"),
        }
    return result


def build_version_diff_payload(
    *,
    diagram: Diagram,
    base_version: DiagramVersion,
    target_version: DiagramVersion,
) -> dict[str, Any]:
    """Build a deterministic, UI-safe diff between two immutable versions."""

    base_lines = _normalize_lines(base_version.code)
    target_lines = _normalize_lines(target_version.code)
    diff_lines = list(
        difflib.unified_diff(
            base_lines,
            target_lines,
            fromfile=f"v{base_version.version_number}",
            tofile=f"v{target_version.version_number}",
            lineterm="",
        )
    )
    added_lines = [line[1:] for line in diff_lines if line.startswith("+") and not line.startswith("+++")]
    removed_lines = [line[1:] for line in diff_lines if line.startswith("-") and not line.startswith("---")]
    changed_blocks = sum(1 for line in diff_lines if line.startswith("@@"))
    truncated = len(diff_lines) > MAX_DIFF_LINES
    return {
        "diagram_id": diagram.id,
        "base_version": {
            **serialize_diagram_version(base_version),
            "code_hash": _hash_code(base_version.code),
        },
        "target_version": {
            **serialize_diagram_version(target_version),
            "code_hash": _hash_code(target_version.code),
        },
        "summary": {
            "changed": base_version.code != target_version.code
            or base_version.engine_type != target_version.engine_type
            or base_version.task_type != target_version.task_type
            or base_version.design_concept != target_version.design_concept,
            "engine_changed": base_version.engine_type != target_version.engine_type,
            "task_changed": base_version.task_type != target_version.task_type,
            "design_concept_changed": base_version.design_concept != target_version.design_concept,
            "base_line_count": len(base_lines),
            "target_line_count": len(target_lines),
            "line_delta": len(target_lines) - len(base_lines),
            "char_delta": len(target_version.code or "") - len(base_version.code or ""),
            "added_line_count": len(added_lines),
            "removed_line_count": len(removed_lines),
            "changed_blocks": changed_blocks,
            "structured": _structured_json_diff(base_version.code, target_version.code),
        },
        "preview": {
            "added_lines": added_lines[:20],
            "removed_lines": removed_lines[:20],
        },
        "unified_diff": diff_lines[:MAX_DIFF_LINES],
        "truncated": truncated,
    }


async def next_version_number(session: AsyncSession, diagram_id: str) -> int:
    """Return the next immutable version number for a diagram."""

    statement = (
        select(DiagramVersion.version_number)
        .where(DiagramVersion.diagram_id == diagram_id)
        .order_by(DiagramVersion.version_number.desc())
        .limit(1)
    )
    current = (await session.execute(statement)).scalar_one_or_none()
    return int(current or 0) + 1


async def load_authorized_diagram_version(
    session: AsyncSession,
    permission_context: PermissionContext,
    diagram_id: str,
    version_id: str,
    required_scope: str,
) -> tuple[Diagram, DiagramVersion]:
    """Load a diagram/version pair after tenant and project authorization."""

    if required_scope not in permission_context.get("scopes", []):
        raise PermissionError("missing_scope")

    diagram = await session.get(Diagram, diagram_id)
    if not diagram:
        raise ValueError("diagram_not_found")
    if diagram.tenant_id != permission_context["tenant_id"]:
        raise PermissionError("diagram_outside_tenant")

    version = await session.get(DiagramVersion, version_id)
    if not version or version.diagram_id != diagram_id:
        raise ValueError("diagram_version_not_found")
    if version.tenant_id != permission_context["tenant_id"]:
        raise PermissionError("diagram_version_outside_tenant")

    if diagram.project_id:
        permission_context["project_id"] = diagram.project_id
    await ensure_principals(session, permission_context, None)
    if not await can_access_project(session, permission_context, diagram.project_id, required_scope):
        raise PermissionError("missing_project_access")

    return diagram, version


def serialize_diagram_version(version: DiagramVersion) -> dict[str, Any]:
    """Return a frontend/API-safe version payload."""

    return {
        "diagram_version_id": version.id,
        "version_number": version.version_number,
        "engine_type": version.engine_type,
        "task_type": version.task_type,
        "code": version.code,
        "design_concept": version.design_concept,
        "validation": version.validation_json,
        "created_by": version.created_by,
        "created_at": version.created_at.isoformat(),
    }


async def list_diagram_versions(
    session: AsyncSession,
    permission_context: PermissionContext,
    diagram_id: str,
) -> dict[str, Any]:
    """List immutable versions for an authorized diagram."""

    if "diagram:read" not in permission_context.get("scopes", []):
        raise PermissionError("missing_scope")

    diagram = await session.get(Diagram, diagram_id)
    if not diagram:
        raise ValueError("diagram_not_found")
    if diagram.tenant_id != permission_context["tenant_id"]:
        raise PermissionError("diagram_outside_tenant")
    if diagram.project_id:
        permission_context["project_id"] = diagram.project_id
    await ensure_principals(session, permission_context, None)
    if not await can_access_project(session, permission_context, diagram.project_id, "diagram:read"):
        raise PermissionError("missing_project_access")

    statement = (
        select(DiagramVersion)
        .where(DiagramVersion.diagram_id == diagram_id)
        .order_by(DiagramVersion.version_number.asc(), DiagramVersion.created_at.asc())
    )
    versions = list((await session.execute(statement)).scalars().all())
    return {
        "diagram_id": diagram.id,
        "current_version_id": diagram.current_version_id,
        "versions": [serialize_diagram_version(version) for version in versions],
    }


async def compare_diagram_versions(
    session: AsyncSession,
    permission_context: PermissionContext,
    diagram_id: str,
    base_version_id: str,
    *,
    target_version_id: str | None = None,
) -> dict[str, Any]:
    """Compare two authorized immutable diagram versions."""

    diagram, base_version = await load_authorized_diagram_version(
        session,
        permission_context,
        diagram_id,
        base_version_id,
        "diagram:read",
    )
    resolved_target_version_id = target_version_id or diagram.current_version_id
    if not resolved_target_version_id:
        raise ValueError("target_version_not_found")
    target_version = await session.get(DiagramVersion, resolved_target_version_id)
    if not target_version or target_version.diagram_id != diagram.id:
        raise ValueError("target_version_not_found")
    if target_version.tenant_id != permission_context["tenant_id"]:
        raise PermissionError("target_version_outside_tenant")

    payload = build_version_diff_payload(
        diagram=diagram,
        base_version=base_version,
        target_version=target_version,
    )
    session.add(
        AuditEvent(
            tenant_id=permission_context["tenant_id"],
            project_id=diagram.project_id,
            user_id=permission_context.get("user_id"),
            conversation_id=diagram.conversation_id,
            event_type="diagram.version.diff.viewed",
            severity="info",
            message="Viewed deterministic diagram version diff.",
            metadata_json={
                "diagram_id": diagram.id,
                "base_version_id": base_version.id,
                "base_version_number": base_version.version_number,
                "target_version_id": target_version.id,
                "target_version_number": target_version.version_number,
                "changed": payload["summary"]["changed"],
                "added_line_count": payload["summary"]["added_line_count"],
                "removed_line_count": payload["summary"]["removed_line_count"],
            },
        )
    )
    await session.commit()
    return payload


async def create_diagram_branch(
    session: AsyncSession,
    permission_context: PermissionContext,
    diagram_id: str,
    version_id: str,
    *,
    branch_name: str,
    reason: str,
    switch_current: bool = True,
) -> dict[str, Any]:
    """Create a new diagram branch from an immutable source version."""

    source_diagram, source_version = await load_authorized_diagram_version(
        session,
        permission_context,
        diagram_id,
        version_id,
        "diagram:write",
    )
    tenant_id = permission_context["tenant_id"]
    user_id = permission_context["user_id"]
    clean_branch_name = " ".join((branch_name or "New branch").split())[:80]
    clean_reason = " ".join((reason or "User requested a diagram branch").split())[:240]

    branch_metadata = {
        **(source_diagram.metadata_json or {}),
        "branch": {
            "from_diagram_id": source_diagram.id,
            "from_version_id": source_version.id,
            "from_version_number": source_version.version_number,
            "branch_name": clean_branch_name,
            "reason": clean_reason,
            "created_by": user_id,
            "created_at": utc_now().isoformat(),
        },
    }
    branch_diagram = Diagram(
        tenant_id=tenant_id,
        project_id=source_diagram.project_id,
        conversation_id=source_diagram.conversation_id,
        owner_user_id=user_id,
        title=f"{source_diagram.title or source_diagram.engine_type} / {clean_branch_name}"[:80],
        engine_type=source_version.engine_type,
        task_type=source_version.task_type,
        visibility=source_diagram.visibility,
        metadata_json=branch_metadata,
    )
    session.add(branch_diagram)
    await session.flush()

    branch_version = DiagramVersion(
        tenant_id=tenant_id,
        diagram_id=branch_diagram.id,
        conversation_id=source_version.conversation_id,
        message_id=source_version.message_id,
        version_number=1,
        engine_type=source_version.engine_type,
        task_type=source_version.task_type,
        code=source_version.code,
        design_concept=source_version.design_concept,
        validation_json={
            **(source_version.validation_json or {}),
            "branch": {
                "from_diagram_id": source_diagram.id,
                "from_version_id": source_version.id,
                "from_version_number": source_version.version_number,
                "branch_name": clean_branch_name,
                "reason": clean_reason,
            },
        },
        created_by=user_id,
    )
    session.add(branch_version)
    await session.flush()

    branch_diagram.current_version_id = branch_version.id
    if switch_current and branch_diagram.conversation_id:
        conversation = await session.get(Conversation, branch_diagram.conversation_id)
        if conversation and conversation.tenant_id == tenant_id:
            conversation.current_diagram_version_id = branch_version.id
            conversation.updated_at = utc_now()
            conversation.context_json = {
                **(conversation.context_json or {}),
                "active_branch_diagram_id": branch_diagram.id,
                "active_branch_from_diagram_id": source_diagram.id,
            }

    session.add(
        AuditEvent(
            tenant_id=tenant_id,
            project_id=source_diagram.project_id,
            user_id=user_id,
            conversation_id=source_diagram.conversation_id,
            event_type="diagram.branch.created",
            severity="info",
            message="Created diagram branch from historical version.",
            metadata_json={
                "source_diagram_id": source_diagram.id,
                "source_version_id": source_version.id,
                "source_version_number": source_version.version_number,
                "branch_diagram_id": branch_diagram.id,
                "branch_version_id": branch_version.id,
                "branch_name": clean_branch_name,
                "reason": clean_reason,
                "switch_current": switch_current,
            },
        )
    )
    await session.commit()
    return {
        "branched": True,
        "source_diagram_id": source_diagram.id,
        "source_version_id": source_version.id,
        "diagram_id": branch_diagram.id,
        "diagram_version_id": branch_version.id,
        "version_number": branch_version.version_number,
        "branch_name": clean_branch_name,
        "code": branch_version.code,
        "engine_type": branch_version.engine_type,
        "task_type": branch_version.task_type,
        "design_concept": branch_version.design_concept,
    }


async def rollback_diagram_to_version(
    session: AsyncSession,
    permission_context: PermissionContext,
    diagram_id: str,
    version_id: str,
    *,
    reason: str,
) -> dict[str, Any]:
    """Append a rollback version copied from a historical diagram version."""

    diagram, source_version = await load_authorized_diagram_version(
        session,
        permission_context,
        diagram_id,
        version_id,
        "diagram:write",
    )
    tenant_id = permission_context["tenant_id"]
    user_id = permission_context["user_id"]
    clean_reason = " ".join((reason or "User requested rollback").split())[:240]
    new_version_number = await next_version_number(session, diagram.id)
    conversation_id = source_version.conversation_id or diagram.conversation_id
    message: Message | None = None
    if conversation_id:
        message = Message(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            role="system",
            content=f"Rolled back diagram to version {source_version.version_number}.",
            engine_type=source_version.engine_type,
            task_type=source_version.task_type,
            metadata_json={
                "operation": "diagram.rollback",
                "source_version_id": source_version.id,
                "source_version_number": source_version.version_number,
                "reason": clean_reason,
            },
        )
        session.add(message)
        await session.flush()

    rollback_version = DiagramVersion(
        tenant_id=tenant_id,
        diagram_id=diagram.id,
        conversation_id=conversation_id,
        message_id=message.id if message else None,
        version_number=new_version_number,
        engine_type=source_version.engine_type,
        task_type=source_version.task_type,
        code=source_version.code,
        design_concept=source_version.design_concept,
        validation_json={
            **(source_version.validation_json or {}),
            "rollback": {
                "from_version_id": source_version.id,
                "from_version_number": source_version.version_number,
                "new_version_number": new_version_number,
                "reason": clean_reason,
            },
        },
        created_by=user_id,
    )
    session.add(rollback_version)
    await session.flush()

    if message:
        message.diagram_version_id = rollback_version.id
    diagram.current_version_id = rollback_version.id
    diagram.updated_at = utc_now()
    if diagram.conversation_id:
        conversation = await session.get(Conversation, diagram.conversation_id)
        if conversation and conversation.tenant_id == tenant_id:
            conversation.current_diagram_version_id = rollback_version.id
            conversation.updated_at = utc_now()
            conversation.context_json = {
                **(conversation.context_json or {}),
                "last_rollback_from_version_id": source_version.id,
                "last_rollback_to_version_id": rollback_version.id,
            }

    session.add(
        AuditEvent(
            tenant_id=tenant_id,
            project_id=diagram.project_id,
            user_id=user_id,
            conversation_id=diagram.conversation_id,
            event_type="diagram.version.rollback",
            severity="info",
            message="Rolled back diagram by appending a new immutable version.",
            metadata_json={
                "diagram_id": diagram.id,
                "source_version_id": source_version.id,
                "source_version_number": source_version.version_number,
                "rollback_version_id": rollback_version.id,
                "rollback_version_number": rollback_version.version_number,
                "reason": clean_reason,
            },
        )
    )
    await session.commit()
    return {
        "rolled_back": True,
        "diagram_id": diagram.id,
        "source_version_id": source_version.id,
        "source_version_number": source_version.version_number,
        "diagram_version_id": rollback_version.id,
        "version_number": rollback_version.version_number,
        "code": rollback_version.code,
        "engine_type": rollback_version.engine_type,
        "task_type": rollback_version.task_type,
        "design_concept": rollback_version.design_concept,
    }


async def append_manual_diagram_version(
    session: AsyncSession,
    permission_context: PermissionContext,
    diagram_id: str,
    *,
    code: str,
    reason: str = "Manual canvas edit",
) -> dict[str, Any]:
    """Append a new version from a manual canvas edit."""
    if "diagram:write" not in permission_context.get("scopes", []):
        raise PermissionError("missing_scope")

    diagram = await session.get(Diagram, diagram_id)
    if not diagram:
        raise ValueError("diagram_not_found")
    if diagram.tenant_id != permission_context["tenant_id"]:
        raise PermissionError("diagram_outside_tenant")

    if diagram.project_id:
        permission_context["project_id"] = diagram.project_id
    await ensure_principals(session, permission_context, None)
    if not await can_access_project(session, permission_context, diagram.project_id, "diagram:write"):
        raise PermissionError("missing_project_access")

    current_version = None
    if diagram.current_version_id:
        current_version = await session.get(DiagramVersion, diagram.current_version_id)
    
    tenant_id = permission_context["tenant_id"]
    user_id = permission_context["user_id"]
    clean_reason = " ".join((reason or "Manual edit").split())[:240]
    new_version_number = await next_version_number(session, diagram.id)
    conversation_id = diagram.conversation_id

    new_version = DiagramVersion(
        tenant_id=tenant_id,
        diagram_id=diagram.id,
        conversation_id=conversation_id,
        message_id=None,
        version_number=new_version_number,
        engine_type=current_version.engine_type if current_version else diagram.engine_type,
        task_type=current_version.task_type if current_version else diagram.task_type,
        code=code,
        design_concept=current_version.design_concept if current_version else None,
        validation_json={"manual_edit": {"reason": clean_reason}},
        created_by=user_id,
    )
    session.add(new_version)
    await session.flush()

    diagram.current_version_id = new_version.id
    diagram.updated_at = utc_now()
    if diagram.conversation_id:
        conversation = await session.get(Conversation, diagram.conversation_id)
        if conversation and conversation.tenant_id == tenant_id:
            conversation.current_diagram_version_id = new_version.id
            conversation.updated_at = utc_now()

    session.add(
        AuditEvent(
            tenant_id=tenant_id,
            project_id=diagram.project_id,
            user_id=user_id,
            conversation_id=diagram.conversation_id,
            event_type="diagram.version.manual_edit",
            severity="info",
            message="Saved manual diagram edit as new version.",
            metadata_json={
                "diagram_id": diagram.id,
                "version_id": new_version.id,
                "version_number": new_version.version_number,
                "reason": clean_reason,
            },
        )
    )
    await session.commit()
    return {
        "saved": True,
        "diagram_id": diagram.id,
        "diagram_version_id": new_version.id,
        "version_number": new_version.version_number,
        "code": new_version.code,
        "engine_type": new_version.engine_type,
        "task_type": new_version.task_type,
        "design_concept": new_version.design_concept,
    }
