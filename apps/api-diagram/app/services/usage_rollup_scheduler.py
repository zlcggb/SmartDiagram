"""Background maintenance for usage budgets and rollups."""

import asyncio
from contextlib import suppress
from typing import Any

from app.core.config import settings
from app.core.db import async_session
from app.core.logger import logger
from app.models.audit import AuditEvent
from app.services.budget_service import refresh_active_usage_rollups


class UsageRollupScheduler:
    """Small in-process scheduler for local/dev deployments.

    Production can replace this with Celery, Arq, CronJob, or a managed
    scheduler. The service is deliberately idempotent so repeated executions are
    safe.
    """

    def __init__(self, interval_seconds: int):
        self.interval_seconds = max(60, interval_seconds)
        self._task: asyncio.Task | None = None
        self._stopped = asyncio.Event()

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def run_once(self) -> dict[str, Any]:
        """Refresh current-period budgets and rollups once."""

        async with async_session() as session:
            summary = await refresh_active_usage_rollups(session)
            for rollup in summary.get("rollups", []):
                if rollup.get("scope") != "tenant":
                    continue
                session.add(
                    AuditEvent(
                        tenant_id=rollup["tenant_id"],
                        project_id=None,
                        user_id=None,
                        event_type="tenant.usage_rollup.scheduled_refresh",
                        message="Scheduled usage rollup refresh completed.",
                        metadata_json={
                            "period": rollup["period"],
                            "run_count": rollup["run_count"],
                            "estimated_cost": rollup["estimated_cost"],
                            "estimated_total_tokens": rollup["estimated_total_tokens"],
                        },
                    )
                )
            await session.commit()
            return summary

    async def _loop(self) -> None:
        while not self._stopped.is_set():
            try:
                summary = await self.run_once()
                logger.info(
                    "Usage rollup scheduled refresh completed: "
                    f"period={summary.get('period')} rollups={summary.get('rollup_count')}"
                )
            except Exception as exc:
                logger.warning(f"Usage rollup scheduled refresh failed: {exc}")
            try:
                await asyncio.wait_for(self._stopped.wait(), timeout=self.interval_seconds)
            except TimeoutError:
                continue

    def start(self) -> None:
        if self.running:
            return
        self._stopped.clear()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._stopped.set()
        if not self._task:
            return
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None


usage_rollup_scheduler = UsageRollupScheduler(
    interval_seconds=settings.USAGE_ROLLUP_REFRESH_INTERVAL_SECONDS,
)


async def run_usage_rollup_maintenance_once() -> dict[str, Any]:
    """Run the idempotent usage rollup maintenance job once."""

    return await usage_rollup_scheduler.run_once()


async def run_usage_rollup_startup_refresh() -> dict[str, Any] | None:
    """Run one startup refresh when enabled by configuration."""

    if not settings.USAGE_ROLLUP_REFRESH_ON_STARTUP:
        return None
    return await run_usage_rollup_maintenance_once()


def start_usage_rollup_scheduler() -> None:
    """Start the periodic scheduler if enabled."""

    if settings.USAGE_ROLLUP_SCHEDULER_ENABLED:
        usage_rollup_scheduler.start()


async def stop_usage_rollup_scheduler() -> None:
    """Stop the periodic scheduler if it is running."""

    await usage_rollup_scheduler.stop()
