"""Human approval request API routes."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.services.human_approval_service import (
    create_human_approval_request,
    decide_human_approval_request,
    get_authorized_approval_request,
    list_human_approval_requests,
    serialize_approval_request,
)
from app.services.permission_service import build_permission_context

router = APIRouter(tags=["approvals"])


def _body_with_headers(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    merged = dict(body)
    merged.setdefault("tenant_id", request.headers.get("x-tenant-id"))
    merged.setdefault("user_id", request.headers.get("x-user-id"))
    merged.setdefault("team_id", request.headers.get("x-team-id"))
    merged.setdefault("project_id", request.headers.get("x-project-id"))
    merged.setdefault("roles", request.headers.get("x-roles"))
    merged.setdefault("scopes", request.headers.get("x-scopes"))
    return merged


def _raise_approval_error(exc: Exception) -> None:
    message = str(exc)
    if isinstance(exc, PermissionError):
        status = 403
    elif message.endswith("_not_found"):
        status = 404
    else:
        status = 400
    raise HTTPException(status_code=status, detail=message)


@router.post("/approvals")
async def create_approval(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Create a durable human approval request."""

    body = await request.json()
    permission_context = build_permission_context(_body_with_headers(request, body))
    try:
        approval = await create_human_approval_request(
            session,
            permission_context=permission_context,
            approval_type=str(body.get("approval_type") or body.get("approvalType") or "generic"),
            reason=str(body.get("reason") or "Human approval required"),
            resource_json=body.get("resource") if isinstance(body.get("resource"), dict) else {},
            conversation_id=body.get("conversation_id") or body.get("conversationId"),
            agent_run_id=body.get("agent_run_id") or body.get("agentRunId"),
            required_scope=str(body.get("required_scope") or body.get("requiredScope") or "approval:write"),
        )
        await session.commit()
        return serialize_approval_request(approval)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_approval_error(exc)


@router.get("/approvals")
async def list_approvals(
    request: Request,
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    """List approval requests visible to the caller."""

    permission_context = build_permission_context(_body_with_headers(request, dict(request.query_params)))
    try:
        approvals = await list_human_approval_requests(
            session,
            permission_context,
            status=status,
            limit=limit,
        )
        return {"approvals": [serialize_approval_request(item) for item in approvals]}
    except (PermissionError, ValueError) as exc:
        _raise_approval_error(exc)


@router.get("/approvals/{approval_id}")
async def get_approval(
    approval_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Get one approval request."""

    permission_context = build_permission_context(_body_with_headers(request, dict(request.query_params)))
    try:
        approval = await get_authorized_approval_request(
            session,
            permission_context,
            approval_id,
            required_scope="approval:read",
        )
        return serialize_approval_request(approval)
    except (PermissionError, ValueError) as exc:
        _raise_approval_error(exc)


@router.post("/approvals/{approval_id}/decision")
async def decide_approval(
    approval_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Approve or reject one approval request."""

    body = await request.json()
    permission_context = build_permission_context(_body_with_headers(request, body))
    try:
        approval = await decide_human_approval_request(
            session,
            permission_context=permission_context,
            approval_id=approval_id,
            decision=str(body.get("decision") or ""),
            comment=str(body.get("comment") or ""),
        )
        await session.commit()
        return serialize_approval_request(approval)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_approval_error(exc)
