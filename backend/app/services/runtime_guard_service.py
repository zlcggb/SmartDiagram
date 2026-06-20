"""Runtime guardrails for Agent Harness requests.

The guards are deterministic and local so they work in development without
Redis. The service boundary is intentionally small; production can switch the
rate limiter to Redis while preserving the API contract.
"""

import asyncio
from collections import defaultdict, deque
from time import monotonic, time
from typing import Any, TypedDict
from urllib.parse import unquote, urlparse
from uuid import uuid4

from app.core.config import settings
from app.state.agent_runtime import PermissionContext


class RuntimeGuardDecision(TypedDict):
    allowed: bool
    reason: str
    retry_after_seconds: int
    estimated_input_tokens: int
    estimated_output_tokens: int
    estimated_total_tokens: int
    estimated_cost: float
    degraded: bool
    degradation_reason: str
    rate_limit_key: str
    rate_limit_backend: str


class RuntimeGuardError(RuntimeError):
    """Raised when graph execution exceeds runtime loop limits."""


class RuntimeRateLimitBackendError(RuntimeError):
    """Raised when an external rate-limit backend cannot evaluate a request."""


_rate_buckets: dict[str, deque[float]] = defaultdict(deque)


def reset_runtime_guard_state() -> None:
    """Clear in-memory guard state for smoke tests."""

    _rate_buckets.clear()


