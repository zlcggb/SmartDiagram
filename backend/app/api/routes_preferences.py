"""Long-term preference memory API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.services.long_term_memory_service import (
    load_long_term_preferences,
    update_diagram_preferences,
)
from app.services.permission_service import build_permission_context

router = APIRouter(prefix="/preferences", tags=["preferences"])


def _permission_body(
    request: Request,
    tenant_id: str | None,
    user_id: str | None,
    team_id: str | None,
    project_id: str | None,
    roles: str | None,
    scopes: str | None,
) -> dict:
    return {
        "tenant_id": tenant_id or request.headers.get("x-tenant-id"),
        "user_id": user_id or request.headers.get("x-user-id"),
        "team_id": team_id or request.headers.get("x-team-id"),
        "project_id": project_id or request.headers.get("x-project-id"),
        "roles": roles or request.headers.get("x-roles"),
        "scopes": scopes or request.headers.get("x-scopes"),
    }


def _raise_preference_error(exc: Exception) -> None:
    message = str(exc)
    if isinstance(exc, PermissionError):
        status = 403
    elif message.endswith("_not_found"):
        status = 404
    else:
        status = 400
    raise HTTPException(status_code=status, detail=message)


@router.get("/artifact")
@router.get("/diagram")
async def get_artifact_preferences(
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Return merged tenant/team/user/project artifact preferences visible to the caller."""

    permission_context = build_permission_context(
        _permission_body(request, tenant_id, user_id, team_id, project_id, roles, scopes)
    )
    memory = await load_long_term_preferences(session, permission_context)
    if memory.get("status") == "denied":
        raise HTTPException(status_code=403, detail=memory.get("reason", "preference_access_denied"))
    return memory


@router.patch("/artifact")
@router.patch("/diagram")
async def patch_artifact_preferences(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Create or update long-term artifact preferences."""

    body = await request.json()
    permission_context = build_permission_context(
        _permission_body(
            request,
            body.get("tenant_id"),
            body.get("user_id"),
            body.get("team_id"),
            body.get("project_id"),
            body.get("roles"),
            body.get("scopes"),
        )
    )
    try:
        result = await update_diagram_preferences(
            session,
            permission_context,
            scope=str(body.get("scope") or "user"),
            preferences=body.get("preferences") or {},
            merge=bool(body.get("merge", True)),
        )
        await session.commit()
        merged = await load_long_term_preferences(session, permission_context)
        return {**result, "merged": merged}
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_preference_error(exc)
