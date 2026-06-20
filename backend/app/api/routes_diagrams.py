"""Diagram version, branch, and rollback API routes."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.services.diagram_version_service import (
    compare_diagram_versions,
    create_diagram_branch,
    list_diagram_versions,
    rollback_diagram_to_version,
)
from app.services.diagram_history_service import search_authorized_diagram_history
from app.services.permission_service import build_permission_context

router = APIRouter(tags=["diagrams"])


def _body_with_headers(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    merged = dict(body)
    merged.setdefault("tenant_id", request.headers.get("x-tenant-id"))
    merged.setdefault("user_id", request.headers.get("x-user-id"))
    merged.setdefault("team_id", request.headers.get("x-team-id"))
    merged.setdefault("project_id", request.headers.get("x-project-id"))
    merged.setdefault("roles", request.headers.get("x-roles"))
    merged.setdefault("scopes", request.headers.get("x-scopes"))
    return merged


def _raise_diagram_error(exc: Exception) -> None:
    message = str(exc)
    if isinstance(exc, PermissionError):
        status = 403
    elif message.endswith("_not_found"):
        status = 404
    else:
        status = 400
    raise HTTPException(status_code=status, detail=message)


def _bool_value(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    if isinstance(value, (int, float)):
        return value != 0
    return default


@router.get("/diagrams/{diagram_id}/versions")
async def get_diagram_versions(
    diagram_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """List immutable versions for a diagram."""

    permission_context = build_permission_context(_body_with_headers(request, {}))
    try:
        return await list_diagram_versions(session, permission_context, diagram_id)
    except (PermissionError, ValueError) as exc:
        _raise_diagram_error(exc)


@router.get("/diagrams/history")
async def search_diagram_history(
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    query: str = Query(default=""),
    engine_type: str = Query(default=""),
    task_type: str = Query(default=""),
    include_code: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    """Search authorized historical diagrams for project and tenant memory."""

    permission_context = build_permission_context(_body_with_headers(request, dict(request.query_params)))
    try:
        payload = await search_authorized_diagram_history(
            session,
            permission_context,
            query=query,
            project_id=project_id,
            engine_type=engine_type,
            task_type=task_type,
            include_code=include_code,
            limit=limit,
        )
        await session.commit()
        return payload
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_diagram_error(exc)


@router.get("/diagrams/{diagram_id}/versions/{version_id}/diff")
async def diff_diagram_version(
    diagram_id: str,
    version_id: str,
    request: Request,
    target_version_id: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Compare one immutable version with another version, defaulting to current."""

    permission_context = build_permission_context(_body_with_headers(request, dict(request.query_params)))
    try:
        return await compare_diagram_versions(
            session,
            permission_context,
            diagram_id,
            version_id,
            target_version_id=target_version_id,
        )
    except (PermissionError, ValueError) as exc:
        _raise_diagram_error(exc)


@router.post("/diagrams/{diagram_id}/versions/{version_id}/branch")
async def branch_diagram_version(
    diagram_id: str,
    version_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Create a new task branch from a historical diagram version."""

    body = await request.json()
    permission_context = build_permission_context(_body_with_headers(request, body))
    try:
        return await create_diagram_branch(
            session,
            permission_context,
            diagram_id,
            version_id,
            branch_name=str(body.get("branch_name") or body.get("branchName") or "New branch"),
            reason=str(body.get("reason") or "User goal changed"),
            switch_current=_bool_value(body.get("switch_current", body.get("switchCurrent")), True),
        )
    except (PermissionError, ValueError) as exc:
        _raise_diagram_error(exc)


@router.post("/diagrams/{diagram_id}/versions/{version_id}/rollback")
async def rollback_diagram_version(
    diagram_id: str,
    version_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Rollback by appending a new immutable version copied from a prior one."""

    body = await request.json()
    permission_context = build_permission_context(_body_with_headers(request, body))
    try:
        return await rollback_diagram_to_version(
            session,
            permission_context,
            diagram_id,
            version_id,
            reason=str(body.get("reason") or "User requested rollback"),
        )
    except (PermissionError, ValueError) as exc:
        _raise_diagram_error(exc)
