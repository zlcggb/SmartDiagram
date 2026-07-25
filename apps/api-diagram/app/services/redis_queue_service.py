"""Minimal Redis queue helpers for local worker boundaries."""

import asyncio
from typing import Any
from urllib.parse import unquote, urlparse
from uuid import uuid4

from app.core.config import settings


class RedisQueueError(RuntimeError):
    """Raised when Redis queue operations fail."""


WORKER_JOB_LOCK_PREFIX = "smartdiagram:lock:job:"


class RedisQueueClient:
    """Tiny Redis client for list-based queues using the Redis wire protocol."""

    def __init__(self, redis_url: str | None = None):
        parsed = urlparse(redis_url or settings.REDIS_URL)
        if parsed.scheme != "redis":
            raise RedisQueueError("Only redis:// URLs are supported for queues")
        self.host = parsed.hostname or "localhost"
        self.port = parsed.port or 6379
        self.username = unquote(parsed.username or "") or None
        self.password = unquote(parsed.password or "") or None
        path = (parsed.path or "/0").strip("/")
        self.db = int(path or "0")

    async def rpush(self, key: str, value: str) -> int:
        response = await self._execute("RPUSH", key, value)
        return int(response or 0)

    async def lpop(self, key: str) -> str | None:
        response = await self._execute("LPOP", key)
        return None if response is None else str(response)

    async def delete(self, key: str) -> int:
        response = await self._execute("DEL", key)
        return int(response or 0)

    async def ping(self) -> bool:
        response = await self._execute("PING")
        return str(response).upper() == "PONG"

    async def set_nx_ex(self, key: str, value: str, ttl_seconds: int) -> bool:
        response = await self._execute("SET", key, value, "NX", "EX", str(max(1, ttl_seconds)))
        return response == "OK"

    async def _execute(self, *args: str) -> Any:
        try:
            reader, writer = await asyncio.open_connection(self.host, self.port)
        except OSError as exc:
            raise RedisQueueError(f"Redis queue backend unavailable: {exc}") from exc

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
            raise RedisQueueError(f"Redis queue command failed: {message}")
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
        raise RedisQueueError(f"Unsupported Redis response prefix: {prefix!r}")

    async def _read_line(self, reader: asyncio.StreamReader) -> bytes:
        line = await reader.readline()
        if not line.endswith(b"\r\n"):
            raise RedisQueueError("Malformed Redis response")
        return line[:-2]


async def enqueue_job(queue_name: str, job_id: str) -> int:
    """Append a job id to a Redis queue."""

    return await RedisQueueClient().rpush(queue_name, job_id)


async def dequeue_job(queue_name: str) -> str | None:
    """Pop one job id from a Redis queue."""

    return await RedisQueueClient().lpop(queue_name)


async def ping_redis() -> bool:
    """Return True when Redis responds to PING."""

    try:
        return await RedisQueueClient().ping()
    except RedisQueueError:
        return False


def worker_job_lock_key(job_id: str) -> str:
    return f"{WORKER_JOB_LOCK_PREFIX}{job_id}"


async def acquire_worker_job_lock(job_id: str, *, ttl_seconds: int | None = None) -> bool:
    """Acquire a short-lived lock so concurrent workers do not process the same job."""

    ttl = ttl_seconds if ttl_seconds is not None else settings.WORKER_JOB_LOCK_TTL_SECONDS
    token = f"{job_id}:{uuid4().hex}"
    try:
        return await RedisQueueClient().set_nx_ex(worker_job_lock_key(job_id), token, ttl)
    except RedisQueueError:
        return False


async def release_worker_job_lock(job_id: str) -> None:
    """Release a worker job lock if present."""

    try:
        await RedisQueueClient().delete(worker_job_lock_key(job_id))
    except RedisQueueError:
        return None
