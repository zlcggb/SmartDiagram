"""Export API routes."""

import hashlib
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.artifacts.catalog import default_exports_for_engine, is_office_artifact
from app.core.config import settings
from app.core.db import get_session
from app.models.audit import AuditEvent
from app.models.common import utc_now
from app.models.diagram import Diagram, DiagramVersion
from app.models.export import ExportAsset, ExportJob, ExportPresignedURL
from app.services.access_control_service import can_access_project
from app.services.audit_service import ensure_principals
from app.services.export_confirmation_service import (
    confirmation_detail,
    confirmation_metadata,
    confirmation_was_accepted,
    export_requires_confirmation,
)
from app.services.export_job_service import export_storage, process_export_job
from app.services.permission_service import build_permission_context, can_export, required_export_scope
from app.services.redis_queue_service import RedisQueueError, enqueue_job

router = APIRouter(tags=["exports"])


def _body_with_headers(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    merged = dict(body)
    merged.setdefault("tenant_id", request.headers.get("x-tenant-id"))
    merged.setdefault("user_id", request.headers.get("x-user-id"))
    merged.setdefault("team_id", request.headers.get("x-team-id"))
    merged.setdefault("project_id", request.headers.get("x-project-id"))
    merged.setdefault("roles", request.headers.get("x-roles"))
    merged.setdefault("scopes", request.headers.get("x-scopes"))
    return merged


def _download_filename(asset: ExportAsset) -> str:
    return f"smartdiagram-{asset.diagram_id}.{asset.format}"


@router.post("/diagrams/{diagram_id}/versions/{version_id}/exports")
async def create_export_job(
    diagram_id: str,
    version_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    """Create an export job for a diagram version.

    JSON, SVG, PNG, PDF, and PPTX exports can complete synchronously in local
    dev, run through FastAPI background tasks with `mode=async`, or stay queued
    for an external worker with `mode=queued`.
    """

    body = await request.json()
    export_format = str(body.get("format") or "json").lower()
    mode = str(body.get("mode") or "").lower()
    redis_requested = mode == "redis"
    queued_requested = bool(body.get("queued") or mode in {"queued", "queue", "worker"})
    async_requested = bool(
        not queued_requested
        and not redis_requested
        and (
            body.get("async")
            or body.get("async_export")
            or body.get("background")
            or mode in {"async", "background"}
        )
    )
    permission_context = build_permission_context(_body_with_headers(request, body))
    if not can_export(permission_context, export_format):
        raise HTTPException(status_code=403, detail=f"Missing export scope for {export_format}")

    version = await session.get(DiagramVersion, version_id)
    if not version or version.diagram_id != diagram_id:
        raise HTTPException(status_code=404, detail="Diagram version not found")
    if version.tenant_id != permission_context["tenant_id"]:
        raise HTTPException(status_code=403, detail="Diagram version is outside this tenant")
    supported_formats = default_exports_for_engine(version.engine_type)
    if is_office_artifact(version.engine_type) and export_format not in supported_formats:
        raise HTTPException(
            status_code=400,
            detail=f"Export format {export_format} is not supported for {version.engine_type}; supported: {', '.join(supported_formats)}",
        )
    diagram = await session.get(Diagram, diagram_id)
    resource_project_id = diagram.project_id if diagram else None
    if resource_project_id:
        permission_context["project_id"] = resource_project_id
    await ensure_principals(session, permission_context, None)
    if not await can_access_project(session, permission_context, resource_project_id, "diagram:read"):
        raise HTTPException(status_code=403, detail="Missing project access for diagram export")

    requested_mode = "redis" if redis_requested else "queued" if queued_requested else "async" if async_requested else "sync"
    requires_confirmation = export_requires_confirmation(export_format)
    confirmation_meta = confirmation_metadata(
        export_format=export_format,
        diagram_id=diagram_id,
        version_id=version_id,
        mode=requested_mode,
        body=body,
    )
    if requires_confirmation and not confirmation_was_accepted(body):
        session.add(
            AuditEvent(
                tenant_id=permission_context["tenant_id"],
                project_id=resource_project_id,
                user_id=permission_context["user_id"],
                agent_run_id=None,
                event_type="export.confirmation.required",
                severity="warning",
                message=f"{export_format.upper()} export requires human confirmation",
                metadata_json=confirmation_meta,
            )
        )
        await session.commit()
        raise HTTPException(
            status_code=409,
            detail=confirmation_detail(export_format, required_export_scope(export_format)),
        )

    options_json = body.get("options") or {}
    if not isinstance(options_json, dict):
        options_json = {"raw_options": options_json}
    if requires_confirmation:
        session.add(
            AuditEvent(
                tenant_id=permission_context["tenant_id"],
                project_id=resource_project_id,
                user_id=permission_context["user_id"],
                agent_run_id=None,
                event_type="export.confirmation.accepted",
                severity="info",
                message=f"{export_format.upper()} export confirmation accepted",
                metadata_json={**confirmation_meta, "confirmed": True},
            )
        )
        options_json = {
            **options_json,
            "confirmation": {**confirmation_meta, "confirmed": True},
        }

    if redis_requested:
        options_json = {
            **options_json,
            "queue_backend": "redis",
            "queue_name": settings.EXPORT_REDIS_QUEUE,
        }

    job = ExportJob(
        tenant_id=permission_context["tenant_id"],
        project_id=resource_project_id,
        diagram_id=diagram_id,
        diagram_version_id=version_id,
        requested_by=permission_context["user_id"],
        format=export_format,
        status="queued",
        options_json=options_json,
    )
    session.add(job)
    session.add(
        AuditEvent(
            tenant_id=job.tenant_id,
            project_id=job.project_id,
            user_id=job.requested_by,
            agent_run_id=None,
            event_type="export.created",
            severity="info",
            message=f"Created {export_format} export job",
            metadata_json={
                "export_job_id": job.id,
                "format": export_format,
                "mode": requested_mode,
                "confirmation_required": requires_confirmation,
                "confirmed": requires_confirmation and confirmation_was_accepted(body),
            },
        )
    )
    await session.commit()

    if redis_requested:
        try:
            await enqueue_job(settings.EXPORT_REDIS_QUEUE, job.id)
        except RedisQueueError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {
            "job_id": job.id,
            "status": job.status,
            "format": export_format,
            "asset_id": None,
            "mode": "redis",
        }

    if queued_requested:
        return {
            "job_id": job.id,
            "status": job.status,
            "format": export_format,
            "asset_id": None,
            "mode": "queued",
        }

    if async_requested:
        background_tasks.add_task(process_export_job, job.id)
        return {
            "job_id": job.id,
            "status": job.status,
            "format": export_format,
            "asset_id": None,
            "mode": "async",
        }

    processed = await process_export_job(job.id)
    return {
        "job_id": job.id,
        "status": processed["status"],
        "format": export_format,
        "asset_id": processed["asset_id"],
        "mode": "sync",
        "error_message": processed.get("error_message", ""),
    }


@router.get("/export-jobs/{job_id}")
async def get_export_job(
    job_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    permission_context = build_permission_context(_body_with_headers(request, {}))
    job = await session.get(ExportJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")
    if job.tenant_id != permission_context["tenant_id"]:
        raise HTTPException(status_code=403, detail="Export job is outside this tenant")
    if not await can_access_project(session, permission_context, job.project_id, "diagram:read"):
        raise HTTPException(status_code=403, detail="Missing project access for export job")
    return {
        "job_id": job.id,
        "status": job.status,
        "format": job.format,
        "result_asset_id": job.result_asset_id,
        "error_message": job.error_message,
    }


@router.get("/export-assets/{asset_id}/download-url")
async def get_export_asset_download_url(
    asset_id: str,
    request: Request,
    expires_in: int = Query(default=3600, ge=60, le=86400),
    session: AsyncSession = Depends(get_session),
):
    permission_context = build_permission_context(_body_with_headers(request, {}))
    asset = await session.get(ExportAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Export asset not found")
    if asset.tenant_id != permission_context["tenant_id"]:
        raise HTTPException(status_code=403, detail="Export asset is outside this tenant")
    if asset.project_id:
        permission_context["project_id"] = asset.project_id
    await ensure_principals(session, permission_context, None)
    if not await can_access_project(session, permission_context, asset.project_id, "diagram:read"):
        raise HTTPException(status_code=403, detail="Missing project access for export asset")

    if export_storage.backend_name == "local":
        url = str(request.url_for("download_export_asset", asset_id=asset.id))
    else:
        url = export_storage.get_signed_url(asset.storage_key, expires_in=expires_in)
    expires_at = utc_now() + timedelta(seconds=expires_in)
    presigned_url = ExportPresignedURL(
        tenant_id=asset.tenant_id,
        asset_id=asset.id,
        requested_by=permission_context["user_id"],
        url_hash=hashlib.sha256(url.encode("utf-8")).hexdigest(),
        expires_at=expires_at,
    )
    session.add(presigned_url)
    session.add(
        AuditEvent(
            tenant_id=asset.tenant_id,
            project_id=asset.project_id,
            user_id=permission_context["user_id"],
            event_type="export.download_url.created",
            severity="info",
            message="Created export asset download URL",
            metadata_json={
                "asset_id": asset.id,
                "format": asset.format,
                "presigned_url_id": presigned_url.id,
                "expires_at": expires_at.isoformat(),
                "storage_backend": export_storage.backend_name,
            },
        )
    )
    await session.commit()
    return {
        "asset_id": asset.id,
        "download_url": url,
        "expires_in": expires_in,
        "expires_at": expires_at.isoformat(),
        "presigned_url_id": presigned_url.id,
    }


@router.get("/export-assets/{asset_id}/download")
async def download_export_asset(
    asset_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    permission_context = build_permission_context(_body_with_headers(request, {}))
    asset = await session.get(ExportAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Export asset not found")
    if asset.tenant_id != permission_context["tenant_id"]:
        raise HTTPException(status_code=403, detail="Export asset is outside this tenant")
    if asset.project_id:
        permission_context["project_id"] = asset.project_id
    await ensure_principals(session, permission_context, None)
    if not await can_access_project(session, permission_context, asset.project_id, "diagram:read"):
        raise HTTPException(status_code=403, detail="Missing project access for export asset")

    content = export_storage.get_object(asset.storage_key)
    session.add(
        AuditEvent(
            tenant_id=asset.tenant_id,
            project_id=asset.project_id,
            user_id=permission_context["user_id"],
            event_type="export.asset.downloaded",
            severity="info",
            message="Downloaded export asset",
            metadata_json={"asset_id": asset.id, "format": asset.format},
        )
    )
    await session.commit()
    return Response(
        content=content,
        media_type=asset.mime_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{_download_filename(asset)}"',
            "Cache-Control": "private, max-age=300",
        },
    )
