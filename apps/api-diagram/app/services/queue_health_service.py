"""Queue health snapshots for enterprise worker observability."""

from datetime import datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.common import utc_now
from app.models.export import ExportJob
from app.models.knowledge import KnowledgeDocument, KnowledgeIngestionJob, KnowledgeSource
from app.state.agent_runtime import PermissionContext


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _age_seconds(value: datetime | None) -> int | None:
    if not value:
        return None
    return max(0, int((utc_now() - value).total_seconds()))


def _summarize_jobs(jobs: list[Any]) -> dict[str, Any]:
    status_counts: dict[str, int] = {}
    oldest_queued_at: datetime | None = None
    oldest_running_at: datetime | None = None
    newest_failure_at: datetime | None = None
    stale_running_count = 0
    stale_after_seconds = max(1, int(settings.WORKER_STALE_JOB_TIMEOUT_SECONDS))

    for job in jobs:
        status = str(getattr(job, "status", "") or "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
        if status == "queued":
            created_at = getattr(job, "created_at", None)
            if created_at and (oldest_queued_at is None or created_at < oldest_queued_at):
                oldest_queued_at = created_at
        if status == "running":
            started_at = getattr(job, "started_at", None) or getattr(job, "created_at", None)
            if started_at and (oldest_running_at is None or started_at < oldest_running_at):
                oldest_running_at = started_at
            if _age_seconds(started_at) is not None and _age_seconds(started_at) >= stale_after_seconds:
                stale_running_count += 1
        if status == "failed":
            ended_at = getattr(job, "ended_at", None) or getattr(job, "created_at", None)
            if ended_at and (newest_failure_at is None or ended_at > newest_failure_at):
                newest_failure_at = ended_at

    return {
        "total": len(jobs),
        "status_counts": dict(sorted(status_counts.items())),
        "queued_count": status_counts.get("queued", 0),
        "running_count": status_counts.get("running", 0),
        "failed_count": status_counts.get("failed", 0),
        "stale_running_count": stale_running_count,
        "stale_after_seconds": stale_after_seconds,
        "oldest_queued_at": _iso(oldest_queued_at),
        "oldest_queued_age_seconds": _age_seconds(oldest_queued_at),
        "oldest_running_at": _iso(oldest_running_at),
        "oldest_running_age_seconds": _age_seconds(oldest_running_at),
        "newest_failure_at": _iso(newest_failure_at),
    }


async def get_queue_health_snapshot(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    project_id: str | None = None,
) -> dict[str, Any]:
    """Return worker queue health for the current tenant or project."""

    tenant_id = permission_context.get("tenant_id") or "local"
    export_statement = select(ExportJob).where(ExportJob.tenant_id == tenant_id)
    if project_id:
        export_statement = export_statement.where(ExportJob.project_id == project_id)
    export_jobs = list((await session.execute(export_statement)).scalars().all())

    knowledge_statement = select(KnowledgeIngestionJob).where(KnowledgeIngestionJob.tenant_id == tenant_id)
    if project_id:
        knowledge_statement = (
            knowledge_statement.outerjoin(
                KnowledgeDocument,
                KnowledgeIngestionJob.document_id == KnowledgeDocument.id,
            )
            .outerjoin(
                KnowledgeSource,
                KnowledgeIngestionJob.source_id == KnowledgeSource.id,
            )
            .where(
                or_(
                    KnowledgeDocument.project_id == project_id,
                    KnowledgeSource.project_id == project_id,
                )
            )
        )
    knowledge_jobs = list((await session.execute(knowledge_statement)).scalars().all())

    exports = _summarize_jobs(export_jobs)
    knowledge = _summarize_jobs(knowledge_jobs)
    return {
        "tenant_id": tenant_id,
        "project_id": project_id,
        "generated_at": utc_now().isoformat(),
        "queues": {
            "exports": exports,
            "knowledge_ingestion": knowledge,
        },
        "totals": {
            "jobs": exports["total"] + knowledge["total"],
            "queued": exports["queued_count"] + knowledge["queued_count"],
            "running": exports["running_count"] + knowledge["running_count"],
            "failed": exports["failed_count"] + knowledge["failed_count"],
        },
    }
