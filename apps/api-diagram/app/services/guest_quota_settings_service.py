"""Load and persist platform guest quota settings."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.guest import GuestUsageEvent
from app.models.platform_guest_quota import PLATFORM_GUEST_QUOTA_ID, PlatformGuestQuotaSettings
from app.models.common import utc_now
from app.services.budget_service import budget_period_bounds, current_budget_period
from app.services.user_quota_service import _limit_remaining, current_daily_period, daily_period_bounds
from sqlalchemy import func, select


class GuestQuotaSettingsMutationError(ValueError):
    """Stable guest quota settings update errors."""


def default_guest_quota_values() -> dict[str, Any]:
    return {
        "max_uses_per_guest": settings.GUEST_AI_MAX_USES,
        "max_uses_per_ip": settings.GUEST_AI_MAX_USES_PER_IP,
        "window_seconds": settings.GUEST_AI_WINDOW_SECONDS,
        "daily_token_limit": 200_000,
        "monthly_token_limit": 2_000_000,
        "monthly_cost_limit": 2.0,
        "hard_limit_enabled": True,
    }


def serialize_guest_quota_settings(row: PlatformGuestQuotaSettings) -> dict[str, Any]:
    return {
        "id": row.id,
        "max_uses_per_guest": row.max_uses_per_guest,
        "max_uses_per_ip": row.max_uses_per_ip,
        "window_seconds": row.window_seconds,
        "daily_token_limit": row.daily_token_limit,
        "monthly_token_limit": row.monthly_token_limit,
        "monthly_cost_limit": row.monthly_cost_limit,
        "hard_limit_enabled": row.hard_limit_enabled,
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
        "enforcement": {
            "call_quota": "Redis sliding window before /chat/stream",
            "token_quota": "GuestUsageEvent aggregates when hard_limit_enabled",
        },
    }


async def ensure_guest_quota_settings(session: AsyncSession) -> PlatformGuestQuotaSettings:
    row = await session.get(PlatformGuestQuotaSettings, PLATFORM_GUEST_QUOTA_ID)
    if row:
        return row

    defaults = default_guest_quota_values()
    now = utc_now()
    row = PlatformGuestQuotaSettings(
        id=PLATFORM_GUEST_QUOTA_ID,
        created_at=now,
        updated_at=now,
        **defaults,
    )
    session.add(row)
    await session.flush()
    return row


async def get_guest_quota_settings(session: AsyncSession) -> dict[str, Any]:
    row = await ensure_guest_quota_settings(session)
    return serialize_guest_quota_settings(row)


async def update_guest_quota_settings(
    session: AsyncSession,
    payload: dict[str, Any],
) -> dict[str, Any]:
    row = await ensure_guest_quota_settings(session)
    if "max_uses_per_guest" in payload:
        row.max_uses_per_guest = max(0, int(payload["max_uses_per_guest"]))
    if "max_uses_per_ip" in payload:
        row.max_uses_per_ip = max(0, int(payload["max_uses_per_ip"]))
    if "window_seconds" in payload:
        row.window_seconds = max(60, int(payload["window_seconds"]))
    if "daily_token_limit" in payload:
        row.daily_token_limit = max(0, int(payload["daily_token_limit"]))
    if "monthly_token_limit" in payload:
        row.monthly_token_limit = max(0, int(payload["monthly_token_limit"]))
    if "monthly_cost_limit" in payload:
        row.monthly_cost_limit = max(0.0, float(payload["monthly_cost_limit"]))
    if "hard_limit_enabled" in payload:
        row.hard_limit_enabled = bool(payload["hard_limit_enabled"])
    row.updated_at = utc_now()
    await session.flush()
    return serialize_guest_quota_settings(row)


async def get_guest_usage_totals(
    session: AsyncSession,
    guest_id: str,
    *,
    start,
    end,
) -> dict[str, Any]:
    row = (
        await session.execute(
            select(
                func.count(GuestUsageEvent.id).label("call_count"),
                func.coalesce(func.sum(GuestUsageEvent.estimated_total_tokens), 0).label("total_tokens"),
                func.coalesce(func.sum(GuestUsageEvent.estimated_cost), 0.0).label("estimated_cost"),
            )
            .where(GuestUsageEvent.guest_id == guest_id)
            .where(GuestUsageEvent.created_at >= start)
            .where(GuestUsageEvent.created_at < end)
        )
    ).one()
    return {
        "call_count": int(row.call_count or 0),
        "total_tokens": int(row.total_tokens or 0),
        "estimated_cost": round(float(row.estimated_cost or 0.0), 8),
    }


async def get_guest_quota_snapshot(
    session: AsyncSession,
    guest_id: str,
    *,
    quota_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings_row = quota_settings or await get_guest_quota_settings(session)
    day_period = current_daily_period()
    month_period = current_budget_period()
    day_start, day_end = daily_period_bounds(day_period)
    month_start, month_end = budget_period_bounds(month_period)

    daily_usage = await get_guest_usage_totals(session, guest_id, start=day_start, end=day_end)
    monthly_usage = await get_guest_usage_totals(session, guest_id, start=month_start, end=month_end)

    limits = {
        "max_uses_per_guest": settings_row["max_uses_per_guest"],
        "max_uses_per_ip": settings_row["max_uses_per_ip"],
        "window_seconds": settings_row["window_seconds"],
        "daily_token_limit": settings_row["daily_token_limit"],
        "monthly_token_limit": settings_row["monthly_token_limit"],
        "monthly_cost_limit": settings_row["monthly_cost_limit"],
        "hard_limit_enabled": settings_row["hard_limit_enabled"],
    }

    return {
        "limits": limits,
        "usage": {
            "daily": {"period": day_period, **daily_usage},
            "monthly": {"period": month_period, **monthly_usage},
        },
        "remaining": {
            "daily_tokens": _limit_remaining(limits["daily_token_limit"], daily_usage["total_tokens"]),
            "monthly_tokens": _limit_remaining(limits["monthly_token_limit"], monthly_usage["total_tokens"]),
            "monthly_cost": _limit_remaining(limits["monthly_cost_limit"], monthly_usage["estimated_cost"]),
        },
    }


async def evaluate_guest_budget(
    session: AsyncSession,
    guest_id: str,
    runtime_guard: dict[str, Any],
    quota_settings: dict[str, Any],
) -> dict[str, Any]:
    """Token/cost guard for guest principals (call-count guard is separate Redis path)."""

    snapshot = await get_guest_quota_snapshot(session, guest_id, quota_settings=quota_settings)
    limits = snapshot["limits"]
    if not limits.get("hard_limit_enabled"):
        return {"allowed": True, "reason": "guest_quota_unlimited", **snapshot}

    has_token_limits = (
        limits["daily_token_limit"] > 0
        or limits["monthly_token_limit"] > 0
        or limits["monthly_cost_limit"] > 0
    )
    if not has_token_limits:
        return {"allowed": True, "reason": "guest_token_quota_unconfigured", **snapshot}

    projected_daily_tokens = int(snapshot["usage"]["daily"]["total_tokens"]) + int(
        runtime_guard.get("estimated_total_tokens") or 0
    )
    projected_monthly_tokens = int(snapshot["usage"]["monthly"]["total_tokens"]) + int(
        runtime_guard.get("estimated_total_tokens") or 0
    )
    projected_monthly_cost = round(
        float(snapshot["usage"]["monthly"]["estimated_cost"])
        + float(runtime_guard.get("estimated_cost") or 0.0),
        8,
    )

    daily_exceeded = (
        limits["daily_token_limit"] > 0 and projected_daily_tokens > limits["daily_token_limit"]
    )
    monthly_token_exceeded = (
        limits["monthly_token_limit"] > 0 and projected_monthly_tokens > limits["monthly_token_limit"]
    )
    monthly_cost_exceeded = (
        limits["monthly_cost_limit"] > 0 and projected_monthly_cost > limits["monthly_cost_limit"]
    )

    allowed = not (daily_exceeded or monthly_token_exceeded or monthly_cost_exceeded)
    reason = "ok"
    if daily_exceeded:
        reason = "guest_daily_token_quota_exceeded"
    elif monthly_token_exceeded:
        reason = "guest_monthly_token_quota_exceeded"
    elif monthly_cost_exceeded:
        reason = "guest_monthly_cost_quota_exceeded"

    return {
        "allowed": allowed,
        "reason": reason,
        "projected": {
            "daily_tokens": projected_daily_tokens,
            "monthly_tokens": projected_monthly_tokens,
            "monthly_cost": projected_monthly_cost,
        },
        **snapshot,
    }
