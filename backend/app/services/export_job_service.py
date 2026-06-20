"""Export job processing service."""

from typing import Any

from sqlalchemy import select

from app.artifacts.catalog import default_exports_for_engine, is_office_artifact
from app.core.db import async_session
from app.models.audit import AuditEvent
from app.models.common import utc_now
from app.models.diagram import DiagramVersion
from app.models.export import ExportAsset, ExportJob
from app.services.export_renderers import RenderResult, RenderUnsupported, render_export
from app.services.object_storage import get_object_storage
from app.services.pptx_exporter import create_pptx_export

export_storage = get_object_storage()


def asset_storage_key(
    tenant_id: str,
    project_id: str | None,
    diagram_id: str,
    version_id: str,
    asset_id: str,
    extension: str,
) -> str:
    """Build deterministic object keys for export assets."""

    return (
        f"tenants/{tenant_id}/projects/{project_id or 'default'}"
        f"/diagrams/{diagram_id}/versions/{version_id}/exports/{asset_id}.{extension}"
    )


def render_result_for_format(
    diagram_id: str,
    version: DiagramVersion,
    export_format: str,
) -> RenderResult:
    """Render one diagram version into the requested export format."""

    if is_office_artifact(version.engine_type) and export_format not in default_exports_for_engine(version.engine_type):
        raise RenderUnsupported(f"Export format {export_format} is not supported for {version.engine_type}")
    if export_format == "pptx":
        return {
            "content": create_pptx_export(diagram_id, version),
            "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "extension": "pptx",
            "metadata": {"renderer": "python-pptx", "source": "diagram_version"},
        }
    return render_export(diagram_id, version, export_format)


async def process_export_job(job_id: str) -> dict[str, Any]:
    """Process a queued export job.

    The function opens its own session so it can run either inline or as a
    FastAPI background task. A production deployment can replace this call site
    with Celery/RQ/Arq while preserving the job contract.
    """

    async with async_session() as session:
        job = await session.get(ExportJob, job_id)
        if not job:
            return {"job_id": job_id, "status": "missing", "asset_id": None}

        job.status = "running"
        job.started_at = job.started_at or utc_now()
        await session.flush()

        asset: ExportAsset | None = None
        try:
            version = await session.get(DiagramVersion, job.diagram_version_id)
            if not version or version.diagram_id != job.diagram_id:
                raise ValueError("Diagram version not found for export job")

            rendered = render_result_for_format(job.diagram_id, version, job.format)
            asset = ExportAsset(
                tenant_id=job.tenant_id,
                project_id=job.project_id,
                diagram_id=job.diagram_id,
                diagram_version_id=job.diagram_version_id,
                export_job_id=job.id,
                created_by=job.requested_by,
                format=job.format,
                storage_key="pending",
                mime_type=rendered["mime_type"],
                file_size=0,
                checksum="",
                metadata_json={
                    **rendered["metadata"],
                    "storage_backend": export_storage.backend_name,
                },
            )
            session.add(asset)
            await session.flush()

            storage_key = asset_storage_key(
                job.tenant_id,
                job.project_id,
                job.diagram_id,
                job.diagram_version_id,
                asset.id,
                rendered["extension"],
            )
            info = export_storage.put_object(
                storage_key,
                rendered["content"],
                rendered["mime_type"],
            )
            asset.storage_key = storage_key
            asset.file_size = info["size_bytes"]
            asset.checksum = info["checksum"]
            job.status = "completed"
            job.result_asset_id = asset.id
            job.error_message = ""
            job.ended_at = utc_now()
            session.add(
                AuditEvent(
                    tenant_id=job.tenant_id,
                    project_id=job.project_id,
                    user_id=job.requested_by,
                    event_type="export.completed",
                    severity="info",
                    message=f"Completed {job.format} export job",
                    metadata_json={
                        "export_job_id": job.id,
                        "asset_id": asset.id,
                        "format": job.format,
                        "file_size": asset.file_size,
                        "storage_backend": export_storage.backend_name,
                    },
                )
            )
        except (RenderUnsupported, ValueError) as exc:
            job.status = "failed"
            job.error_message = str(exc)
            job.ended_at = utc_now()
            session.add(
                AuditEvent(
                    tenant_id=job.tenant_id,
                    project_id=job.project_id,
                    user_id=job.requested_by,
                    event_type="export.failed",
                    severity="warning",
                    message=f"Failed {job.format} export job",
                    metadata_json={"export_job_id": job.id, "error": str(exc)},
                )
            )
        except Exception as exc:
            job.status = "failed"
            job.error_message = "Unexpected export job failure"
            job.ended_at = utc_now()
            session.add(
                AuditEvent(
                    tenant_id=job.tenant_id,
                    project_id=job.project_id,
                    user_id=job.requested_by,
                    event_type="export.failed",
                    severity="error",
                    message=f"Failed {job.format} export job",
                    metadata_json={"export_job_id": job.id, "error": str(exc)},
                )
            )

        await session.commit()
        return {
            "job_id": job.id,
            "status": job.status,
            "format": job.format,
            "asset_id": job.result_asset_id,
            "error_message": job.error_message,
        }


async def run_pending_export_jobs_once(*, limit: int = 10) -> dict[str, Any]:
    """Process queued export jobs once from PostgreSQL state."""

    processed: list[dict[str, Any]] = []
    async with async_session() as session:
        statement = (
            select(ExportJob)
            .where(ExportJob.status == "queued")
            .order_by(ExportJob.created_at.asc())
            .limit(max(1, limit))
        )
        jobs = list((await session.execute(statement)).scalars().all())

    for job in jobs:
        processed.append(await process_export_job(job.id))

    return {
        "processed_count": len(processed),
        "queue_backend": "db",
        "jobs": processed,
    }
