"""Collect up to max_batch requests for max_wait_ms, then infer in a worker thread.

Queue time can be longer while an earlier batch is running.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

from ..core.engine import Engine
from ..core.schemas import SystemOneRequest, SystemOneResponse


class QueueFull(Exception):
    pass


@dataclass
class _Job:
    req: SystemOneRequest
    fut: asyncio.Future
    enqueued_at: float = field(default_factory=time.perf_counter)


@dataclass
class BatchStats:
    batches: int = 0
    requests: int = 0
    max_batch_seen: int = 0
    total_infer_s: float = 0.0
    total_queue_s: float = 0.0

    def snapshot(self) -> dict:
        n = max(self.requests, 1)
        return {
            "batches": self.batches,
            "requests": self.requests,
            "avg_batch": round(self.requests / max(self.batches, 1), 2),
            "max_batch": self.max_batch_seen,
            "avg_infer_ms": round(1000 * self.total_infer_s / max(self.batches, 1), 1),
            "avg_queue_ms": round(1000 * self.total_queue_s / n, 1),
        }


class Batcher:
    def __init__(self, engine: Engine, max_batch: int, max_wait_ms: float, max_queue: int):
        self.engine = engine
        self.max_batch = max_batch
        self.max_wait = max_wait_ms / 1000.0
        self.max_queue = max_queue
        self.queue: asyncio.Queue[_Job] = asyncio.Queue()
        self.stats = BatchStats()
        self._task: asyncio.Task | None = None

    async def start(self):
        self._task = asyncio.create_task(self._loop(), name="jeff-batcher")

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def submit(self, req: SystemOneRequest) -> SystemOneResponse:
        if self.queue.qsize() >= self.max_queue:
            raise QueueFull()
        fut = asyncio.get_running_loop().create_future()
        self.queue.put_nowait(_Job(req, fut))
        return await fut

    async def _loop(self):
        loop = asyncio.get_running_loop()
        while True:
            first = await self.queue.get()
            jobs = [first]
            deadline = loop.time() + self.max_wait
            while len(jobs) < self.max_batch:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    break
                try:
                    jobs.append(await asyncio.wait_for(self.queue.get(), timeout=remaining))
                except TimeoutError:
                    break
            now = time.perf_counter()
            for j in jobs:
                self.stats.total_queue_s += now - j.enqueued_at
            t0 = time.perf_counter()
            try:
                results = await loop.run_in_executor(None, self.engine.run_batch, [j.req for j in jobs])
            except Exception as e:  # noqa: BLE001 - one bad batch must not stop the loop
                for j in jobs:
                    if not j.fut.done():
                        j.fut.set_exception(e)
                continue
            dt = time.perf_counter() - t0
            self.stats.batches += 1
            self.stats.requests += len(jobs)
            self.stats.max_batch_seen = max(self.stats.max_batch_seen, len(jobs))
            self.stats.total_infer_s += dt
            for j, r in zip(jobs, results):
                if not j.fut.done():
                    j.fut.set_result(r)