def _rough_tokens(text: str) -> int:
    if not text:
        return 0
    cjk = sum(1 for char in text if "\u4e00" <= char <= "\u9fff")
    non_cjk = max(0, len(text) - cjk)
    return max(1, cjk + (non_cjk // 4))


def _text_from_message(message: dict[str, Any]) -> str:
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
        return "\n".join(parts)
    return str(content)


def estimate_request_usage(body: dict[str, Any]) -> dict[str, Any]:
    """Estimate input/output token usage and cost before model execution."""

    input_text_parts = [
        str(body.get("message") or ""),
        str(body.get("current_code") or ""),
    ]
    for history_item in body.get("history") or []:
        if isinstance(history_item, dict):
            input_text_parts.append(_text_from_message(history_item))

    image_count = len(body.get("images") or [])
    estimated_input = _rough_tokens("\n".join(input_text_parts)) + image_count * 1500
    requested_output = (
        (body.get("model_config") or {}).get("max_tokens")
        or body.get("max_tokens")
        or settings.MAX_TOKENS
    )
    try:
        estimated_output = max(1, min(int(requested_output), settings.MAX_TOKENS))
    except (TypeError, ValueError):
        estimated_output = settings.MAX_TOKENS
    estimated_total = estimated_input + estimated_output
    estimated_cost = (
        (estimated_input / 1000.0) * settings.RUNTIME_INPUT_COST_PER_1K
        + (estimated_output / 1000.0) * settings.RUNTIME_OUTPUT_COST_PER_1K
    )
    return {
        "estimated_input_tokens": estimated_input,
        "estimated_output_tokens": estimated_output,
        "estimated_total_tokens": estimated_total,
        "estimated_cost": round(estimated_cost, 8),
        "image_count": image_count,
    }


def _rate_limit_key(permission_context: PermissionContext) -> str:
    return ":".join(
        [
            permission_context.get("tenant_id") or "local",
            permission_context.get("user_id") or "anonymous",
        ]
    )


def _check_rate_limit(
    permission_context: PermissionContext,
    limit_per_minute: int | None = None,
) -> tuple[bool, int, str, str]:
    limit = limit_per_minute if limit_per_minute is not None else settings.RUNTIME_RATE_LIMIT_PER_MINUTE
    key = _rate_limit_key(permission_context)
    if limit <= 0:
        return True, 0, key, "memory"

    now = monotonic()
    bucket = _rate_buckets[key]
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= limit:
        retry_after = max(1, int(60 - (now - bucket[0])))
        return False, retry_after, key, "memory"
    bucket.append(now)
    return True, 0, key, "memory"


class RedisSlidingWindowRateLimiter:
    """Redis-backed sliding window limiter using only the Redis wire protocol."""

    _SCRIPT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = 1
  if oldest[2] then
    retry = math.max(1, math.ceil((window - (now - tonumber(oldest[2]))) / 1000))
  end
  return {0, retry, count}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window * 2)
return {1, 0, count + 1}
"""

    def __init__(self, redis_url: str):
        parsed = urlparse(redis_url)
        if parsed.scheme != "redis":
            raise RuntimeRateLimitBackendError("Only redis:// URLs are supported for rate limiting")
        self.host = parsed.hostname or "localhost"
        self.port = parsed.port or 6379
        self.username = unquote(parsed.username or "") or None
        self.password = unquote(parsed.password or "") or None
        path = (parsed.path or "/0").strip("/")
        self.db = int(path or "0")

    async def check(
        self,
        key: str,
        limit_per_minute: int,
    ) -> tuple[bool, int, str, str]:
        if limit_per_minute <= 0:
            return True, 0, key, "redis"
        redis_key = f"smartdiagram:rate-limit:{key}"
        now_ms = int(time() * 1000)
        response = await self._execute(
            "EVAL",
            self._SCRIPT,
            "1",
            redis_key,
            str(now_ms),
            "60000",
            str(limit_per_minute),
            f"{now_ms}:{uuid4().hex}",
        )
        if not isinstance(response, list) or len(response) < 3:
            raise RuntimeRateLimitBackendError(f"Unexpected Redis rate-limit response: {response!r}")
        allowed = bool(int(response[0]))
        retry_after = max(0, int(response[1] or 0))
        return allowed, retry_after, key, "redis"

    async def _execute(self, *args: str) -> Any:
        try:
            reader, writer = await asyncio.open_connection(self.host, self.port)
        except OSError as exc:
            raise RuntimeRateLimitBackendError(f"Redis rate-limit backend unavailable: {exc}") from exc

        try:
            if self.password:
                if self.username:
                    await self._send_command(reader, writer, "AUTH", self.username, self.password)
                else:
                    await self._send_command(reader, writer, "AUTH", self.password)
            if self.db:
                await self._send_command(reader, writer, "SELECT", str(self.db))
            return await self._send_command(reader, writer, *args)
        finally:
            writer.close()
            await writer.wait_closed()

    async def _send_command(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        *args: str,
    ) -> Any:
        writer.write(self._encode_command(args))
        await writer.drain()
        return await self._read_response(reader)

    def _encode_command(self, args: tuple[str, ...]) -> bytes:
        parts = [f"*{len(args)}\r\n".encode("utf-8")]
        for arg in args:
            data = str(arg).encode("utf-8")
            parts.append(f"${len(data)}\r\n".encode("utf-8"))
            parts.append(data)
            parts.append(b"\r\n")
        return b"".join(parts)

    async def _read_response(self, reader: asyncio.StreamReader) -> Any:
        prefix = await reader.readexactly(1)
        if prefix == b"+":
            return (await self._read_line(reader)).decode("utf-8")
        if prefix == b"-":
            message = (await self._read_line(reader)).decode("utf-8")
            raise RuntimeRateLimitBackendError(f"Redis rate-limit command failed: {message}")
        if prefix == b":":
            return int((await self._read_line(reader)).decode("utf-8"))
        if prefix == b"$":
            length = int((await self._read_line(reader)).decode("utf-8"))
            if length < 0:
                return None
            data = await reader.readexactly(length)
            await reader.readexactly(2)
            return data.decode("utf-8")
        if prefix == b"*":
            count = int((await self._read_line(reader)).decode("utf-8"))
            if count < 0:
                return None
            return [await self._read_response(reader) for _ in range(count)]
        raise RuntimeRateLimitBackendError(f"Unsupported Redis response prefix: {prefix!r}")

    async def _read_line(self, reader: asyncio.StreamReader) -> bytes:
        line = await reader.readline()
        if not line.endswith(b"\r\n"):
            raise RuntimeRateLimitBackendError("Malformed Redis response")
        return line[:-2]


_redis_rate_limiter: RedisSlidingWindowRateLimiter | None = None


def _get_redis_rate_limiter() -> RedisSlidingWindowRateLimiter:
    global _redis_rate_limiter
    if _redis_rate_limiter is None:
        _redis_rate_limiter = RedisSlidingWindowRateLimiter(settings.REDIS_URL)
    return _redis_rate_limiter


async def _check_rate_limit_async(
    permission_context: PermissionContext,
    limit_per_minute: int | None = None,
    *,
    backend: str | None = None,
) -> tuple[bool, int, str, str]:
    selected_backend = (backend or settings.RUNTIME_RATE_LIMIT_BACKEND or "memory").lower()
    if selected_backend == "memory":
        return _check_rate_limit(permission_context, limit_per_minute)
    if selected_backend != "redis":
        raise RuntimeRateLimitBackendError(f"Unsupported rate-limit backend: {selected_backend}")

    limit = limit_per_minute if limit_per_minute is not None else settings.RUNTIME_RATE_LIMIT_PER_MINUTE
    key = _rate_limit_key(permission_context)
    try:
        return await _get_redis_rate_limiter().check(key, limit)
    except RuntimeRateLimitBackendError:
        if not settings.RUNTIME_RATE_LIMIT_REDIS_FAIL_OPEN:
            raise
        allowed, retry_after, fallback_key, _ = _check_rate_limit(
            permission_context,
            limit_per_minute,
        )
        return allowed, retry_after, fallback_key, "memory_fallback"


def _build_runtime_decision(
    usage: dict[str, Any],
    *,
    rate_allowed: bool,
    retry_after: int,
    key: str,
    backend: str,
    max_estimated_tokens: int | None = None,
    degrade_token_threshold: int | None = None,
) -> RuntimeGuardDecision:
    max_tokens = max_estimated_tokens if max_estimated_tokens is not None else settings.RUNTIME_MAX_ESTIMATED_TOKENS
    degrade_threshold = (
        degrade_token_threshold
        if degrade_token_threshold is not None
        else settings.RUNTIME_DEGRADE_TOKEN_THRESHOLD
    )

    allowed = rate_allowed and usage["estimated_total_tokens"] <= max_tokens
    reason = "ok"
    if not rate_allowed:
        reason = "rate_limited"
    elif usage["estimated_total_tokens"] > max_tokens:
        reason = "estimated_token_budget_exceeded"

    degraded = allowed and usage["estimated_total_tokens"] > degrade_threshold
    degradation_reason = "large_context" if degraded else ""
    return {
        "allowed": allowed,
        "reason": reason,
        "retry_after_seconds": retry_after,
        "estimated_input_tokens": usage["estimated_input_tokens"],
        "estimated_output_tokens": usage["estimated_output_tokens"],
        "estimated_total_tokens": usage["estimated_total_tokens"],
        "estimated_cost": usage["estimated_cost"],
        "degraded": degraded,
        "degradation_reason": degradation_reason,
        "rate_limit_key": key,
        "rate_limit_backend": backend,
    }


def evaluate_runtime_request(
    body: dict[str, Any],
    permission_context: PermissionContext,
    *,
    rate_limit_per_minute: int | None = None,
    max_estimated_tokens: int | None = None,
    degrade_token_threshold: int | None = None,
) -> RuntimeGuardDecision:
    """Evaluate rate limit, budget, cost, and degradation decisions."""

    usage = estimate_request_usage(body)
    rate_allowed, retry_after, key, backend = _check_rate_limit(
        permission_context,
        rate_limit_per_minute,
    )
    return _build_runtime_decision(
        usage,
        rate_allowed=rate_allowed,
        retry_after=retry_after,
        key=key,
        backend=backend,
        max_estimated_tokens=max_estimated_tokens,
        degrade_token_threshold=degrade_token_threshold,
    )


async def evaluate_runtime_request_async(
    body: dict[str, Any],
    permission_context: PermissionContext,
    *,
    rate_limit_per_minute: int | None = None,
    max_estimated_tokens: int | None = None,
    degrade_token_threshold: int | None = None,
    rate_limit_backend: str | None = None,
) -> RuntimeGuardDecision:
    """Async runtime guard used by FastAPI so Redis can enforce shared limits."""

    usage = estimate_request_usage(body)
    rate_allowed, retry_after, key, backend = await _check_rate_limit_async(
        permission_context,
        rate_limit_per_minute,
        backend=rate_limit_backend,
    )
    return _build_runtime_decision(
        usage,
        rate_allowed=rate_allowed,
        retry_after=retry_after,
        key=key,
        backend=backend,
        max_estimated_tokens=max_estimated_tokens,
        degrade_token_threshold=degrade_token_threshold,
    )


class StreamLoopGuard:
    """Detect runaway graph event streams and repeated Agent nodes."""

    def __init__(
        self,
        max_events: int | None = None,
        max_agent_repeats: int | None = None,
    ) -> None:
        self.max_events = max_events if max_events is not None else settings.RUNTIME_MAX_STREAM_EVENTS
        self.max_agent_repeats = (
            max_agent_repeats
            if max_agent_repeats is not None
            else settings.RUNTIME_MAX_AGENT_REPEATS
        )
        self.event_count = 0
        self.chain_start_counts: dict[str, int] = defaultdict(int)

    def observe_event(self, event: dict[str, Any]) -> None:
        self.event_count += 1
        if self.max_events > 0 and self.event_count > self.max_events:
            raise RuntimeGuardError("Agent stream event limit exceeded")

        if event.get("event") == "on_chain_start":
            name = str(event.get("name") or "")
            if name:
                self.chain_start_counts[name] += 1
                if (
                    self.max_agent_repeats > 0
                    and self.chain_start_counts[name] > self.max_agent_repeats
                ):
                    raise RuntimeGuardError(f"Agent step repeated too many times: {name}")
