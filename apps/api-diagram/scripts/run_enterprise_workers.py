"""Run SmartDiagram enterprise background workers.

The script is intentionally dependency-light so local Docker deployments can
run worker loops without introducing Celery/RQ/Arq yet.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.services.export_job_service import run_pending_export_jobs_once, run_redis_export_jobs_once
from app.services.knowledge_ingestion_worker import (
    run_pending_knowledge_ingestion_jobs_once,
    run_redis_knowledge_ingestion_jobs_once,
)
from app.services.worker_recovery_service import recover_stale_worker_jobs_once

KNOWLEDGE_STORAGE_ROOT = Path(__file__).resolve().parents[1] / "storage" / "knowledge"


async def run_workers_once(
    *,
    limit: int,
    include_exports: bool,
    include_knowledge_db: bool,
    include_knowledge_redis: bool,
    recover_stale: bool,
    stale_action: str | None,
    stale_after_seconds: int | None,
) -> dict[str, Any]:
    """Run selected worker queues once and return a summary."""

    summary: dict[str, Any] = {}
    if recover_stale:
        summary["stale_recovery"] = await recover_stale_worker_jobs_once(
            limit=limit,
            action=stale_action,
            stale_after_seconds=stale_after_seconds,
        )
    if include_exports:
        summary["exports_redis"] = await run_redis_export_jobs_once(limit=limit)
        summary["exports_db"] = await run_pending_export_jobs_once(limit=limit)
    if include_knowledge_db:
        summary["knowledge_db"] = await run_pending_knowledge_ingestion_jobs_once(
            KNOWLEDGE_STORAGE_ROOT,
            limit=limit,
        )
    if include_knowledge_redis:
        summary["knowledge_redis"] = await run_redis_knowledge_ingestion_jobs_once(
            KNOWLEDGE_STORAGE_ROOT,
            limit=limit,
            queue_name=settings.KNOWLEDGE_INGESTION_REDIS_QUEUE,
        )
    return summary


def _queue_flags(queue: str) -> tuple[bool, bool, bool]:
    if queue == "all":
        return True, True, True
    return queue == "exports", queue == "knowledge-db", queue == "knowledge-redis"


async def run(args: argparse.Namespace) -> int:
    include_exports, include_knowledge_db, include_knowledge_redis = _queue_flags(args.queue)
    while True:
        summary = await run_workers_once(
            limit=args.limit,
            include_exports=include_exports,
            include_knowledge_db=include_knowledge_db,
            include_knowledge_redis=include_knowledge_redis,
            recover_stale=not args.no_recover_stale,
            stale_action=args.stale_action,
            stale_after_seconds=args.stale_after_seconds,
        )
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
        if not args.loop:
            return 0
        await asyncio.sleep(args.interval_seconds)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--queue",
        choices=["all", "exports", "knowledge-db", "knowledge-redis"],
        default="all",
        help="Worker queue to process.",
    )
    parser.add_argument("--limit", type=int, default=10, help="Maximum jobs to process per queue per pass.")
    parser.add_argument("--no-recover-stale", action="store_true", help="Skip stale running-job recovery.")
    parser.add_argument("--stale-action", choices=["requeue", "fail"], default=None, help="Override stale job action.")
    parser.add_argument("--stale-after-seconds", type=int, default=None, help="Override stale running-job threshold.")
    parser.add_argument("--loop", action="store_true", help="Run continuously instead of one pass.")
    parser.add_argument("--interval-seconds", type=float, default=2.0, help="Sleep interval between loop passes.")
    args = parser.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
