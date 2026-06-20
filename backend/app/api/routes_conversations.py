"""Conversation history API routes."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.services.conversation_history_service import search_authorized_conversation_history
from app.services.permission_service import build_permission_context

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _permission_body(request: Request, query: dict[str, Any]) -> dict[str, Any]:
    return {
        "tenant_id": query.get("tenant_id") or request.headers.get("x-tenant-id"),
        "user_id": query.get("user_id") or request.headers.get("x-user-id"),
        "team_id": query.get("team_id") or request.headers.get("x-team-id"),
        "project_id": query.get("project_id") or request.headers.get("x-project-id"),
        "roles": query.get("roles") or request.headers.get("x-roles"),
        "scopes": query.get("scopes") or request.headers.get("x-scopes"),
    }


@router.get("/history")
async def search_conversation_history(
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    query: str = Query(default=""),
    status: str = Query(default=""),
    include_messages: bool = Query(default=False),
    include_current_diagram: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    """Search authorized conversation history with optional message replay data."""

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
    try:
        payload = await search_authorized_conversation_history(
            session,
            permission_context,
            query=query,
            project_id=project_id,
            status=status,
            include_messages=include_messages,
            include_current_diagram=include_current_diagram,
            limit=limit,
        )
        await session.commit()
        return payload
    except PermissionError as exc:
        await session.rollback()
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
