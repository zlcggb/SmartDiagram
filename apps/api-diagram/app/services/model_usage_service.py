"""Persistence, pricing, and query helpers for model usage events."""

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AgentRun
from app.models.model_pricing import ModelPricingRate
from app.models.model_usage import ModelUsageEvent
from app.services.budget_service import budget_period_bounds, current_budget_period


MAX_SUMMARY_CHARS = 240
MAX_ERROR_CHARS = 500


def _non_negative_int(value: Any, *, maximum: int = 2_147_483_647) -> int:
    try:
        parsed = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(maximum, parsed))


def _parse_datetime(value: Any) -> datetime | None:
    parsed: datetime | None = value if isinstance(value, datetime) else None
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed is None:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _short_text(value: Any, limit: int) -> str:
    return str(value or "").replace("\x00", "").strip()[:limit]


def parse_model_pricing(raw: str | dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if isinstance(raw, dict):
        source = raw
    else:
        try:
            source = json.loads(raw or "{}")
        except (TypeError, json.JSONDecodeError):
            return {}
    if not isinstance(source, dict):
        return {}
    normalized: dict[str, dict[str, Any]] = {}
    for model, value in source.items():
        if not isinstance(model, str) or not isinstance(value, dict):
            continue
        normalized[model] = {
            "input": max(0.0, float(value.get("input") or 0.0)),
            "output": max(0.0, float(value.get("output") or 0.0)),
            "cache": max(0.0, float(value.get("cache") or 0.0)),
            "currency": _short_text(value.get("currency") or "CNY", 8) or "CNY",
        }
    return normalized


# Built-in reference prices (CNY per 1M tokens) for the models this deployment
# uses. These are the lowest-precedence tier: env MODEL_USAGE_PRICING_JSON
# overrides them, and admin-edited DB rows override both. Keeping them here means
# a fresh deployment prices the known models sensibly out of the box.
BUILTIN_MODEL_PRICING: dict[str, dict[str, Any]] = {
    "gpt-5.3-codex-spark": {"input": 18.0, "output": 72.0, "cache": 9.0, "currency": "CNY"},
    "gpt-5.6-sol": {"input": 18.0, "output": 72.0, "cache": 9.0, "currency": "CNY"},
    "gpt-5.6-terra": {"input": 18.0, "output": 72.0, "cache": 9.0, "currency": "CNY"},
    "gemini-3.6-flash-high": {"input": 0.5, "output": 2.0, "cache": 0.125, "currency": "CNY"},
}


def _pricing_from_db_rows(rows: list[ModelPricingRate]) -> dict[str, dict[str, Any]]:
    pricing: dict[str, dict[str, Any]] = {}
    for row in rows:
        pricing[row.model] = {
            "input": max(0.0, float(row.input_price or 0.0)),
            "output": max(0.0, float(row.output_price or 0.0)),
            "cache": max(0.0, float(row.cache_price or 0.0)),
            "currency": _short_text(row.currency or "CNY", 8) or "CNY",
        }
    return pricing


async def load_db_model_pricing(session: AsyncSession) -> dict[str, dict[str, Any]]:
    """Return all admin-edited pricing rows as a pricing dict."""

    rows = list((await session.execute(select(ModelPricingRate))).scalars().all())
    return _pricing_from_db_rows(rows)


async def resolve_model_pricing(
    session: AsyncSession,
    env_raw: str | dict[str, Any] | None,
) -> dict[str, dict[str, Any]]:
    """Merge pricing tiers: builtin < env < DB. DB (admin-edited) wins."""

    resolved: dict[str, dict[str, Any]] = dict(BUILTIN_MODEL_PRICING)
    resolved.update(parse_model_pricing(env_raw))
    resolved.update(await load_db_model_pricing(session))
    return resolved


def pricing_source_for_model(model: str, db_pricing: dict[str, dict[str, Any]]) -> str:
    """Label where the effective rate for a model came from."""

    if model in db_pricing:
        return "database"
    if model in BUILTIN_MODEL_PRICING:
        return "builtin"
    return "env"


def calculate_model_usage_cost(
    *,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int,
    pricing: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    rate = pricing.get(model)
    if not rate:
        return {
            "estimated_cost": 0.0,
            "currency": "CNY",
            "pricing_source": "unpriced",
        }
    safe_input = _non_negative_int(input_tokens)
    safe_output = _non_negative_int(output_tokens)
    safe_cached = min(safe_input, _non_negative_int(cached_tokens))
    non_cached_input = safe_input - safe_cached
    cost = (
        non_cached_input * float(rate["input"])
        + safe_cached * float(rate["cache"])
        + safe_output * float(rate["output"])
    ) / 1_000_000
    return {
        "estimated_cost": round(cost, 8),
        "currency": str(rate.get("currency") or "CNY"),
        "pricing_source": "configured",
    }


def normalize_usage_event_payload(payload: dict[str, Any]) -> dict[str, Any]:
    external_event_id = _short_text(payload.get("external_event_id"), 128)
    if not external_event_id:
        raise ValueError("external_event_id_required")
    input_tokens = _non_negative_int(payload.get("input_tokens"))
    output_tokens = _non_negative_int(payload.get("output_tokens"))
    cached_tokens = min(input_tokens, _non_negative_int(payload.get("cached_tokens")))
    total_tokens = _non_negative_int(payload.get("total_tokens"))
    if total_tokens <= 0 and (input_tokens or output_tokens):
        total_tokens = input_tokens + output_tokens
    status = _short_text(payload.get("status") or "succeeded", 32).lower()
    if status not in {"succeeded", "failed"}:
        status = "failed"
    return {
        "external_event_id": external_event_id,
        "project_id": _short_text(payload.get("project_id"), 128) or None,
        "slide_id": _short_text(payload.get("slide_id"), 128) or None,
        "source": _short_text(payload.get("source") or "ppt", 32) or "ppt",
        "stage": _short_text(payload.get("stage") or "unknown", 64) or "unknown",
        "provider": _short_text(payload.get("provider") or "unknown", 64) or "unknown",
        "model": _short_text(payload.get("model") or "unknown", 128) or "unknown",
        "status": status,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cached_tokens": cached_tokens,
        "reasoning_tokens": _non_negative_int(payload.get("reasoning_tokens")),
        "total_tokens": total_tokens,
        "usage_available": bool(payload.get("usage_available")),
        "duration_ms": _non_negative_int(round(float(payload.get("duration_ms") or 0))),
        "http_status": _non_negative_int(payload.get("http_status"), maximum=599) or None,
        "error_code": _short_text(payload.get("error_code"), 80),
        "error_message": _short_text(payload.get("error_message"), MAX_ERROR_CHARS),
        "output_summary": _short_text(payload.get("output_summary"), MAX_SUMMARY_CHARS),
        "started_at": _parse_datetime(payload.get("started_at")) or datetime.now(),
        "ended_at": _parse_datetime(payload.get("ended_at")),
    }


async def persist_model_usage_event(
    session: AsyncSession,
    *,
    tenant_id: str,
    user_id: str,
    payload: dict[str, Any],
    pricing: dict[str, dict[str, Any]],
) -> tuple[ModelUsageEvent, bool]:
    normalized = normalize_usage_event_payload(payload)
    existing = (
        await session.execute(
            select(ModelUsageEvent).where(
                ModelUsageEvent.external_event_id == normalized["external_event_id"]
            )
        )
    ).scalars().first()
    if existing:
        return existing, False
    price = calculate_model_usage_cost(
        model=normalized["model"],
        input_tokens=normalized["input_tokens"],
        output_tokens=normalized["output_tokens"],
        cached_tokens=normalized["cached_tokens"],
        pricing=pricing,
    )
    event = ModelUsageEvent(
        tenant_id=tenant_id,
        user_id=user_id,
        **normalized,
        **price,
    )
    session.add(event)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        existing = (
            await session.execute(
                select(ModelUsageEvent).where(
                    ModelUsageEvent.external_event_id == normalized["external_event_id"]
                )
            )
        ).scalars().first()
        if existing:
            return existing, False
        raise
    return event, True


def serialize_model_usage_event(event: ModelUsageEvent | dict[str, Any]) -> dict[str, Any]:
    if isinstance(event, dict):
        return event
    return {
        "id": event.id,
        "external_event_id": event.external_event_id,
        "project_id": event.project_id,
        "slide_id": event.slide_id,
        "source": event.source,
        "stage": event.stage,
        "provider": event.provider,
        "model": event.model,
        "status": event.status,
        "input_tokens": event.input_tokens,
        "output_tokens": event.output_tokens,
        "cached_tokens": event.cached_tokens,
        "reasoning_tokens": event.reasoning_tokens,
        "total_tokens": event.total_tokens,
        "usage_available": event.usage_available,
        "estimated_cost": round(float(event.estimated_cost or 0.0), 8),
        "currency": event.currency,
        "pricing_source": event.pricing_source,
        "duration_ms": event.duration_ms,
        "http_status": event.http_status,
        "error_code": event.error_code,
        "error_message": event.error_message,
        "output_summary": event.output_summary,
        "started_at": event.started_at.isoformat() if event.started_at else None,
        "ended_at": event.ended_at.isoformat() if event.ended_at else None,
    }


def _event_totals(events: list[ModelUsageEvent]) -> dict[str, Any]:
    return {
        "call_count": len(events),
        "input_tokens": sum(item.input_tokens for item in events),
        "output_tokens": sum(item.output_tokens for item in events),
        "cached_tokens": sum(item.cached_tokens for item in events),
        "reasoning_tokens": sum(item.reasoning_tokens for item in events),
        "total_tokens": sum(item.total_tokens for item in events),
        "estimated_cost": round(sum(float(item.estimated_cost or 0.0) for item in events), 8),
        "currency": next((item.currency for item in events if item.currency), "CNY"),
        "unpriced_count": sum(1 for item in events if item.pricing_source == "unpriced"),
    }


def _agent_run_totals(runs: list[AgentRun]) -> dict[str, Any]:
    return {
        "call_count": len(runs),
        "input_tokens": sum(int((item.token_usage_json or {}).get("estimated_input_tokens") or 0) for item in runs),
        "output_tokens": sum(int((item.token_usage_json or {}).get("estimated_output_tokens") or 0) for item in runs),
        "total_tokens": sum(
            int((item.token_usage_json or {}).get("estimated_total_tokens") or 0)
            or int((item.token_usage_json or {}).get("estimated_input_tokens") or 0)
            + int((item.token_usage_json or {}).get("estimated_output_tokens") or 0)
            for item in runs
        ),
        "estimated_cost": round(sum(float(item.cost_estimate or 0.0) for item in runs), 8),
    }


def _combine_totals(event_totals: dict[str, Any], run_totals: dict[str, Any]) -> dict[str, Any]:
    result = dict(event_totals)
    for key in ("call_count", "input_tokens", "output_tokens", "total_tokens"):
        result[key] = int(event_totals.get(key) or 0) + int(run_totals.get(key) or 0)
    result["estimated_cost"] = round(
        float(event_totals.get("estimated_cost") or 0.0)
        + float(run_totals.get("estimated_cost") or 0.0),
        8,
    )
    result["model_event_count"] = int(event_totals.get("call_count") or 0)
    result["agent_run_count"] = int(run_totals.get("call_count") or 0)
    return result


async def get_model_usage_dashboard(
    session: AsyncSession,
    *,
    tenant_id: str,
    user_id: str,
    period: str | None,
    project_id: str | None,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    budget_period = period or current_budget_period()
    start, end = budget_period_bounds(budget_period)
    base_event = (
        select(ModelUsageEvent)
        .where(ModelUsageEvent.tenant_id == tenant_id)
        .where(ModelUsageEvent.user_id == user_id)
        .where(ModelUsageEvent.started_at >= start)
        .where(ModelUsageEvent.started_at < end)
    )
    all_events = list((await session.execute(base_event)).scalars().all())
    project_events = [item for item in all_events if project_id and item.project_id == project_id]
    event_query = base_event
    if project_id:
        event_query = event_query.where(ModelUsageEvent.project_id == project_id)
    event_query = event_query.order_by(ModelUsageEvent.started_at.desc()).offset(offset).limit(limit)
    visible_events = list((await session.execute(event_query)).scalars().all())
    count_query = select(func.count(ModelUsageEvent.id)).where(
        ModelUsageEvent.tenant_id == tenant_id,
        ModelUsageEvent.user_id == user_id,
        ModelUsageEvent.started_at >= start,
        ModelUsageEvent.started_at < end,
    )
    if project_id:
        count_query = count_query.where(ModelUsageEvent.project_id == project_id)
    total = int((await session.execute(count_query)).scalar_one() or 0)

    run_query = (
        select(AgentRun)
        .where(AgentRun.tenant_id == tenant_id)
        .where(AgentRun.user_id == user_id)
        .where(AgentRun.started_at >= start)
        .where(AgentRun.started_at < end)
    )
    runs = list((await session.execute(run_query)).scalars().all())
    project_totals = _event_totals(project_events)
    project_totals["model_event_count"] = project_totals["call_count"]
    project_totals["agent_run_count"] = 0
    return {
        "period": budget_period,
        "summary": _combine_totals(_event_totals(all_events), _agent_run_totals(runs)),
        # This must reconcile exactly with the per-call rows shown by the PPT UI.
        # Cross-product AgentRun totals remain available in the overall summary.
        "project_summary": project_totals,
        "events": [serialize_model_usage_event(item) for item in visible_events],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
