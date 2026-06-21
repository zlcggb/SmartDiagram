"""Admin-only API routes for tenant user management."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.audit import AgentRun
from app.models.conversation import Conversation
from app.models.diagram import Diagram
from app.models.tenant import User
from app.services.access_control_service import is_tenant_admin
from app.services.permission_service import build_permission_context

router = APIRouter(prefix="/admin", tags=["admin"])


def _body_with_headers(request: Request) -> dict[str, Any]:
    headers = request.headers
    merged: dict[str, Any] = dict(request.query_params)
    merged.setdefault("tenant_id", headers.get("x-tenant-id"))
    merged.setdefault("user_id", headers.get("x-user-id"))
    merged.setdefault("team_id", headers.get("x-team-id"))
    merged.setdefault("project_id", headers.get("x-project-id"))
    merged.setdefault("roles", headers.get("x-roles"))
    merged.setdefault("scopes", headers.get("x-scopes"))
    return merged


@router.get("/users")
async def list_tenant_users(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """List all users in the admin's tenant with aggregated resource usage stats."""

    permission_context = build_permission_context(_body_with_headers(request))
    if not is_tenant_admin(permission_context):
        raise HTTPException(status_code=403, detail="admin_role_required")

    tenant_id = permission_context.get("tenant_id") or "local"

    # 1. Load all users in this tenant
    users = list(
        (
            await session.execute(
                select(User)
                .where(User.tenant_id == tenant_id)
                .order_by(User.created_at.asc())
            )
        )
        .scalars()
        .all()
    )

    # 2. Aggregate stats per user from agent_runs
    run_stats_stmt = (
        select(
            AgentRun.user_id,
            func.count(AgentRun.id).label("total_runs"),
            func.coalesce(func.sum(AgentRun.cost_estimate), 0.0).label("total_cost"),
            func.max(AgentRun.started_at).label("last_active_at"),
        )
        .where(AgentRun.tenant_id == tenant_id)
        .group_by(AgentRun.user_id)
    )
    run_stats_rows = (await session.execute(run_stats_stmt)).all()
    run_stats_map: dict[str, dict[str, Any]] = {}
    for row in run_stats_rows:
        run_stats_map[row.user_id or ""] = {
            "total_runs": row.total_runs or 0,
            "total_cost": round(float(row.total_cost or 0.0), 6),
            "last_active_at": row.last_active_at.isoformat() if row.last_active_at else "",
        }

    # 3. Aggregate token usage from agent_runs (token_usage_json is JSON, need manual sum)
    token_stmt = (
        select(AgentRun.user_id, AgentRun.token_usage_json)
        .where(AgentRun.tenant_id == tenant_id)
    )
    token_rows = (await session.execute(token_stmt)).all()
    token_map: dict[str, dict[str, int]] = {}
    for row in token_rows:
        uid = row.user_id or ""
        usage = row.token_usage_json or {}
        if uid not in token_map:
            token_map[uid] = {
                "estimated_input_tokens": 0,
                "estimated_output_tokens": 0,
                "estimated_total_tokens": 0,
            }
        token_map[uid]["estimated_input_tokens"] += int(usage.get("estimated_input_tokens") or 0)
        token_map[uid]["estimated_output_tokens"] += int(usage.get("estimated_output_tokens") or 0)
        token_map[uid]["estimated_total_tokens"] += int(usage.get("estimated_total_tokens") or 0)

    # 4. Count conversations per user
    conv_stmt = (
        select(
            Conversation.created_by,
            func.count(Conversation.id).label("total_conversations"),
        )
        .where(Conversation.tenant_id == tenant_id)
        .group_by(Conversation.created_by)
    )
    conv_rows = (await session.execute(conv_stmt)).all()
    conv_map = {row.created_by or "": row.total_conversations or 0 for row in conv_rows}

    # 5. Count diagrams per user
    diag_stmt = (
        select(
            Diagram.owner_user_id,
            func.count(Diagram.id).label("total_diagrams"),
        )
        .where(Diagram.tenant_id == tenant_id)
        .group_by(Diagram.owner_user_id)
    )
    diag_rows = (await session.execute(diag_stmt)).all()
    diag_map = {row.owner_user_id or "": row.total_diagrams or 0 for row in diag_rows}

    # 6. Assemble response
    result = []
    for user in users:
        uid = user.id
        runs = run_stats_map.get(uid, {})
        tokens = token_map.get(uid, {})
        result.append({
            "id": uid,
            "email": user.email,
            "display_name": user.display_name,
            "role": user.role,
            "status": user.status,
            "tenant_id": user.tenant_id,
            "created_at": user.created_at.isoformat() if user.created_at else "",
            "stats": {
                "total_runs": runs.get("total_runs", 0),
                "total_conversations": conv_map.get(uid, 0),
                "total_diagrams": diag_map.get(uid, 0),
                "estimated_input_tokens": tokens.get("estimated_input_tokens", 0),
                "estimated_output_tokens": tokens.get("estimated_output_tokens", 0),
                "estimated_total_tokens": tokens.get("estimated_total_tokens", 0),
                "estimated_cost": runs.get("total_cost", 0.0),
                "last_active_at": runs.get("last_active_at", ""),
            },
        })

    return {"users": result, "count": len(result)}
