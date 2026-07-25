"""Worker helpers for queued knowledge ingestion jobs."""

from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import async_session
from app.models.knowledge import KnowledgeIngestionJob
from app.services.knowledge_ingestion_service import run_knowledge_ingestion_job
from app.services.redis_queue_service import (
    acquire_worker_job_lock,
    dequeue_job,
    release_worker_job_lock,
)


async def run_pending_knowledge_ingestion_jobs_once(
    storage_root: str | Path,
    *,
    limit: int = 10,
) -> dict[str, Any]:
    """Process queued knowledge ingestion jobs once.

    This gives local/dev deployments a recoverable DB-backed worker boundary.
    Production can run the same function from a scheduler or replace the caller
    with Redis/Celery/RQ/Arq while preserving job state in PostgreSQL.
    """

    processed: list[dict[str, Any]] = []
    async with async_session() as session:
        statement = (
            select(KnowledgeIngestionJob)
            .where(KnowledgeIngestionJob.status == "queued")
            .order_by(KnowledgeIngestionJob.created_at.asc())
            .limit(max(1, limit))
        )
        jobs = list((await session.execute(statement)).scalars().all())

    for job in jobs:
        async with async_session() as session:
            result = await _process_knowledge_job_guarded(session, job.id, storage_root)
            processed.append(result)

    return {
        "processed_count": len(processed),
        "jobs": processed,
    }


async def _process_knowledge_job_guarded(
    session: AsyncSession,
    job_id: str,
    storage_root: str | Path,
) -> dict[str, Any]:
    """Run one knowledge job under a Redis worker lock."""

    if not await acquire_worker_job_lock(job_id):
        return {"job_id": job_id, "status": "skipped", "reason": "locked", "stage": "locked"}

    try:
        stats = await run_knowledge_ingestion_job(session, job_id, storage_root)
        refreshed = await session.get(KnowledgeIngestionJob, job_id)
        return {
            "job_id": job_id,
            "status": refreshed.status if refreshed else "missing",
            "stage": refreshed.stage if refreshed else "missing",
            "stats": stats,
        }
    finally:
        await release_worker_job_lock(job_id)


async def run_redis_knowledge_ingestion_jobs_once(
    storage_root: str | Path,
    *,
    limit: int = 10,
    queue_name: str | None = None,
) -> dict[str, Any]:
    """Process knowledge ingestion jobs from a Redis list queue once."""

    queue = queue_name or settings.KNOWLEDGE_INGESTION_REDIS_QUEUE
    processed: list[dict[str, Any]] = []
    for _ in range(max(1, limit)):
        job_id = await dequeue_job(queue)
        if not job_id:
            break
        async with async_session() as session:
            result = await _process_knowledge_job_guarded(session, job_id, storage_root)
            processed.append(
                {
                    **result,
                    "queue_backend": "redis",
                    "queue_name": queue,
                }
            )

    return {
        "processed_count": len(processed),
        "queue_backend": "redis",
        "queue_name": queue,
        "jobs": processed,
    }
