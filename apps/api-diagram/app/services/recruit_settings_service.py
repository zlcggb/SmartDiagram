"""Recruit workspace settings (default models per AI role) and per-analysis token usage."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.llm import list_available_models
from app.models.common import utc_now
from app.models.recruit import RecruitActivity, RecruitSetting
from app.services.recruit_ai_usage import MODEL_ROLES, role_model
from app.services.recruit_service import _current_user_id, _ensure_write_access

MODEL_ID_RE = re.compile(r"^[\w.\-:/@]{1,128}$")
SCREENED_ACTIVITY = "candidate.screened"
_USAGE_SCAN_LIMIT = 1000


async def _setting_row(session: AsyncSession, tenant_id: str) -> RecruitSetting | None:
    return (
        await session.execute(select(RecruitSetting).where(RecruitSetting.tenant_id == tenant_id))
    ).scalars().first()


async def saved_models(session: AsyncSession, permission_context: dict[str, Any]) -> dict[str, str]:
    row = await _setting_row(session, permission_context["tenant_id"])
    stored = ((row.settings_json if row else {}) or {}).get("models") or {}
    return {role: str(stored.get(role) or "") for role in MODEL_ROLES}


async def get_ai_settings(session: AsyncSession, permission_context: dict[str, Any]) -> dict[str, Any]:
    models = await saved_models(session, permission_context)
    catalog = await list_available_models()
    return {
        "models": models,
        # What runs when the saved value is empty: role env var, then the global MODEL_ID.
        "fallbacks": {role: role_model(role) or catalog["default"] for role in MODEL_ROLES},
        "catalog": catalog["models"],
    }


async def update_ai_settings(session: AsyncSession, permission_context: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    await _ensure_write_access(session, permission_context, None)
    incoming = body.get("models") if isinstance(body.get("models"), dict) else {}
    models: dict[str, str] = {}
    for role in MODEL_ROLES:
        value = str(incoming.get(role) or "").strip()
        if value and not MODEL_ID_RE.match(value):
            raise ValueError("model_invalid")
        models[role] = value
    row = await _setting_row(session, permission_context["tenant_id"])
    if row is None:
        row = RecruitSetting(tenant_id=permission_context["tenant_id"])
        session.add(row)
    row.settings_json = {**(row.settings_json or {}), "models": models}
    row.updated_by = _current_user_id(permission_context)
    row.updated_at = utc_now()
    await session.commit()
    return await get_ai_settings(session, permission_context)


async def list_ai_usage(session: AsyncSession, permission_context: dict[str, Any], *, limit: int = 50) -> dict[str, Any]:
    rows = (
        await session.execute(
            select(RecruitActivity)
            .where(
                RecruitActivity.tenant_id == permission_context["tenant_id"],
                RecruitActivity.activity_type == SCREENED_ACTIVITY,
            )
            .order_by(desc(RecruitActivity.created_at))
            .limit(_USAGE_SCAN_LIMIT)
        )
    ).scalars().all()
    records: list[dict[str, Any]] = []
    by_model: dict[str, dict[str, int]] = defaultdict(lambda: {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0})
    totals = {"analyses": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    for row in rows:
        usage = (row.metadata_json or {}).get("ai_usage")
        if not isinstance(usage, dict):
            continue
        totals["analyses"] += 1
        for key in ("input_tokens", "output_tokens", "total_tokens"):
            totals[key] += int(usage.get(key) or 0)
        for call in usage.get("calls") or []:
            bucket = by_model[str(call.get("model") or "unknown")]
            bucket["calls"] += 1
            for key in ("input_tokens", "output_tokens", "total_tokens"):
                bucket[key] += int(call.get(key) or 0)
        if len(records) < limit:
            records.append({
                "activity_id": row.id,
                "candidate_id": row.candidate_id,
                "job_id": row.job_id,
                "candidate_name": (row.metadata_json or {}).get("candidate_name") or row.message.removesuffix(" 完成 AI 初筛"),
                "score": (row.metadata_json or {}).get("score"),
                "usage": usage,
                "created_at": row.created_at.isoformat(),
            })
    return {
        "totals": totals,
        "by_model": sorted(({"model": model, **values} for model, values in by_model.items()), key=lambda item: -item["total_tokens"]),
        "records": records,
    }
