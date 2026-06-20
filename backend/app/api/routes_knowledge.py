"""Knowledge base API routes."""

import hashlib
import re
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import async_session, get_session
from app.core.config import settings
from app.models.knowledge import (
    KnowledgeDocument,
    KnowledgeIngestionJob,
    KnowledgeSource,
)
from app.services.knowledge_retriever import retrieve_authorized_chunks_from_db
from app.services.diagram_template_service import (
    create_artifact_template,
    list_authorized_artifact_templates,
    serialize_diagram_template,
)
from app.services.access_control_service import (
    can_access_project,
    ensure_project_membership,
    ensure_team_membership,
)
from app.services.audit_service import ensure_principals
from app.services.knowledge_acl_service import build_default_knowledge_acl_rules
from app.services.permission_service import (
    build_permission_context,
    can_read_knowledge,
    can_write_knowledge,
)
from app.services.knowledge_ingestion_service import (
    ingest_uploaded_document,
    run_knowledge_ingestion_job,
)
from app.services.object_storage import get_object_storage
from app.services.redis_queue_service import RedisQueueError, enqueue_job

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

STORAGE_ROOT = Path(__file__).resolve().parents[2] / "storage" / "knowledge"
knowledge_storage = get_object_storage()


def _safe_filename(filename: str | None) -> str:
    raw = filename or "uploaded-file"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("._")
    return safe or "uploaded-file"


def _permission_body(
    request: Request,
    tenant_id: str | None,
    user_id: str | None,
    team_id: str | None,
    project_id: str | None,
    roles: str | None,
    scopes: str | None,
) -> dict:
    return {
        "tenant_id": tenant_id or request.headers.get("x-tenant-id"),
        "user_id": user_id or request.headers.get("x-user-id"),
        "team_id": team_id or request.headers.get("x-team-id"),
        "project_id": project_id or request.headers.get("x-project-id"),
        "roles": roles or request.headers.get("x-roles"),
        "scopes": scopes or request.headers.get("x-scopes"),
    }


def _raise_template_error(exc: Exception) -> None:
    message = str(exc)
    if isinstance(exc, PermissionError):
        status = 403
    elif message.endswith("_not_found"):
        status = 404
    else:
        status = 400
    raise HTTPException(status_code=status, detail=message)


async def _run_ingestion_job_background(job_id: str) -> None:
    async with async_session() as session:
        await run_knowledge_ingestion_job(session, job_id, STORAGE_ROOT)


