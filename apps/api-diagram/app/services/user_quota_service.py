"""User quota profiles (by tier/role) and runtime budget enforcement."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AgentRun
from app.models.model_usage import ModelUsageEvent
from app.models.platform_quota import PlatformQuotaProfile
from app.models.tenant import User
from app.models.common import new_id, utc_now
from app.services.account_profile_service import (
    ACCOUNT_TIERS,
    get_account_tier,
)
from app.services.budget_service import budget_period_bounds, current_budget_period
from app.services.model_usage_service import _agent_run_totals, _combine_totals, _event_totals

PROFILE_TYPE_TIER = "account_tier"
PROFILE_TYPE_ROLE = "tenant_role"
TENANT_ROLES = ("member", "admin", "owner")

DEFAULT_TIER_QUOTAS: dict[str, dict[str, int | float | bool]] = {
    "free": {
        "daily_token_limit": 100_000,
        "monthly_token_limit": 1_000_000,
        "monthly_cost_limit": 1.0,
        "hard_limit_enabled": True,
    },
    "standard": {
        "daily_token_limit": 500_000,
        "monthly_token_limit": 5_000_000,
        "monthly_cost_limit": 5.0,
        "hard_limit_enabled": True,
    },
    "pro": {
        "daily_token_limit": 2_000_000,
        "monthly_token_limit": 20_000_000,
        "monthly_cost_limit": 25.0,
        "hard_limit_enabled": True,
    },
    "enterprise": {
        "daily_token_limit": 0,
        "monthly_token_limit": 0,
        "monthly_cost_limit": 0.0,
        "hard_limit_enabled": False,
    },
}

DEFAULT_ROLE_QUOTAS: dict[str, dict[str, int | float | bool]] = {
    "member": {
        "daily_token_limit": 0,
        "monthly_token_limit": 0,
        "monthly_cost_limit": 0.0,
        "hard_limit_enabled": False,
    },
    "admin": {
        "daily_token_limit": 0,
        "monthly_token_limit": 0,
        "monthly_cost_limit": 0.0,
        "hard_limit_enabled": False,
    },
    "owner": {
        "daily_token_limit": 0,
        "monthly_token_limit": 0,
        "monthly_cost_limit": 0.0,
        "hard_limit_enabled": False,
    },
}


class QuotaProfileMutationError(ValueError):
    """Stable quota profile update errors."""


def current_daily_period(now: datetime | None = None) -> str:
    current = now or utc_now()
    return current.strftime("%Y-%m-%d")


def daily_period_bounds(day: str) -> tuple[datetime, datetime]:
    year, month, day_num = (int(part) for part in day.split("-"))
    start = datetime(year, month, day_num)
    end = start + timedelta(days=1)
    return start, end


def _limit_remaining(limit: float | int, used: float | int) -> float | int | None:
    if not limit or limit <= 0:
        return None
    return max(0, limit - used)


def _merge_limit_values(left: int | float, right: int | float) -> int | float:
    """Pick the stricter positive limit; 0 means no cap from that profile."""
    if left <= 0:
        return right
    if right <= 0:
        return left
    return min(left, right)


def merge_quota_limits(
    tier_limits: dict[str, Any] | None,
    role_limits: dict[str, Any] | None,
) -> dict[str, Any]:
    tier = tier_limits or {}
    role = role_limits or {}
    daily = _merge_limit_values(
        int(tier.get("daily_token_limit") or 0),
        int(role.get("daily_token_limit") or 0),
    )
    monthly_tokens = _merge_limit_values(
        int(tier.get("monthly_token_limit") or 0),
        int(role.get("monthly_token_limit") or 0),
    )
    monthly_cost = _merge_limit_values(
        float(tier.get("monthly_cost_limit") or 0.0),
        float(role.get("monthly_cost_limit") or 0.0),
    )
    hard = bool(tier.get("hard_limit_enabled")) or bool(role.get("hard_limit_enabled"))
    has_any_limit = daily > 0 or monthly_tokens > 0 or monthly_cost > 0
    return {
        "daily_token_limit": int(daily),
        "monthly_token_limit": int(monthly_tokens),
        "monthly_cost_limit": float(monthly_cost),
        "hard_limit_enabled": hard and has_any_limit,
    }


def serialize_quota_profile(row: PlatformQuotaProfile) -> dict[str, Any]:
    return {
        "id": row.id,
        "profile_type": row.profile_type,
        "profile_key": row.profile_key,
        "daily_token_limit": row.daily_token_limit,
        "monthly_token_limit": row.monthly_token_limit,
        "monthly_cost_limit": row.monthly_cost_limit,
        "hard_limit_enabled": row.hard_limit_enabled,
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }


def _default_catalog() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for key in ACCOUNT_TIERS:
        rows.append({"profile_type": PROFILE_TYPE_TIER, "profile_key": key, **DEFAULT_TIER_QUOTAS[key]})
    for key in TENANT_ROLES:
        rows.append({"profile_type": PROFILE_TYPE_ROLE, "profile_key": key, **DEFAULT_ROLE_QUOTAS[key]})
    return rows


async def ensure_default_quota_profiles(session: AsyncSession) -> int:
    existing = list((await session.execute(select(PlatformQuotaProfile))).scalars().all())
    if existing:
        return 0
    created = 0
    now = utc_now()
    for item in _default_catalog():
        session.add(
            PlatformQuotaProfile(
                id=new_id(),
                profile_type=item["profile_type"],
                profile_key=item["profile_key"],
                daily_token_limit=int(item["daily_token_limit"]),
                monthly_token_limit=int(item["monthly_token_limit"]),
                monthly_cost_limit=float(item["monthly_cost_limit"]),
                hard_limit_enabled=bool(item["hard_limit_enabled"]),
                created_at=now,
                updated_at=now,
            )
        )
        created += 1
    if created:
        await session.flush()
    return created


async def list_quota_profiles(session: AsyncSession) -> list[dict[str, Any]]:
    await ensure_default_quota_profiles(session)
    rows = list(
        (
            await session.execute(
                select(PlatformQuotaProfile).order_by(
                    PlatformQuotaProfile.profile_type,
                    PlatformQuotaProfile.profile_key,
                )
            )
        ).scalars().all()
    )
    return [serialize_quota_profile(row) for row in rows]


async def _load_profile_map(session: AsyncSession) -> dict[tuple[str, str], PlatformQuotaProfile]:
    await ensure_default_quota_profiles(session)
    rows = list((await session.execute(select(PlatformQuotaProfile))).scalars().all())
    return {(row.profile_type, row.profile_key): row for row in rows}


def _profile_limits(row: PlatformQuotaProfile | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "daily_token_limit": row.daily_token_limit,
        "monthly_token_limit": row.monthly_token_limit,
        "monthly_cost_limit": row.monthly_cost_limit,
        "hard_limit_enabled": row.hard_limit_enabled,
    }


async def resolve_user_quota_limits(session: AsyncSession, user: User) -> dict[str, Any]:
    profile_map = await _load_profile_map(session)
    tier_key = get_account_tier(user)
    role_key = str(user.role or "member").strip().lower()
    tier_limits = _profile_limits(profile_map.get((PROFILE_TYPE_TIER, tier_key)))
    role_limits = _profile_limits(profile_map.get((PROFILE_TYPE_ROLE, role_key)))
    merged = merge_quota_limits(tier_limits, role_limits)
    return {
        **merged,
        "account_tier": tier_key,
        "tenant_role": role_key,
    }


async def get_user_usage_totals(
    session: AsyncSession,
    *,
    tenant_id: str,
    user_id: str,
    start: datetime,
    end: datetime,
) -> dict[str, Any]:
    events = list(
        (
            await session.execute(
                select(ModelUsageEvent)
                .where(ModelUsageEvent.tenant_id == tenant_id)
                .where(ModelUsageEvent.user_id == user_id)
                .where(ModelUsageEvent.started_at >= start)
                .where(ModelUsageEvent.started_at < end)
            )
        ).scalars().all()
    )
    runs = list(
        (
            await session.execute(
                select(AgentRun)
                .where(AgentRun.tenant_id == tenant_id)
                .where(AgentRun.user_id == user_id)
                .where(AgentRun.started_at >= start)
                .where(AgentRun.started_at < end)
            )
        ).scalars().all()
    )
    return _combine_totals(_event_totals(events), _agent_run_totals(runs))


async def get_user_quota_snapshot(
    session: AsyncSession,
    user: User,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    current = now or utc_now()
    limits = await resolve_user_quota_limits(session, user)
    month_period = current_budget_period(current)
    day_period = current_daily_period(current)
    month_start, month_end = budget_period_bounds(month_period)
    day_start, day_end = daily_period_bounds(day_period)

    monthly_usage = await get_user_usage_totals(
        session,
        tenant_id=user.tenant_id,
        user_id=user.id,
        start=month_start,
        end=month_end,
    )
    daily_usage = await get_user_usage_totals(
        session,
        tenant_id=user.tenant_id,
        user_id=user.id,
        start=day_start,
        end=day_end,
    )

    monthly_tokens = int(monthly_usage.get("total_tokens") or 0)
    daily_tokens = int(daily_usage.get("total_tokens") or 0)
    monthly_cost = float(monthly_usage.get("estimated_cost") or 0.0)

    return {
        "limits": limits,
        "usage": {
            "daily": {
                "period": day_period,
                "total_tokens": daily_tokens,
                "estimated_cost": float(daily_usage.get("estimated_cost") or 0.0),
            },
            "monthly": {
                "period": month_period,
                "total_tokens": monthly_tokens,
                "estimated_cost": monthly_cost,
            },
        },
        "remaining": {
            "daily_tokens": _limit_remaining(limits["daily_token_limit"], daily_tokens),
            "monthly_tokens": _limit_remaining(limits["monthly_token_limit"], monthly_tokens),
            "monthly_cost": _limit_remaining(limits["monthly_cost_limit"], monthly_cost),
        },
    }


def _validate_profile_payload(item: dict[str, Any]) -> dict[str, Any]:
    profile_type = str(item.get("profile_type") or "").strip().lower()
    profile_key = str(item.get("profile_key") or "").strip().lower()
    if profile_type not in {PROFILE_TYPE_TIER, PROFILE_TYPE_ROLE}:
        raise QuotaProfileMutationError("invalid_profile_type")
    if profile_type == PROFILE_TYPE_TIER and profile_key not in ACCOUNT_TIERS:
        raise QuotaProfileMutationError("invalid_profile_key")
    if profile_type == PROFILE_TYPE_ROLE and profile_key not in TENANT_ROLES:
        raise QuotaProfileMutationError("invalid_profile_key")
    return {
        "profile_type": profile_type,
        "profile_key": profile_key,
        "daily_token_limit": max(0, int(item.get("daily_token_limit") or 0)),
        "monthly_token_limit": max(0, int(item.get("monthly_token_limit") or 0)),
        "monthly_cost_limit": max(0.0, float(item.get("monthly_cost_limit") or 0.0)),
        "hard_limit_enabled": bool(item.get("hard_limit_enabled", True)),
    }


async def batch_upsert_quota_profiles(
    session: AsyncSession,
    profiles: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not profiles:
        raise QuotaProfileMutationError("profiles_required")

    profile_map = await _load_profile_map(session)
    now = utc_now()
    updated_keys: set[tuple[str, str]] = set()

    for raw in profiles:
        normalized = _validate_profile_payload(raw)
        key = (normalized["profile_type"], normalized["profile_key"])
        updated_keys.add(key)
        existing = profile_map.get(key)
        if existing:
            existing.daily_token_limit = normalized["daily_token_limit"]
            existing.monthly_token_limit = normalized["monthly_token_limit"]
            existing.monthly_cost_limit = normalized["monthly_cost_limit"]
            existing.hard_limit_enabled = normalized["hard_limit_enabled"]
            existing.updated_at = now
        else:
            session.add(
                PlatformQuotaProfile(
                    id=new_id(),
                    created_at=now,
                    updated_at=now,
                    **normalized,
                )
            )

    await session.flush()
    return await list_quota_profiles(session)


async def evaluate_user_budget(
    session: AsyncSession,
    user: User,
    runtime_guard: dict[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Check whether a registered user can run under tier/role quota profiles."""

    snapshot = await get_user_quota_snapshot(session, user, now=now)
    limits = snapshot["limits"]
    if not limits.get("hard_limit_enabled"):
        return {
            "allowed": True,
            "reason": "user_quota_unlimited",
            **snapshot,
        }

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
        limits["daily_token_limit"] > 0
        and projected_daily_tokens > limits["daily_token_limit"]
    )
    monthly_token_exceeded = (
        limits["monthly_token_limit"] > 0
        and projected_monthly_tokens > limits["monthly_token_limit"]
    )
    monthly_cost_exceeded = (
        limits["monthly_cost_limit"] > 0
        and projected_monthly_cost > limits["monthly_cost_limit"]
    )

    allowed = not (daily_exceeded or monthly_token_exceeded or monthly_cost_exceeded)
    reason = "ok"
    if daily_exceeded:
        reason = "user_daily_token_quota_exceeded"
    elif monthly_token_exceeded:
        reason = "user_monthly_token_quota_exceeded"
    elif monthly_cost_exceeded:
        reason = "user_monthly_cost_quota_exceeded"

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
