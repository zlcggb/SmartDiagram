"""Knowledge base API routes."""

import asyncio
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import async_session, get_session
from app.core.config import settings
from app.models.knowledge import (
    KnowledgeChunk,
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
from app.services.knowledge_acl_service import (
    build_default_knowledge_acl_rules,
    explicit_acl_allows_knowledge,
)
from app.services.permission_service import (
    build_permission_context,
    can_read_knowledge,
    can_write_knowledge,
)
from app.services.knowledge_ingestion_service import (
    ingest_uploaded_document,
    run_knowledge_ingestion_job,
)
from app.services.material_gateway_service import MaterialValidationError, stage_material_upload
from app.services.object_storage import get_object_storage
from app.services.redis_queue_service import RedisQueueError, enqueue_job

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

STORAGE_ROOT = Path(__file__).resolve().parents[2] / "storage" / "knowledge"
knowledge_storage = get_object_storage()


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


def _datetime_value(value) -> str | None:
    return value.isoformat() if value else None


async def _latest_ingestion_job(
    session: AsyncSession,
    document_id: str,
) -> KnowledgeIngestionJob | None:
    statement = (
        select(KnowledgeIngestionJob)
        .where(KnowledgeIngestionJob.document_id == document_id)
        .order_by(KnowledgeIngestionJob.created_at.desc())
        .limit(1)
    )
    return (await session.execute(statement)).scalars().first()


async def _get_authorized_document(
    session: AsyncSession,
    document_id: str,
    permission_context: dict,
) -> KnowledgeDocument:
    if not can_read_knowledge(permission_context):
        raise HTTPException(status_code=403, detail="Missing knowledge:read scope")

    document = await session.get(KnowledgeDocument, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    if document.tenant_id != permission_context["tenant_id"]:
        raise HTTPException(status_code=403, detail="Knowledge document is outside this tenant")
    if document.project_id and not await can_access_project(
        session,
        permission_context,
        document.project_id,
        "knowledge:read",
    ):
        raise HTTPException(status_code=403, detail="Missing project access for knowledge document")

    metadata = {
        "tenant_id": document.tenant_id,
        "team_id": document.team_id,
        "project_id": document.project_id,
        "source_id": document.source_id,
        "document_id": document.id,
        "acl_json": document.acl_json,
    }
    explicit_acl = await explicit_acl_allows_knowledge(
        session,
        metadata,
        permission_context,
        required_scope="knowledge:read",
    )
    if explicit_acl is False:
        raise HTTPException(status_code=403, detail="Knowledge document access denied")
    if explicit_acl is None:
        acl = document.acl_json or {}
        allowed_roles = set(acl.get("roles") or [])
        caller_roles = set(permission_context.get("roles") or [])
        required_scopes = set(acl.get("scopes") or [])
        caller_scopes = set(permission_context.get("allowed_knowledge_scopes") or [])
        if allowed_roles and not allowed_roles.intersection(caller_roles):
            raise HTTPException(status_code=403, detail="Knowledge document access denied")
        if required_scopes and not required_scopes.issubset(caller_scopes):
            raise HTTPException(status_code=403, detail="Knowledge document access denied")
    return document


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
    ingestion_mode: str | None = Form(default=None),
    parse_profile: str | None = Form(default=None),
    origin_system: str | None = Form(default=None),
    origin_project_id: str | None = Form(default=None),
    origin_material_id: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Validate, store, and enqueue a tenant-scoped knowledge material."""

    permission_context = build_permission_context(
        _permission_body(request, tenant_id, user_id, team_id, project_id, roles, scopes)
    )
    if not can_write_knowledge(permission_context):
        raise HTTPException(status_code=403, detail="Missing knowledge:write scope")

    normalized_ingestion_mode = (
        ingestion_mode or request.headers.get("x-ingestion-mode") or "sync"
    ).strip().lower()
    if normalized_ingestion_mode not in {"sync", "async", "queued", "background", "redis"}:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_ingestion_mode", "message": "Unsupported ingestion mode."},
        )
    normalized_parse_profile = (
        parse_profile or request.headers.get("x-parse-profile") or "auto"
    ).strip().lower()
    if normalized_parse_profile not in {"auto", "fast", "deep"}:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_parse_profile", "message": "Unsupported parse profile."},
        )
    requested_route_mode = (request.headers.get("x-route-mode") or "auto").strip().lower()
    if requested_route_mode not in {"auto", "text", "full-context", "rag", "vision"}:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_route_mode", "message": "Unsupported material route mode."},
        )

    try:
        staged = await stage_material_upload(file)
    except MaterialValidationError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message},
        ) from exc

    try:
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

        storage_key = (
            f"tenants/{tenant}/projects/{project or 'default'}/knowledge/"
            f"{staged.content_hash[:16]}-{staged.safe_filename}"
        )
        content = await asyncio.to_thread(staged.path.read_bytes)
        storage_info = await asyncio.to_thread(
            knowledge_storage.put_object,
            storage_key,
            content,
            staged.mime_type,
        )
        origin = {
            "system": origin_system or request.headers.get("x-origin-system") or "",
            "project_id": origin_project_id or request.headers.get("x-origin-project-id") or "",
            "material_id": origin_material_id or request.headers.get("x-origin-material-id") or "",
        }
        document = KnowledgeDocument(
            tenant_id=tenant,
            team_id=team,
            project_id=project,
            source_id=source_id,
            title=source_name or staged.safe_filename,
            original_filename=staged.safe_filename,
            mime_type=staged.mime_type,
            storage_key=storage_key,
            content_hash=staged.content_hash,
            status=staged.processing_status,
            classification=classification,
            created_by=user,
            acl_json={"roles": permission_context.get("roles", [])},
            metadata_json={
                "size_bytes": staged.size_bytes,
                "storage_backend": knowledge_storage.backend_name,
                "storage_checksum": storage_info["checksum"],
                "route_mode": staged.route_mode,
                "requested_route_mode": requested_route_mode,
                "processing_status": staged.processing_status,
                "parse_profile": normalized_parse_profile,
                "origin": {key: value for key, value in origin.items() if value},
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
            stage=staged.processing_status,
            progress=0.0,
            stats_json={
                "size_bytes": staged.size_bytes,
                "ingestion_mode": normalized_ingestion_mode,
                "parse_profile": normalized_parse_profile,
                "route_mode": staged.route_mode,
                "requested_route_mode": requested_route_mode,
            },
        )
        session.add(job)
        await session.flush()

        response_base = {
            "document_id": document.id,
            "source_id": source_id,
            "job_id": job.id,
            "ingestion_job_id": job.id,
            "tenant_id": tenant,
            "project_id": project,
            "storage_key": storage_key,
            "title": document.title,
            "original_filename": document.original_filename,
            "mime_type": document.mime_type,
            "content_hash": document.content_hash,
            "status": document.status,
            "classification": classification,
            "size_bytes": staged.size_bytes,
            "route_mode": staged.route_mode,
            "processing_status": staged.processing_status,
            "acl_rule_count": len(acl_rules),
        }

        if normalized_ingestion_mode in {"async", "queued", "background", "redis"}:
            queue_backend = "redis" if normalized_ingestion_mode == "redis" else "db"
            job.stats_json = {
                **(job.stats_json or {}),
                "queue_backend": queue_backend,
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
                **response_base,
                "ingestion": {
                    "job_id": job.id,
                    "status": job.status,
                    "stage": job.stage,
                    "progress": job.progress,
                    "mode": normalized_ingestion_mode,
                    "queue_backend": queue_backend,
                },
            }

        ingestion_stats = await ingest_uploaded_document(session, document, job, staged.path)
        await session.commit()
        return {
            **response_base,
            "status": document.status,
            "processing_status": document.status,
            "ingestion": ingestion_stats,
        }
    finally:
        staged.cleanup()


@router.get("/documents/{document_id}")
async def get_knowledge_document(
    request: Request,
    document_id: str,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Return an authorized document snapshot and its latest ingestion state."""

    permission_context = build_permission_context(
        _permission_body(request, tenant_id, user_id, team_id, project_id, roles, scopes)
    )
    document = await _get_authorized_document(session, document_id, permission_context)
    job = await _latest_ingestion_job(session, document.id)
    metadata = document.metadata_json or {}
    ingestion = {
        "job_id": job.id if job else None,
        "status": job.status if job else None,
        "stage": job.stage if job else None,
        "progress": job.progress if job else None,
        "error_message": job.error_message if job else "",
        "stats": (job.stats_json or {}) if job else {},
    }
    return {
        "document_id": document.id,
        "source_id": document.source_id,
        "job_id": job.id if job else None,
        "ingestion_job_id": job.id if job else None,
        "tenant_id": document.tenant_id,
        "team_id": document.team_id,
        "project_id": document.project_id,
        "title": document.title,
        "original_filename": document.original_filename,
        "mime_type": document.mime_type,
        "size_bytes": int(metadata.get("size_bytes") or 0),
        "content_hash": document.content_hash,
        "status": document.status,
        "classification": document.classification,
        "route_mode": metadata.get("route_mode") or "",
        "processing_status": metadata.get("processing_status") or document.status,
        "created_at": _datetime_value(document.created_at),
        "updated_at": _datetime_value(document.updated_at),
        "ingestion": ingestion,
    }


@router.get("/documents/{document_id}/chunks")
async def list_knowledge_document_chunks(
    request: Request,
    document_id: str,
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    team_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    roles: str | None = Query(default=None),
    scopes: str | None = Query(default=None),
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    """Return stable, cited chunks for an indexed document."""

    permission_context = build_permission_context(
        _permission_body(request, tenant_id, user_id, team_id, project_id, roles, scopes)
    )
    document = await _get_authorized_document(session, document_id, permission_context)
    if document.status != "indexed":
        job = await _latest_ingestion_job(session, document.id)
        raise HTTPException(
            status_code=409,
            detail={
                "code": "document_not_ready",
                "document_id": document.id,
                "status": document.status,
                "job_id": job.id if job else None,
                "stage": job.stage if job else None,
                "progress": job.progress if job else None,
                "error_message": job.error_message if job else "",
            },
        )

    statement = (
        select(KnowledgeChunk)
        .where(
            KnowledgeChunk.tenant_id == document.tenant_id,
            KnowledgeChunk.document_id == document.id,
            KnowledgeChunk.status == "active",
            KnowledgeChunk.chunk_index >= cursor,
        )
        .order_by(KnowledgeChunk.chunk_index, KnowledgeChunk.id)
        .limit(limit + 1)
    )
    rows = list((await session.execute(statement)).scalars().all())
    has_more = len(rows) > limit
    visible = rows[:limit]
    chunks = [
        {
            "chunk_id": chunk.id,
            "chunk_index": chunk.chunk_index,
            "text": chunk.text,
            "summary": chunk.summary,
            "heading_path": chunk.heading_path,
            "source_locator": chunk.source_locator,
            "token_count": chunk.token_count,
            "citation": {
                "source_id": chunk.source_id,
                "document_id": chunk.document_id,
                "source_locator": chunk.source_locator,
            },
            "metadata": chunk.metadata_json or {},
        }
        for chunk in visible
    ]
    return {
        "document_id": document.id,
        "status": document.status,
        "chunks": chunks,
        "next_cursor": visible[-1].chunk_index + 1 if has_more and visible else None,
        "has_more": has_more,
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

    document = (
        await _get_authorized_document(session, job.document_id, permission_context)
        if job.document_id
        else None
    )

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
