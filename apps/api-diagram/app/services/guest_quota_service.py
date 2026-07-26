"""Redis-backed guest AI quota (per guest + per IP)."""

from __future__ import annotations

import hashlib
import time
from typing import Any

from app.core.config import settings
from app.core.logger import logger


def hash_client_ip(ip: str) -> str:
    material = f"{settings.AUTH_SESSION_SECRET}:ip:{ip.strip()}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def hash_user_agent(user_agent: str) -> str:
    material = f"{settings.AUTH_SESSION_SECRET}:ua:{user_agent.strip()}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


async def _redis_client():
    import redis.asyncio as aioredis

    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


async def _sliding_window_status(key: str, window_seconds: int) -> tuple[int, float | None]:
    now = time.time()
    window_start = now - window_seconds
    try:
        client = await _redis_client()
        async with client.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, "-inf", window_start)
            pipe.zcard(key)
            pipe.zrange(key, 0, 0, withscores=True)
            results = await pipe.execute()
        await client.aclose()
        oldest_entries = results[2] or []
        oldest_at = float(oldest_entries[0][1]) if oldest_entries else None
        return int(results[1] or 0), oldest_at
    except Exception as exc:
        logger.warning(f"Guest quota read failed (fail-open): {exc}")
        return 0, None


async def _sliding_window_add(key: str, window_seconds: int) -> None:
    now = time.time()
    try:
        client = await _redis_client()
        async with client.pipeline(transaction=True) as pipe:
            pipe.zadd(key, {f"{now}:{time.time_ns()}": now})
            pipe.expire(key, window_seconds + 1)
            await pipe.execute()
        await client.aclose()
    except Exception as exc:
        logger.warning(f"Guest quota write failed: {exc}")


def _resolve_call_limits(quota_settings: dict[str, Any] | None) -> tuple[int, int, int, bool]:
    if quota_settings:
        return (
            int(quota_settings.get("max_uses_per_guest") or settings.GUEST_AI_MAX_USES),
            int(quota_settings.get("max_uses_per_ip") or settings.GUEST_AI_MAX_USES_PER_IP),
            int(quota_settings.get("window_seconds") or settings.GUEST_AI_WINDOW_SECONDS),
            bool(quota_settings.get("hard_limit_enabled", True)),
        )
    return (
        settings.GUEST_AI_MAX_USES,
        settings.GUEST_AI_MAX_USES_PER_IP,
        settings.GUEST_AI_WINDOW_SECONDS,
        True,
    )


def calculate_next_available_at_ms(
    *,
    exhausted: bool,
    guest_remaining: int | None,
    ip_remaining: int | None,
    guest_oldest_at: float | None,
    ip_oldest_at: float | None,
    window_seconds: int,
) -> int | None:
    if not exhausted:
        return None

    release_times: list[float] = []
    if guest_remaining is not None and guest_remaining <= 0 and guest_oldest_at is not None:
        release_times.append(guest_oldest_at + window_seconds)
    if ip_remaining is not None and ip_remaining <= 0 and ip_oldest_at is not None:
        release_times.append(ip_oldest_at + window_seconds)
    if not release_times:
        return None
    return int(max(release_times) * 1000)


async def get_guest_ai_quota_status(
    guest_id: str,
    ip: str,
    *,
    quota_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    max_guest, max_ip, window, hard_limit_enabled = _resolve_call_limits(quota_settings)
    guest_key = f"smartdiagram:guest:ai:{guest_id}"
    ip_key = f"smartdiagram:guest:ai:ip:{hash_client_ip(ip)}"
    guest_used, guest_oldest_at = await _sliding_window_status(guest_key, window)
    ip_used, ip_oldest_at = await _sliding_window_status(ip_key, window)

    def remaining_for(limit: int, used: int) -> int | None:
        if limit <= 0:
            return None
        return max(0, limit - used)

    guest_remaining = remaining_for(max_guest, guest_used)
    ip_remaining = remaining_for(max_ip, ip_used)

    if guest_remaining is None and ip_remaining is None:
        remaining = -1
        exhausted = False
    elif guest_remaining is None:
        remaining = ip_remaining or 0
        exhausted = hard_limit_enabled and remaining <= 0
    elif ip_remaining is None:
        remaining = guest_remaining
        exhausted = hard_limit_enabled and remaining <= 0
    else:
        remaining = min(guest_remaining, ip_remaining)
        exhausted = hard_limit_enabled and remaining <= 0

    next_available_at_ms = calculate_next_available_at_ms(
        exhausted=exhausted,
        guest_remaining=guest_remaining,
        ip_remaining=ip_remaining,
        guest_oldest_at=guest_oldest_at,
        ip_oldest_at=ip_oldest_at,
        window_seconds=window,
    )

    return {
        "total": max_guest,
        "used": guest_used,
        "remaining": remaining,
        "exhausted": exhausted,
        "window_seconds": window,
        "ip_used": ip_used,
        "ip_limit": max_ip,
        "hard_limit_enabled": hard_limit_enabled,
        "next_available_at_ms": next_available_at_ms,
    }


async def consume_guest_ai_quota(
    guest_id: str,
    ip: str,
    *,
    quota_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    status = await get_guest_ai_quota_status(guest_id, ip, quota_settings=quota_settings)
    hard_limit_enabled = bool(status.get("hard_limit_enabled", True))
    if hard_limit_enabled and status["exhausted"]:
        return {"allowed": False, **status}

    max_guest, max_ip, window, _ = _resolve_call_limits(quota_settings)
    guest_key = f"smartdiagram:guest:ai:{guest_id}"
    ip_key = f"smartdiagram:guest:ai:ip:{hash_client_ip(ip)}"
    await _sliding_window_add(guest_key, window)
    await _sliding_window_add(ip_key, window)
    refreshed = await get_guest_ai_quota_status(guest_id, ip, quota_settings=quota_settings)
    return {"allowed": True, **refreshed}
