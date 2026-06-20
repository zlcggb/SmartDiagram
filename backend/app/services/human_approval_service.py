"""Human approval request services for Agent checkpoints."""

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent, HumanApprovalRequest
from app.models.common import utc_now
from app.services.access_control_service import can_access_project
from app.services.audit_service import ensure_principals
from app.state.agent_runtime import PermissionContext


APPROVAL_DECISIONS = {"approved", "rejected"}


def _require_scope(permission_context: PermissionContext, required_scope: str) -> None:
    if required_scope not in permission_context.get("scopes", []):
        raise PermissionError("missing_approval_scope")


def serialize_approval_request(approval: HumanApprovalRequest) -> dict[str, Any]:
    """Return a safe approval payload for APIs and SSE."""

    return {
        "approval_id": approval.id,
        "tenant_id": approval.tenant_id,
        "project_id": approval.project_id,
        "conversation_id": approval.conversation_id,
        "agent_run_id": approval.agent_run_id,
        "approval_type": approval.approval_type,
        "status": approval.status,
        "required_scope": approval.required_scope,
        "reason": approval.reason,
        "resource": approval.resource_json,
        "decision": approval.decision_json,
        "requested_by": approval.requested_by,
        "decided_by": approval.decided_by,
        "created_at": approval.created_at.isoformat(),
        "decided_at": approval.decided_at.isoformat() if approval.decided_at else None,
        "expires_at": approval.expires_at.isoformat() if approval.expires_at else None,
    }


async def create_human_approval_request(
    session: AsyncSession,
    *,
    permission_context: PermissionContext,
    approval_type: str,
    reason: str,
    resource_json: dict[str, Any],
    conversation_id: str | None = None,
    agent_run_id: str | None = None,
    required_scope: str = "approval:write",
    ttl_seconds: int | None = 86400,
) -> HumanApprovalRequest:
    """Create a pending approval request and audit event."""

    _require_scope(permission_context, "approval:write")
    project_id = permission_context.get("project_id") or resource_json.get("project_id")
    if not await can_access_project(session, permission_context, project_id, "diagram:write"):
        raise PermissionError("missing_project_access")

    await ensure_principals(session, permission_context, conversation_id)
    now = utc_now()
    approval = HumanApprovalRequest(
        tenant_id=permission_context.get("tenant_id") or "local",
        project_id=project_id,
        conversation_id=conversation_id,
        agent_run_id=agent_run_id,
        requested_by=permission_context.get("user_id") or "anonymous",
        approval_type=approval_type,
        status="pending",
        required_scope=required_scope,
        reason=reason[:500],
        resource_json=resource_json,
        expires_at=now + timedelta(seconds=ttl_seconds) if ttl_seconds else None,
    )
    session.add(approval)
    await session.flush()
    session.add(
        AuditEvent(
            tenant_id=approval.tenant_id,
            project_id=approval.project_id,
            user_id=approval.requested_by,
            conversation_id=conversation_id,
            agent_run_id=agent_run_id,
            event_type="human.approval.requested",
            severity="warning",
            message=reason[:500],
            metadata_json={
                "approval_id": approval.id,
                "approval_type": approval.approval_type,
                "required_scope": approval.required_scope,
                "resource": resource_json,
            },
        )
    )
    return approval


async def get_authorized_approval_request(
    session: AsyncSession,
    permission_context: PermissionContext,
    approval_id: str,
    *,
    required_scope: str = "approval:read",
) -> HumanApprovalRequest:
    """Load an approval request with tenant, scope, and project checks."""

    _require_scope(permission_context, required_scope)
    approval = await session.get(HumanApprovalRequest, approval_id)
    if not approval:
        raise ValueError("approval_not_found")
    if approval.tenant_id != permission_context.get("tenant_id"):
        raise PermissionError("approval_outside_tenant")
    if not await can_access_project(session, permission_context, approval.project_id, "diagram:read"):
        raise PermissionError("missing_project_access")
    return approval


async def decide_human_approval_request(
    session: AsyncSession,
    *,
    permission_context: PermissionContext,
    approval_id: str,
    decision: str,
    comment: str = "",
) -> HumanApprovalRequest:
    """Approve or reject a pending approval request."""

    normalized = (decision or "").strip().lower()
    if normalized not in APPROVAL_DECISIONS:
        raise ValueError("invalid_approval_decision")

    approval = await get_authorized_approval_request(
        session,
        permission_context,
        approval_id,
        required_scope="approval:write",
    )
    if not await can_access_project(session, permission_context, approval.project_id, "diagram:write"):
        raise PermissionError("missing_project_access")
    if approval.status != "pending":
        raise ValueError("approval_already_decided")
    now = utc_now()
    if approval.expires_at and approval.expires_at < now:
        approval.status = "expired"
        raise ValueError("approval_expired")

    approval.status = normalized
    approval.decided_by = permission_context.get("user_id") or "anonymous"
    approval.decided_at = now
    approval.decision_json = {
        "decision": normalized,
        "comment": comment[:500],
        "decided_at": now.isoformat(),
    }
    session.add(
        AuditEvent(
            tenant_id=approval.tenant_id,
            project_id=approval.project_id,
            user_id=approval.decided_by,
            conversation_id=approval.conversation_id,
            agent_run_id=approval.agent_run_id,
            event_type="human.approval.decided",
            severity="info" if normalized == "approved" else "warning",
            message=f"Human approval {normalized}.",
            metadata_json={
                "approval_id": approval.id,
                "approval_type": approval.approval_type,
                "decision": normalized,
                "comment": comment[:500],
                "resource": approval.resource_json,
            },
        )
    )
    return approval


async def list_human_approval_requests(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    status: str | None = None,
    limit: int = 50,
) -> list[HumanApprovalRequest]:
    """List approval requests for the current tenant/project scope."""

    _require_scope(permission_context, "approval:read")
    tenant_id = permission_context.get("tenant_id") or "local"
    statement = (
        select(HumanApprovalRequest)
        .where(HumanApprovalRequest.tenant_id == tenant_id)
        .order_by(HumanApprovalRequest.created_at.desc())
        .limit(max(1, min(limit, 100)))
    )
    if permission_context.get("project_id"):
        statement = statement.where(
            (HumanApprovalRequest.project_id == permission_context["project_id"])
            | (HumanApprovalRequest.project_id.is_(None))
        )
    if status:
        statement = statement.where(HumanApprovalRequest.status == status)
    approvals = list((await session.execute(statement)).scalars().all())
    allowed = []
    for approval in approvals:
        if await can_access_project(session, permission_context, approval.project_id, "diagram:read"):
            allowed.append(approval)
    return allowed
