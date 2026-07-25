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


async def _sliding_window_count(key: str, window_seconds: int) -> int:
    now = time.time()
    window_start = now - window_seconds
    try:
        client = await _redis_client()
        async with client.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, "-inf", window_start)
            pipe.zcard(key)
            results = await pipe.execute()
        await client.aclose()
        return int(results[1] or 0)
    except Exception as exc:
        logger.warning(f"Guest quota read failed (fail-open): {exc}")
        return 0


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


async def get_guest_ai_quota_status(
    guest_id: str,
    ip: str,
    *,
    quota_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    max_guest, max_ip, window, hard_limit_enabled = _resolve_call_limits(quota_settings)
    guest_key = f"smartdiagram:guest:ai:{guest_id}"
    ip_key = f"smartdiagram:guest:ai:ip:{hash_client_ip(ip)}"
    guest_used = await _sliding_window_count(guest_key, window)
    ip_used = await _sliding_window_count(ip_key, window)

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

    return {
        "total": max_guest,
        "used": guest_used,
        "remaining": remaining,
        "exhausted": exhausted,
        "window_seconds": window,
        "ip_used": ip_used,
        "ip_limit": max_ip,
        "hard_limit_enabled": hard_limit_enabled,
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
