from __future__ import annotations

import asyncio
from collections import defaultdict


class ProjectRunLocks:
    """Prevents two full graph runs from mutating the same project concurrently."""

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    def for_project(self, project_id: str) -> asyncio.Lock:
        return self._locks[project_id]


project_run_locks = ProjectRunLocks()