@router.post("/templates")
async def create_template(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Create a governed enterprise template for diagrams or office artifacts."""

    body = await request.json()
    permission_context = build_permission_context(
        _permission_body(
            request,
            body.get("tenant_id"),
            body.get("user_id"),
            body.get("team_id"),
            body.get("project_id"),
            body.get("roles"),
            body.get("scopes"),
        )
    )
    try:
        template = await create_artifact_template(session, permission_context, body)
        await session.commit()
        return serialize_diagram_template(template, include_code=True)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_template_error(exc)


@router.get("/templates")
async def list_templates(
    request: Request,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    query: str = Query(default=""),
    engine_type: str = Query(default=""),
    task_type: str = Query(default=""),
    include_code: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    """List governed templates visible to the caller."""

    permission_context = build_permission_context(
        _permission_body(request, tenant_id, user_id, team_id, project_id, roles, scopes)
    )
    try:
        templates = await list_authorized_artifact_templates(
            session,
            permission_context,
            query=query,
            engine_type=engine_type,
            task_type=task_type,
            include_code=include_code,
            limit=limit,
        )
        return {"templates": templates, "count": len(templates)}
    except (PermissionError, ValueError) as exc:
        _raise_template_error(exc)


@router.post("/documents")
async def upload_knowledge_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    tenant_id: str | None = Form(default=None),
    user_id: str | None = Form(default=None),
    team_id: str | None = Form(default=None),
    project_id: str | None = Form(default=None),
    roles: str | None = Form(default=None),
    scopes: str | None = Form(default=None),
    source_id: str | None = Form(default=None),
    source_name: str | None = Form(default=None),
    classification: str = Form(default="internal"),
    ingestion_mode: str = Form(default="sync"),
    session: AsyncSession = Depends(get_session),
):
    """Upload a document into the tenant-scoped knowledge base.

    This endpoint stores the original file locally for MVP development and
    creates the source/document/ingestion-job records needed by the later parser,
    chunker, embedding, and retriever tasks.
    """

    permission_context = build_permission_context(
        _permission_body(request, tenant_id, user_id, team_id, project_id, roles, scopes)
    )
    if not can_write_knowledge(permission_context):
        raise HTTPException(status_code=403, detail="Missing knowledge:write scope")

    tenant = permission_context["tenant_id"]
    user = permission_context["user_id"]
    team = permission_context.get("team_id")
    project = permission_context.get("project_id")
    created_principals = await ensure_principals(session, permission_context, None)
    if created_principals.get("team"):
        await ensure_team_membership(session, permission_context)
    if project:
        if created_principals.get("project"):
            await ensure_project_membership(
                session,
                permission_context,
                scopes=[
                    "project:read",
                    "project:write",
                    "knowledge:read",
                    "knowledge:write",
                    "diagram:read",
                    "export:basic",
                ],
            )
        elif not await can_access_project(session, permission_context, project, "knowledge:write"):
            raise HTTPException(status_code=403, detail="Missing project access for knowledge upload")

    created_source = False
    if source_id:
        source = await session.get(KnowledgeSource, source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Knowledge source not found")
        if source.tenant_id != tenant:
            raise HTTPException(status_code=403, detail="Knowledge source is outside this tenant")
        if project and source.project_id not in (None, project):
            raise HTTPException(status_code=403, detail="Knowledge source is outside this project")
        if team and source.team_id not in (None, team):
            raise HTTPException(status_code=403, detail="Knowledge source is outside this team")
        if source.project_id and not await can_access_project(
            session,
            permission_context,
            source.project_id,
            "knowledge:write",
        ):
            raise HTTPException(status_code=403, detail="Missing project access for knowledge source")
    else:
        source = KnowledgeSource(
            tenant_id=tenant,
            team_id=team,
            project_id=project,
            name=source_name or "Uploaded documents",
            source_type="upload",
            status="active",
            classification=classification,
            created_by=user,
            acl_json={"roles": permission_context.get("roles", [])},
        )
        session.add(source)
        source_id = source.id
        created_source = True
        await session.flush()

    content = await file.read()
    content_hash = hashlib.sha256(content).hexdigest()
    safe_name = _safe_filename(file.filename)
    storage_key = (
        f"tenants/{tenant}/projects/{project or 'default'}/knowledge/"
        f"{content_hash[:16]}-{safe_name}"
    )
    storage_info = knowledge_storage.put_object(
        storage_key,
        content,
        file.content_type or "application/octet-stream",
    )
    storage_path = STORAGE_ROOT / storage_key
    storage_path.parent.mkdir(parents=True, exist_ok=True)
    storage_path.write_bytes(content)

    document = KnowledgeDocument(
        tenant_id=tenant,
        team_id=team,
        project_id=project,
        source_id=source_id,
        title=source_name or file.filename or safe_name,
        original_filename=file.filename or safe_name,
        mime_type=file.content_type or "",
        storage_key=storage_key,
        content_hash=content_hash,
        status="uploaded",
        classification=classification,
        created_by=user,
        acl_json={"roles": permission_context.get("roles", [])},
        metadata_json={
            "size_bytes": len(content),
            "storage_backend": knowledge_storage.backend_name,
            "storage_checksum": storage_info["checksum"],
        },
    )
    session.add(document)
    await session.flush()

    acl_rules = build_default_knowledge_acl_rules(
        permission_context,
        source_id=source_id if created_source else None,
        document_id=document.id,
        created_by=user,
    )
    for rule in acl_rules:
        session.add(rule)
    await session.flush()

    job = KnowledgeIngestionJob(
        tenant_id=tenant,
        source_id=source_id,
        document_id=document.id,
        requested_by=user,
        status="queued",
        stage="uploaded",
        progress=0.0,
        stats_json={
            "size_bytes": len(content),
            "ingestion_mode": ingestion_mode,
        },
    )
    session.add(job)
    await session.flush()

    normalized_ingestion_mode = ingestion_mode.lower()
    if normalized_ingestion_mode in {"async", "queued", "background", "redis"}:
        job.stats_json = {
            **(job.stats_json or {}),
            "queue_backend": "redis" if normalized_ingestion_mode == "redis" else "db",
            "queue_name": settings.KNOWLEDGE_INGESTION_REDIS_QUEUE
            if normalized_ingestion_mode == "redis"
            else "",
        }
        await session.commit()
        if normalized_ingestion_mode == "redis":
            try:
                await enqueue_job(settings.KNOWLEDGE_INGESTION_REDIS_QUEUE, job.id)
            except RedisQueueError as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
        elif normalized_ingestion_mode != "queued":
            background_tasks.add_task(_run_ingestion_job_background, job.id)
        return {
            "document_id": document.id,
            "source_id": source_id,
            "ingestion_job_id": job.id,
            "tenant_id": tenant,
            "project_id": project,
            "storage_key": storage_key,
            "status": document.status,
            "classification": classification,
            "size_bytes": len(content),
            "acl_rule_count": len(acl_rules),
            "ingestion": {
                "status": job.status,
                "stage": job.stage,
                "progress": job.progress,
                "mode": normalized_ingestion_mode,
                "queue_backend": "redis" if normalized_ingestion_mode == "redis" else "db",
            },
        }

    ingestion_stats = await ingest_uploaded_document(session, document, job, storage_path)
    await session.commit()

    return {
        "document_id": document.id,
        "source_id": source_id,
        "ingestion_job_id": job.id,
        "tenant_id": tenant,
        "project_id": project,
        "storage_key": storage_key,
        "status": document.status,
        "classification": classification,
        "size_bytes": len(content),
        "acl_rule_count": len(acl_rules),
        "ingestion": ingestion_stats,
    }


@router.get("/ingestion-jobs/{job_id}")
async def get_knowledge_ingestion_job(
    request: Request,
    job_id: str,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Return ingestion job status with tenant and project authorization."""

    permission_context = build_permission_context(
        _permission_body(request, tenant_id, user_id, team_id, project_id, roles, scopes)
    )
    if not can_read_knowledge(permission_context):
        raise HTTPException(status_code=403, detail="Missing knowledge:read scope")

    job = await session.get(KnowledgeIngestionJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Knowledge ingestion job not found")
    if job.tenant_id != permission_context["tenant_id"]:
        raise HTTPException(status_code=403, detail="Knowledge ingestion job is outside this tenant")

    document = await session.get(KnowledgeDocument, job.document_id) if job.document_id else None
    if document and document.project_id and not await can_access_project(
        session,
        permission_context,
        document.project_id,
        "knowledge:read",
    ):
        raise HTTPException(status_code=403, detail="Missing project access for ingestion job")

    return {
        "id": job.id,
        "tenant_id": job.tenant_id,
        "source_id": job.source_id,
        "document_id": job.document_id,
        "project_id": document.project_id if document else None,
        "status": job.status,
        "stage": job.stage,
        "progress": job.progress,
        "error_message": job.error_message,
        "stats": job.stats_json,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "ended_at": job.ended_at.isoformat() if job.ended_at else None,
    }


@router.post("/search")
async def search_knowledge(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Search authorized knowledge chunks for a request-scoped user."""

    body = await request.json()
    query = str(body.get("query") or "").strip()
    if not query:
        return {"query": query, "chunks": []}

    permission_context = build_permission_context(
        _permission_body(
            request,
            body.get("tenant_id"),
            body.get("user_id"),
            body.get("team_id"),
            body.get("project_id"),
            body.get("roles"),
            body.get("scopes"),
        )
    )
    if not can_read_knowledge(permission_context):
        raise HTTPException(status_code=403, detail="Missing knowledge:read scope")
    project = permission_context.get("project_id")
    if project and not await can_access_project(session, permission_context, project, "knowledge:read"):
        raise HTTPException(status_code=403, detail="Missing project access for knowledge search")

    chunks = await retrieve_authorized_chunks_from_db(
        session,
        query,
        permission_context,
        top_k=int(body.get("top_k") or 5),
    )
    await session.commit()
    return {
        "query": query,
        "chunks": chunks,
        "citations": [chunk["citation"] for chunk in chunks],
    }
