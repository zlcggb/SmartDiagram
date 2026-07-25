"""Admin-only CRUD for editable per-model pricing rates."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.common import utc_now
from app.models.model_pricing import ModelPricingRate
from app.services.access_control_service import is_tenant_admin
from app.services.model_usage_service import (
    BUILTIN_MODEL_PRICING,
    load_db_model_pricing,
    pricing_source_for_model,
    resolve_model_pricing,
)
from app.services.permission_service import build_permission_context
from app.core.config import settings

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


def _require_admin(request: Request) -> None:
    permission_context = build_permission_context(_body_with_headers(request))
    if not is_tenant_admin(permission_context):
        raise HTTPException(status_code=403, detail="admin_role_required")


def _serialize_rate(model: str, rate: dict[str, Any], source: str, row: ModelPricingRate | None) -> dict[str, Any]:
    return {
        "model": model,
        "input": rate["input"],
        "output": rate["output"],
        "cache": rate["cache"],
        "currency": rate["currency"],
        "source": source,
        "note": row.note if row else "",
        "updated_by": row.updated_by if row else "",
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else "",
    }


class PricingRateIn(BaseModel):
    model: str = Field(min_length=1, max_length=128)
    input: float = Field(default=0.0, ge=0)
    output: float = Field(default=0.0, ge=0)
    cache: float = Field(default=0.0, ge=0)
    currency: str = Field(default="CNY", max_length=8)
    note: str = Field(default="", max_length=240)


@router.get("/pricing")
async def list_pricing(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """List the resolved effective pricing plus per-model source for admins."""

    _require_admin(request)
    db_pricing = await load_db_model_pricing(session)
    resolved = await resolve_model_pricing(session, settings.MODEL_USAGE_PRICING_JSON)
    rows = {
        row.model: row
        for row in (await session.execute(select(ModelPricingRate))).scalars().all()
    }
    rates = [
        _serialize_rate(model, rate, pricing_source_for_model(model, db_pricing), rows.get(model))
        for model, rate in sorted(resolved.items())
    ]
    return {"rates": rates, "builtin_models": sorted(BUILTIN_MODEL_PRICING.keys())}


@router.put("/pricing/{model}")
async def upsert_pricing(
    model: str,
    body: PricingRateIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Create or update the admin-edited price for one model."""

    _require_admin(request)
    if body.model.strip() != model.strip():
        raise HTTPException(status_code=400, detail="model_mismatch")
    row = (
        await session.execute(select(ModelPricingRate).where(ModelPricingRate.model == model))
    ).scalars().first()
    if row is None:
        row = ModelPricingRate(model=model.strip())
        session.add(row)
    row.input_price = max(0.0, float(body.input))
    row.output_price = max(0.0, float(body.output))
    row.cache_price = max(0.0, float(body.cache))
    row.currency = (body.currency or "CNY").strip()[:8] or "CNY"
    row.note = body.note.strip()[:240]
    row.source = "manual"
    row.updated_by = str(request.headers.get("x-user-id") or "")
    row.updated_at = utc_now()
    await session.commit()
    return {
        "rate": _serialize_rate(
            row.model,
            {"input": row.input_price, "output": row.output_price, "cache": row.cache_price, "currency": row.currency},
            "database",
            row,
        )
    }


@router.delete("/pricing/{model}")
async def delete_pricing(
    model: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Remove the admin override for a model (falls back to env/builtin)."""

    _require_admin(request)
    row = (
        await session.execute(select(ModelPricingRate).where(ModelPricingRate.model == model))
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="pricing_not_found")
    await session.delete(row)
    await session.commit()
    return {"deleted": model}
