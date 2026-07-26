"""Authenticated model-usage ledger ingestion and query routes."""

import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes_auth import _authenticated_db_user
from app.core.config import settings
from app.core.db import get_session
from app.models.tenant import User
from app.services.auth_service import serialize_user, user_to_permission_context
from app.services.budget_service import get_budget_metrics_snapshot
from app.services.model_usage_service import (
    get_model_usage_dashboard,
    persist_model_usage_event,
    resolve_model_pricing,
    serialize_model_usage_event,
)


router = APIRouter(tags=["billing"])


def _require_ppt_internal_secret(request: Request) -> None:
    expected = settings.PPT_INTERNAL_API_SECRET
    received = request.headers.get("x-ppt-internal-secret", "")
    if not expected or not received or not secrets.compare_digest(received, expected):
        raise HTTPException(status_code=403, detail="Invalid PPT usage reporter secret")


async def _model_usage_reporter_identity(
    request: Request,
    session: AsyncSession,
) -> tuple[str, str]:
    """Resolve identity already authenticated by the trusted PPT service.

    Browser authorization remains a compatibility fallback, but project usage
    persistence must not depend on a bearer token surviving a long model call.
    """

    trusted_user_id = request.headers.get("x-user-id", "").strip()
    trusted_tenant_id = request.headers.get("x-tenant-id", "").strip()
    if trusted_user_id or trusted_tenant_id:
        if not trusted_user_id or not trusted_tenant_id:
            raise HTTPException(status_code=401, detail="Incomplete PPT reporter identity")
        db_user = await session.get(User, trusted_user_id)
        if not db_user or db_user.status != "active":
            raise HTTPException(status_code=401, detail="PPT reporter user is unavailable")
        if db_user.tenant_id != trusted_tenant_id:
            raise HTTPException(status_code=403, detail="PPT reporter tenant mismatch")
        return trusted_tenant_id, trusted_user_id

    token_user, _db_user = await _authenticated_db_user(request, session)
    tenant_id = str(token_user.get("tenant_id") or "")
    user_id = str(token_user.get("id") or token_user.get("user_id") or "")
    if not tenant_id or not user_id:
        raise HTTPException(status_code=401, detail="Invalid authenticated identity")
    return tenant_id, user_id


@router.post("/billing/model-usage-events")
async def ingest_model_usage_event(
    request: Request,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
):
    _require_ppt_internal_secret(request)
    tenant_id, user_id = await _model_usage_reporter_identity(request, session)
    safe_body = dict(body)
    safe_body.pop("tenant_id", None)
    safe_body.pop("user_id", None)
    try:
        event, created = await persist_model_usage_event(
            session,
            tenant_id=tenant_id,
            user_id=user_id,
            payload=safe_body,
            pricing=await resolve_model_pricing(session, settings.MODEL_USAGE_PRICING_JSON),
        )
        await session.commit()
    except ValueError as error:
        await session.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"event": serialize_model_usage_event(event), "created": created}


@router.get("/billing/me/model-usage")
async def current_user_model_usage(
    request: Request,
    period: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    project_id: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    token_user, _db_user = await _authenticated_db_user(request, session)
    permission_context = user_to_permission_context(serialize_user(token_user))
    tenant_id = str(token_user.get("tenant_id") or "")
    user_id = str(token_user.get("id") or token_user.get("user_id") or "")
    dashboard = await get_model_usage_dashboard(
        session,
        tenant_id=tenant_id,
        user_id=user_id,
        period=period,
        project_id=project_id,
        limit=limit,
        offset=offset,
    )
    budget = await get_budget_metrics_snapshot(
        session,
        permission_context,
        include_tenant_limits=True,
        period=dashboard["period"],
    )
    return {**dashboard, "budget": budget.get("budget", {}), "remaining": budget.get("remaining", {})}


@router.get("/billing/pricing")
async def current_effective_pricing(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Return the resolved per-model pricing visible to any authenticated user."""

    await _authenticated_db_user(request, session)
    from app.services.model_usage_service import (
        BUILTIN_MODEL_PRICING,
        load_db_model_pricing,
        pricing_source_for_model,
    )

    db_pricing = await load_db_model_pricing(session)
    resolved = await resolve_model_pricing(session, settings.MODEL_USAGE_PRICING_JSON)
    rates = [
        {
            "model": model,
            "input": rate["input"],
            "output": rate["output"],
            "cache": rate["cache"],
            "currency": rate["currency"],
            "source": pricing_source_for_model(model, db_pricing),
        }
        for model, rate in sorted(resolved.items())
    ]
    return {
        "rates": rates,
        "builtin_models": sorted(BUILTIN_MODEL_PRICING.keys()),
    }
