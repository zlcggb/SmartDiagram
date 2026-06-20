"""Worker failure recovery helpers for stale queued-job state."""

from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import async_session
from app.models.audit import AuditEvent
from app.models.common import utc_now
from app.models.export import ExportJob
from app.models.knowledge import KnowledgeIngestionJob


def _stale_cutoff(stale_after_seconds: int | None = None):
    seconds = stale_after_seconds or settings.WORKER_STALE_JOB_TIMEOUT_SECONDS
    return utc_now() - timedelta(seconds=max(1, int(seconds)))


def _stale_seconds(started_at) -> int:
    if not started_at:
        return 0
    return max(0, int((utc_now() - started_at).total_seconds()))


def _normalize_action(action: str | None = None) -> str:
    selected = (action or settings.WORKER_STALE_JOB_ACTION or "requeue").lower()
    if selected not in {"requeue", "fail"}:
        return "requeue"
    return selected


def _recovery_message(queue_name: str, stale_after_seconds: int, action: str) -> str:
    return f"Recovered stale {queue_name} job after {stale_after_seconds}s with action={action}."


async def recover_stale_worker_jobs_once(
    *,
    stale_after_seconds: int | None = None,
    action: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Recover stale running export and knowledge jobs once."""

    async with async_session() as session:
        return await recover_stale_worker_jobs_in_session(
            session,
            stale_after_seconds=stale_after_seconds,
            action=action,
            limit=limit,
        )


async def recover_stale_worker_jobs_in_session(
    session: AsyncSession,
    *,
    stale_after_seconds: int | None = None,
    action: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Recover stale running jobs using an existing session."""

    selected_action = _normalize_action(action)
    threshold = max(1, int(stale_after_seconds or settings.WORKER_STALE_JOB_TIMEOUT_SECONDS))
    cutoff = _stale_cutoff(threshold)
    per_queue_limit = max(1, int(limit))

    export_jobs = list(
        (
            await session.execute(
                select(ExportJob)
                .where(ExportJob.status == "running")
                .where(ExportJob.started_at.is_not(None))
                .where(ExportJob.started_at < cutoff)
                .order_by(ExportJob.started_at.asc())
                .limit(per_queue_limit)
            )
        )
        .scalars()
        .all()
    )
    knowledge_jobs = list(
        (
            await session.execute(
                select(KnowledgeIngestionJob)
                .where(KnowledgeIngestionJob.status == "running")
                .where(KnowledgeIngestionJob.started_at.is_not(None))
                .where(KnowledgeIngestionJob.started_at < cutoff)
                .order_by(KnowledgeIngestionJob.started_at.asc())
                .limit(per_queue_limit)
            )
        )
        .scalars()
        .all()
    )

    recovered: list[dict[str, Any]] = []
    for job in export_jobs:
        stale_for = _stale_seconds(job.started_at)
        previous_status = job.status
        if selected_action == "fail":
            job.status = "failed"
            job.ended_at = utc_now()
        else:
            job.status = "queued"
            job.started_at = None
            job.ended_at = None
        job.error_message = _recovery_message("export", stale_for, selected_action)
        job.options_json = {
            **(job.options_json or {}),
            "stale_recovery": {
                "action": selected_action,
                "previous_status": previous_status,
                "stale_seconds": stale_for,
                "recovered_at": utc_now().isoformat(),
            },
        }
        session.add(
            AuditEvent(
                tenant_id=job.tenant_id,
                project_id=job.project_id,
                user_id=job.requested_by,
                event_type="worker.job.recovered",
                severity="warning",
                message=job.error_message,
                metadata_json={
                    "queue": "exports",
                    "job_id": job.id,
                    "action": selected_action,
                    "previous_status": previous_status,
                    "stale_seconds": stale_for,
                },
            )
        )
        recovered.append({"queue": "exports", "job_id": job.id, "status": job.status, "action": selected_action})

    for job in knowledge_jobs:
        stale_for = _stale_seconds(job.started_at)
        previous_status = job.status
        if selected_action == "fail":
            job.status = "failed"
            job.stage = "failed"
            job.ended_at = utc_now()
        else:
            job.status = "queued"
            job.stage = "queued"
            job.progress = 0.0
            job.started_at = None
            job.ended_at = None
        job.error_message = _recovery_message("knowledge_ingestion", stale_for, selected_action)
        job.stats_json = {
            **(job.stats_json or {}),
            "stale_recovery": {
                "action": selected_action,
                "previous_status": previous_status,
                "stale_seconds": stale_for,
                "recovered_at": utc_now().isoformat(),
            },
        }
        session.add(
            AuditEvent(
                tenant_id=job.tenant_id,
                project_id=None,
                user_id=job.requested_by,
                event_type="worker.job.recovered",
                severity="warning",
                message=job.error_message,
                metadata_json={
                    "queue": "knowledge_ingestion",
                    "job_id": job.id,
                    "action": selected_action,
                    "previous_status": previous_status,
                    "stale_seconds": stale_for,
                },
            )
        )
        recovered.append(
            {
                "queue": "knowledge_ingestion",
                "job_id": job.id,
                "status": job.status,
                "action": selected_action,
            }
        )

    await session.commit()
    return {
        "recovered_count": len(recovered),
        "action": selected_action,
        "stale_after_seconds": threshold,
        "jobs": recovered,
    }
