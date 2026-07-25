"""Tests for Redis queue helpers."""

import pytest

from app.services.redis_queue_service import (
    RedisQueueClient,
    worker_job_lock_key,
)


def test_worker_job_lock_key():
    assert worker_job_lock_key("job-123") == "smartdiagram:lock:job:job-123"


def test_encode_command_roundtrip_shape():
    client = RedisQueueClient("redis://localhost:6379/0")
    encoded = client._encode_command(("PING",))
    assert encoded.startswith(b"*1\r\n")
    assert b"PING" in encoded


@pytest.mark.asyncio
async def test_ping_redis_when_available():
    from app.services.redis_queue_service import ping_redis

    try:
        result = await ping_redis()
    except Exception:
        pytest.skip("Redis not available in test environment")
    assert isinstance(result, bool)
