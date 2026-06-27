"""Redis-based sliding-window rate limiter for auth endpoints."""

from __future__ import annotations

import time
from typing import Any

from app.core.config import settings
from app.core.logger import logger


async def check_auth_rate_limit(ip: str) -> dict[str, Any]:
    """Return {"allowed": True/False, "remaining": int, "retry_after": int}.

    Uses a Redis sorted-set sliding window. If Redis is unreachable, fail open
    (allow the request) to avoid blocking legitimate users.
    """
    import redis.asyncio as aioredis

    max_requests = settings.AUTH_RATE_LIMIT_MAX
    window_seconds = settings.AUTH_RATE_LIMIT_WINDOW_SECONDS
    key = f"smartdiagram:auth:rl:{ip}"
    now = time.time()
    window_start = now - window_seconds

    try:
        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        async with r.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, "-inf", window_start)
            pipe.zcard(key)
            pipe.zadd(key, {f"{now}": now})
            pipe.expire(key, window_seconds + 1)
            results = await pipe.execute()
        await r.aclose()

        current_count = int(results[1])
        if current_count >= max_requests:
            return {
                "allowed": False,
                "remaining": 0,
                "retry_after": window_seconds,
            }
        return {
            "allowed": True,
            "remaining": max(0, max_requests - current_count - 1),
            "retry_after": 0,
        }
    except Exception as exc:
        logger.warning(f"Rate limit check failed (fail-open): {exc}")
        return {"allowed": True, "remaining": max_requests, "retry_after": 0}
