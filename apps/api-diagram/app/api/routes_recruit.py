"""Recruiting / ATS API routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.services.file_parser_service import DocumentParseError, UnsupportedDocumentTypeError, parse_file
from app.services.material_gateway_service import MaterialValidationError, stage_material_upload
from app.services.recruit_service import (
    add_interview,
    analytics_summary,
    create_candidate,
    create_job,
    dashboard_summary,
    get_candidate_detail,
    get_job_detail,
    list_candidates,
    list_interviews,
    list_jobs,
    recruit_permission_context,
    rerun_candidate_screening,
    update_candidate_stage,
    update_job,
)

router = APIRouter(prefix="/recruit", tags=["recruit"])


def _raise_recruit_error(exc: Exception) -> None:
    message = str(exc)
    if isinstance(exc, PermissionError):
        status = 403
    elif message.endswith("_not_found"):
        status = 404
    elif message.endswith("_duplicate"):
        status = 409
    elif message.endswith("_required"):
        status = 422
    else:
        status = 400
    raise HTTPException(status_code=status, detail=message)


async def _parsed_upload(file: UploadFile | None) -> tuple[dict[str, Any] | None, str, str, str, Any]:
    staged = None
    parsed_document = None
    source_name = ""
    source_mime_type = ""
    source_hash = ""
    if file is not None and file.filename:
        try:
            staged = await stage_material_upload(file)
        except MaterialValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc
        source_name = staged.safe_filename
        source_mime_type = staged.mime_type
        source_hash = staged.content_hash
        try:
            parsed_document = parse_file(staged.path, mime_type=staged.mime_type, filename=staged.safe_filename)
        except UnsupportedDocumentTypeError as exc:
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        except DocumentParseError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return parsed_document, source_name, source_mime_type, source_hash, staged


@router.get("/dashboard")
async def get_dashboard(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers))
    return await dashboard_summary(session, permission_context)


@router.get("/jobs")
async def get_jobs(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers))
    return await list_jobs(session, permission_context)


@router.post("/jobs")
async def post_job(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    body = await request.json()
    permission_context = recruit_permission_context(dict(request.headers), body)
    try:
        return await create_job(session, permission_context, body)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers), dict(request.query_params))
    try:
        return await get_job_detail(session, permission_context, job_id)
    except (PermissionError, ValueError) as exc:
        _raise_recruit_error(exc)


@router.patch("/jobs/{job_id}")
async def patch_job(
    job_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    body = await request.json()
    permission_context = recruit_permission_context(dict(request.headers), body)
    try:
        return await update_job(session, permission_context, job_id, body)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)


@router.get("/candidates")
async def get_candidates(
    request: Request,
    job_id: str | None = Query(default=None),
    stage: str | None = Query(default=None),
    query: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers), dict(request.query_params))
    return await list_candidates(session, permission_context, job_id=job_id, stage=stage, query=query)


@router.post("/candidates")
async def post_candidate(
    request: Request,
    file: UploadFile | None = File(default=None),
    job_id: str = Form(...),
    full_name: str = Form(...),
    email: str | None = Form(default=None),
    phone: str | None = Form(default=None),
    current_company: str | None = Form(default=None),
    location: str | None = Form(default=None),
    source_channel: str | None = Form(default=None),
    portfolio_url: str | None = Form(default=None),
    linkedin_url: str | None = Form(default=None),
    summary: str | None = Form(default=None),
    notes: str | None = Form(default=None),
    tags: str | None = Form(default=None),
    resume_text: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
):
    body = {
        "job_id": job_id,
        "full_name": full_name,
        "email": email,
        "phone": phone,
        "current_company": current_company,
        "location": location,
        "source_channel": source_channel,
        "portfolio_url": portfolio_url,
        "linkedin_url": linkedin_url,
        "summary": summary,
        "notes": notes,
        "tags": tags,
        "resume_text": resume_text,
    }
    permission_context = recruit_permission_context(dict(request.headers), body)
    parsed_document, source_name, source_mime_type, source_hash, staged = await _parsed_upload(file)
    try:
        return await create_candidate(
            session,
            permission_context,
            body=body,
            parsed_document=parsed_document,
            source_name=source_name,
            source_mime_type=source_mime_type,
            source_hash=source_hash,
        )
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)
    finally:
        if staged is not None and staged.path.exists():
            staged.path.unlink(missing_ok=True)


@router.get("/candidates/{candidate_id}")
async def get_candidate(
    candidate_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers), dict(request.query_params))
    try:
        return await get_candidate_detail(session, permission_context, candidate_id)
    except (PermissionError, ValueError) as exc:
        _raise_recruit_error(exc)


@router.post("/candidates/{candidate_id}/screenings")
async def post_candidate_screening(
    candidate_id: str,
    request: Request,
    file: UploadFile | None = File(default=None),
    resume_text: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers), {"resume_text": resume_text})
    parsed_document, source_name, source_mime_type, source_hash, staged = await _parsed_upload(file)
    try:
        return await rerun_candidate_screening(
            session,
            permission_context,
            candidate_id,
            parsed_document=parsed_document,
            resume_text_override=resume_text,
            source_name=source_name,
            source_mime_type=source_mime_type,
            source_hash=source_hash,
        )
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)
    finally:
        if staged is not None and staged.path.exists():
            staged.path.unlink(missing_ok=True)


@router.post("/candidates/{candidate_id}/stage")
async def post_candidate_stage(
    candidate_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    body = await request.json()
    permission_context = recruit_permission_context(dict(request.headers), body)
    try:
        return await update_candidate_stage(
            session,
            permission_context,
            candidate_id,
            stage=str(body.get("stage") or ""),
            status=body.get("status"),
        )
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)


@router.post("/candidates/{candidate_id}/interviews")
async def post_interview(
    candidate_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    body = await request.json()
    permission_context = recruit_permission_context(dict(request.headers), body)
    try:
        return await add_interview(session, permission_context, candidate_id, body)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)


@router.get("/interviews")
async def get_interviews(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers), dict(request.query_params))
    return await list_interviews(session, permission_context)


@router.get("/analytics")
async def get_analytics(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers), dict(request.query_params))
    return await analytics_summary(session, permission_context)
