from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import suppress

from .schemas import ProgressEvent


class ProgressHub:
    """In-process fan-out for graph events; legacy SSE is merged at the route boundary."""

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[ProgressEvent]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def publish(self, project_id: str, event: ProgressEvent | dict) -> None:
        normalized = event if isinstance(event, ProgressEvent) else ProgressEvent.model_validate(event)
        async with self._lock:
            subscribers = tuple(self._subscribers.get(project_id, ()))
        for queue in subscribers:
            with suppress(asyncio.QueueFull):
                queue.put_nowait(normalized)

    async def subscribe(self, project_id: str) -> AsyncIterator[ProgressEvent]:
        queue: asyncio.Queue[ProgressEvent] = asyncio.Queue(maxsize=512)
        async with self._lock:
            self._subscribers[project_id].add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            async with self._lock:
                subscribers = self._subscribers.get(project_id)
                if subscribers is not None:
                    subscribers.discard(queue)
                    if not subscribers:
                        self._subscribers.pop(project_id, None)


progress_hub = ProgressHub()

