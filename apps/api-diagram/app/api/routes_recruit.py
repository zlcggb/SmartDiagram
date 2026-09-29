"""Recruiting / ATS API routes."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.llm import list_available_models
from app.services.file_parser_service import DocumentParseError, UnsupportedDocumentTypeError
from app.services.html_pdf_service import MAX_HTML_BYTES, render_html_to_pdf
from app.services.material_gateway_service import MaterialValidationError, stage_material_upload
from app.services.identity_service import require_request_identity
from app.services.permission_service import permission_context_from_identity
from app.services.resume_extraction_service import extract_resume_document, resolve_resume_document
from app.services.recruit_search_service import (
    append_search_turn,
    create_search_conversation,
    get_search_event_batch,
    get_search_conversation,
    list_search_conversations,
    retry_search_turn,
    run_search_conversation,
)
from app.services.recruit_service import (
    add_interview,
    analytics_summary,
    create_candidate,
    create_job,
    create_screening_workflow,
    dashboard_summary,
    ensure_default_ai_job,
    get_candidate_detail,
    get_job_detail,
    list_candidates,
    list_interviews,
    list_jobs,
    match_candidates,
    recruit_permission_context,
    rerun_candidate_screening,
    update_candidate_profile,
    update_candidate_stage,
    update_job,
)
from app.services.resume_lab_service import (
    create_resume_draft,
    delete_resume_draft,
    get_resume_draft,
    list_resume_drafts,
    run_resume_chat,
    run_resume_score,
    storage_mode as resume_storage_mode,
    undo_resume_change,
    update_resume_draft,
)
from app.services.talent_screening_service import compile_resume_text, extract_resume_profile
from app.services.recruit_ai_usage import begin_ai_run, usage_summary
from app.services.recruit_settings_service import get_ai_settings, list_ai_usage, saved_models, update_ai_settings

router = APIRouter(prefix="/recruit", tags=["recruit"])
_RESUME_QUALITY_REVIEW_MESSAGE = "简历文字质量未通过校验，请核对并手动补充简历正文后重试。"
logger = logging.getLogger(__name__)
_MODEL_ID_RE = re.compile(r"^[\w.\-:/@]{1,128}$")


async def _begin_ai_run(session: AsyncSession, permission_context: dict[str, Any]) -> None:
    try:
        models = await saved_models(session, permission_context)
    except Exception:
        # Missing settings must never block an analysis; env defaults still apply.
        logger.warning("recruit settings unavailable, using env model defaults", exc_info=True)
        await session.rollback()
        models = {}
    begin_ai_run(models)


def _model_override(model: str | None) -> str | None:
    value = (model or "").strip()
    if value and not _MODEL_ID_RE.match(value):
        raise HTTPException(status_code=422, detail="model_invalid")
    return value or None


def _raise_recruit_error(exc: Exception) -> None:
    message = str(exc)
    if isinstance(exc, PermissionError):
        status = 403
    elif message.endswith("_not_found"):
        status = 404
    elif message.endswith(("_duplicate", "_busy")):
        status = 409
    elif message.endswith("_required"):
        status = 422
    else:
        status = 400
    raise HTTPException(status_code=status, detail=message)


async def _parsed_upload(
    file: UploadFile | None,
    *,
    allow_ocr: bool = True,
) -> tuple[dict[str, Any] | None, str, str, str, Any]:
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
            parsed_document = await extract_resume_document(
                staged.path,
                mime_type=staged.mime_type,
                filename=staged.safe_filename,
                allow_ocr=allow_ocr,
            )
        except UnsupportedDocumentTypeError as exc:
            staged.path.unlink(missing_ok=True)
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        except DocumentParseError as exc:
            staged.path.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return parsed_document, source_name, source_mime_type, source_hash, staged


@router.get("/dashboard")
async def get_dashboard(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers))
    return await dashboard_summary(session, permission_context)


@router.get("/models")
async def get_models(request: Request, session: AsyncSession = Depends(get_session)):
    permission_context = recruit_permission_context(dict(request.headers))
    catalog = await list_available_models()
    saved = await saved_models(session, permission_context)
    return {**catalog, "default": saved.get("screening") or catalog["default"]}


@router.get("/settings")
async def get_settings(request: Request, session: AsyncSession = Depends(get_session)):
    permission_context = recruit_permission_context(dict(request.headers))
    return await get_ai_settings(session, permission_context)


@router.put("/settings")
async def put_settings(request: Request, session: AsyncSession = Depends(get_session)):
    body = await request.json()
    permission_context = recruit_permission_context(dict(request.headers), body)
    try:
        return await update_ai_settings(session, permission_context, body)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)


@router.get("/usage")
async def get_usage(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers))
    return await list_ai_usage(session, permission_context, limit=limit)


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


@router.post("/jobs/default-ai")
async def post_default_ai_job(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    permission_context = recruit_permission_context(dict(request.headers))
    try:
        return await ensure_default_ai_job(session, permission_context)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)


@router.post("/resume-preview")
async def post_resume_preview(
    request: Request,
    file: UploadFile = File(...),
):
    parsed_document, source_name, source_mime_type, source_hash, staged = await _parsed_upload(file)
    try:
        parsed_document = resolve_resume_document(parsed_document)
        if parsed_document is None:
            raise HTTPException(status_code=422, detail=_RESUME_QUALITY_REVIEW_MESSAGE)
        parsed_text = compile_resume_text(parsed_document)
        extraction = (parsed_document or {}).get("metadata", {}).get("extraction") or {}
        if not parsed_text:
            warnings = extraction.get("warnings") or []
            raise HTTPException(status_code=422, detail=warnings[-1] if warnings else "resume_text_required")
        return {
            "filename": source_name,
            "mime_type": source_mime_type,
            "content_hash": source_hash,
            "profile": extract_resume_profile(parsed_text),
            "parsed_text": parsed_text,
            "processing_status": (parsed_document or {}).get("metadata", {}).get("processing_status", "parsed"),
            "extraction": extraction,
        }
    finally:
        if staged is not None and staged.path.exists():
            staged.path.unlink(missing_ok=True)


@router.post("/jd-preview")
async def post_jd_preview(request: Request, file: UploadFile = File(...)):
    recruit_permission_context(dict(request.headers))
    parsed_document, _, _, _, staged = await _parsed_upload(file)
    try:
        parsed_text = compile_resume_text(parsed_document)
        if not parsed_text:
            raise HTTPException(status_code=422, detail="jd_text_required")
        return {"parsed_text": parsed_text}
    finally:
        if staged is not None and staged.path.exists():
            staged.path.unlink(missing_ok=True)


@router.post("/workbench")
async def post_screening_workbench(
    request: Request,
    file: UploadFile | None = File(default=None),
    jd_title: str = Form(...),
    jd_text: str = Form(...),
    candidate_name: str = Form(...),
    email: str | None = Form(default=None),
    source_channel: str | None = Form(default=None),
    resume_text: str | None = Form(default=None),
    priority: str | None = Form(default=None),
    rubric_json: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
):
    body = {
        "jd_title": jd_title,
        "jd_text": jd_text,
        "candidate_name": candidate_name,
        "email": email,
        "source_channel": source_channel,
        "resume_text": resume_text,
        "priority": priority,
        "rubric_json": rubric_json,
    }
    permission_context = recruit_permission_context(dict(request.headers), body)
    await _begin_ai_run(session, permission_context)
    parsed_document, source_name, source_mime_type, source_hash, staged = await _parsed_upload(file, allow_ocr=True)
    try:
        if staged is not None:
            parsed_document = resolve_resume_document(parsed_document, resume_text)
            if parsed_document is None:
                raise HTTPException(status_code=422, detail=_RESUME_QUALITY_REVIEW_MESSAGE)
        return await create_screening_workflow(
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


@router.post("/matches")
async def post_matches(request: Request, session: AsyncSession = Depends(get_session)):
    body = await request.json()
    permission_context = recruit_permission_context(dict(request.headers), body)
    try:
        return await match_candidates(session, permission_context, body)
    except (PermissionError, ValueError) as exc:
        _raise_recruit_error(exc)


@router.get("/search-conversations")
async def get_search_conversations(request: Request, session: AsyncSession = Depends(get_session)):
    context = permission_context_from_identity(require_request_identity(request))
    return await list_search_conversations(session, context)


@router.get("/search-conversations/{conversation_id}")
async def get_search_conversation_route(
    conversation_id: str, request: Request, session: AsyncSession = Depends(get_session),
):
    context = permission_context_from_identity(require_request_identity(request))
    try:
        return await get_search_conversation(session, context, conversation_id)
    except ValueError as exc:
        _raise_recruit_error(exc)


@router.get("/search-conversations/{conversation_id}/events")
async def stream_search_conversation_events(
    conversation_id: str,
    request: Request,
    last_event_id: int = Header(default=0, alias="Last-Event-ID"),
    session: AsyncSession = Depends(get_session),
):
    context = permission_context_from_identity(require_request_identity(request))
    try:
        await get_search_conversation(session, context, conversation_id)
    except ValueError as exc:
        _raise_recruit_error(exc)

    async def events():
        cursor = max(0, last_event_id)
        heartbeat_at = asyncio.get_running_loop().time() + 15
        while not await request.is_disconnected():
            batch, status = await get_search_event_batch(conversation_id, context, cursor)
            for event in batch:
                cursor = int(event["id"])
                yield f"id: {cursor}\nevent: progress\ndata: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
            if status not in ("analyzing", "matching") and not batch:
                break
            now = asyncio.get_running_loop().time()
            if now >= heartbeat_at:
                yield ": keep-alive\n\n"
                heartbeat_at = now + 15
            await asyncio.sleep(0.4)

    return _sse_response(events())


@router.post("/search-conversations", status_code=202)
async def post_search_conversation(
    request: Request, background_tasks: BackgroundTasks, session: AsyncSession = Depends(get_session),
):
    context = permission_context_from_identity(require_request_identity(request))
    try:
        conversation = await create_search_conversation(session, context, await request.json())
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)
    background_tasks.add_task(run_search_conversation, conversation["id"], context, conversation["revision"])
    return conversation


@router.post("/search-conversations/{conversation_id}/turns", status_code=202)
async def post_search_turn(
    conversation_id: str, request: Request, background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    context = permission_context_from_identity(require_request_identity(request))
    try:
        conversation = await append_search_turn(session, context, conversation_id, await request.json())
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)
    background_tasks.add_task(run_search_conversation, conversation["id"], context, conversation["revision"])
    return conversation


@router.post("/search-conversations/{conversation_id}/retry", status_code=202)
async def post_search_retry(
    conversation_id: str, request: Request, background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    context = permission_context_from_identity(require_request_identity(request))
    try:
        conversation = await retry_search_turn(session, context, conversation_id, await request.json())
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)
    background_tasks.add_task(run_search_conversation, conversation["id"], context, conversation["revision"])
    return conversation


def _identity_context(request: Request) -> dict[str, Any]:
    return permission_context_from_identity(require_request_identity(request))


@router.get("/resume-drafts")
async def get_resume_drafts(request: Request, session: AsyncSession = Depends(get_session)):
    context = _identity_context(request)
    return {"drafts": await list_resume_drafts(session, context), "storage": resume_storage_mode(context)}


@router.get("/resume-drafts/config")
async def get_resume_drafts_config(request: Request):
    return {"storage": resume_storage_mode(_identity_context(request))}


@router.post("/resume-drafts")
async def post_resume_draft(request: Request, session: AsyncSession = Depends(get_session)):
    body = await request.json()
    context = _identity_context(request)
    model_id = _model_override(body.get("model"))
    await _begin_ai_run(session, context)
    try:
        return await create_resume_draft(session, context, body, model=model_id)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)


@router.get("/resume-drafts/{draft_id}")
async def get_resume_draft_route(draft_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    try:
        return await get_resume_draft(session, _identity_context(request), draft_id)
    except (PermissionError, ValueError) as exc:
        _raise_recruit_error(exc)


@router.patch("/resume-drafts/{draft_id}")
async def patch_resume_draft(draft_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    try:
        return await update_resume_draft(session, _identity_context(request), draft_id, await request.json())
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)


@router.delete("/resume-drafts/{draft_id}", status_code=204)
async def delete_resume_draft_route(draft_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    try:
        await delete_resume_draft(session, _identity_context(request), draft_id)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)
    return Response(status_code=204)


@router.post("/resume-drafts/{draft_id}/undo")
async def post_resume_draft_undo(draft_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    body = await request.json()
    try:
        return await undo_resume_change(session, _identity_context(request), draft_id, str(body.get("message_id") or ""))
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)


def _resume_lab_stream(session: AsyncSession, context: dict[str, Any], work, label: str) -> StreamingResponse:
    async def events():
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

        async def progress(event: dict[str, Any]) -> None:
            await queue.put(event)

        async def run() -> None:
            try:
                await _begin_ai_run(session, context)
                draft = await work(progress)
                await progress({"type": "done", "draft": draft, "usage": usage_summary()})
            except (PermissionError, ValueError) as exc:
                await session.rollback()
                await progress({"type": "error", "message": str(exc)})
            except Exception:
                await session.rollback()
                logger.exception("resume lab %s failed", label)
                await progress({"type": "error", "message": f"{label}_failed"})
            finally:
                await queue.put(None)

        async for frame in _drain_sse(queue, run):
            yield frame

    return _sse_response(events())


@router.post("/resume-drafts/{draft_id}/chat/stream")
async def post_resume_draft_chat(draft_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    body = await request.json()
    context = _identity_context(request)
    model_id = _model_override(body.get("model"))
    return _resume_lab_stream(
        session, context,
        lambda progress: run_resume_chat(session, context, draft_id, body, model=model_id, progress=progress),
        "resume_chat",
    )


@router.post("/resume-drafts/{draft_id}/score/stream")
async def post_resume_draft_score(draft_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    body = await request.json()
    context = _identity_context(request)
    model_id = _model_override(body.get("model"))
    return _resume_lab_stream(
        session, context,
        lambda progress: run_resume_score(session, context, draft_id, body, model=model_id, progress=progress),
        "resume_score",
    )


@router.post("/candidates")
async def post_candidate(
    request: Request,
    file: UploadFile | None = File(default=None),
    job_id: str = Form(...),
    full_name: str | None = Form(default=None),
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
    model: str | None = Form(default=None),
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
    model_id = _model_override(model)
    permission_context = recruit_permission_context(dict(request.headers), body)
    await _begin_ai_run(session, permission_context)
    parsed_document, source_name, source_mime_type, source_hash, staged = await _parsed_upload(file, allow_ocr=True)
    try:
        if staged is not None:
            parsed_document = resolve_resume_document(parsed_document, resume_text)
            if parsed_document is None:
                raise HTTPException(status_code=422, detail=_RESUME_QUALITY_REVIEW_MESSAGE)
        return await create_candidate(
            session,
            permission_context,
            body=body,
            parsed_document=parsed_document,
            source_name=source_name,
            source_mime_type=source_mime_type,
            source_hash=source_hash,
            model=model_id,
        )
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)
    finally:
        if staged is not None and staged.path.exists():
            staged.path.unlink(missing_ok=True)


@router.post("/candidates/stream")
async def post_candidate_stream(
    request: Request,
    file: UploadFile | None = File(default=None),
    job_id: str = Form(...),
    full_name: str | None = Form(default=None),
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
    model: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Same as POST /candidates, but streams parse / tool / LLM-token / score progress as SSE."""

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
    model_id = _model_override(model)
    permission_context = recruit_permission_context(dict(request.headers), body)
    staged = None
    if file is not None and file.filename:
        try:
            staged = await stage_material_upload(file)
        except MaterialValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc

    async def events():
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

        async def progress(event: dict[str, Any]) -> None:
            await queue.put(event)

        async def run() -> None:
            try:
                await _begin_ai_run(session, permission_context)
                parsed_document = await _stream_parse(staged, resume_text, progress)
                candidate = await create_candidate(
                    session,
                    permission_context,
                    body=body,
                    parsed_document=parsed_document,
                    source_name=staged.safe_filename if staged else "",
                    source_mime_type=staged.mime_type if staged else "",
                    source_hash=staged.content_hash if staged else "",
                    model=model_id,
                    progress=progress,
                )
                await progress({"type": "step", "key": "save", "status": "done", "label": "候选人已保存"})
                await progress({"type": "done", "candidate": candidate, "usage": usage_summary()})
            except (UnsupportedDocumentTypeError, DocumentParseError, PermissionError, ValueError) as exc:
                await session.rollback()
                await progress({"type": "error", "message": str(exc)})
            except Exception:
                await session.rollback()
                logger.exception("recruit candidate stream failed")
                await progress({"type": "error", "message": "screening_failed"})
            finally:
                if staged is not None and staged.path.exists():
                    staged.path.unlink(missing_ok=True)
                await queue.put(None)

        async for frame in _drain_sse(queue, run):
            yield frame

    return _sse_response(events())


async def _stream_parse(staged, resume_text: str | None, progress) -> dict[str, Any] | None:
    if staged is None:
        return None
    await progress({"type": "step", "key": "parse", "status": "running", "label": f"解析简历 {staged.safe_filename}"})
    parsed_document = await extract_resume_document(
        staged.path,
        mime_type=staged.mime_type,
        filename=staged.safe_filename,
        allow_ocr=True,
    )
    parsed_document = resolve_resume_document(parsed_document, resume_text)
    if parsed_document is None:
        raise ValueError(_RESUME_QUALITY_REVIEW_MESSAGE)
    extraction = (parsed_document or {}).get("metadata", {}).get("extraction") or {}
    await progress({
        "type": "step", "key": "parse", "status": "done",
        "label": f"简历解析完成 · {extraction.get('method') or 'text'} · {extraction.get('char_count') or 0} 字",
    })
    return parsed_document


async def _drain_sse(queue: asyncio.Queue, run):
    task = asyncio.create_task(run())
    try:
        while (event := await queue.get()) is not None:
            yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
    finally:
        if not task.done():
            task.cancel()


def _sse_response(events) -> StreamingResponse:
    return StreamingResponse(
        events,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


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


@router.patch("/candidates/{candidate_id}")
async def patch_candidate(
    candidate_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    body = await request.json()
    permission_context = recruit_permission_context(dict(request.headers), body)
    try:
        return await update_candidate_profile(session, permission_context, candidate_id, body)
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)


@router.post("/candidates/{candidate_id}/screenings")
async def post_candidate_screening(
    candidate_id: str,
    request: Request,
    file: UploadFile | None = File(default=None),
    resume_text: str | None = Form(default=None),
    model: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
):
    model_id = _model_override(model)
    permission_context = recruit_permission_context(dict(request.headers), {"resume_text": resume_text})
    await _begin_ai_run(session, permission_context)
    parsed_document, source_name, source_mime_type, source_hash, staged = await _parsed_upload(file, allow_ocr=True)
    try:
        if staged is not None:
            parsed_document = resolve_resume_document(parsed_document, resume_text)
            if parsed_document is None:
                raise HTTPException(status_code=422, detail=_RESUME_QUALITY_REVIEW_MESSAGE)
        return await rerun_candidate_screening(
            session,
            permission_context,
            candidate_id,
            parsed_document=parsed_document,
            resume_text_override=resume_text,
            source_name=source_name,
            source_mime_type=source_mime_type,
            source_hash=source_hash,
            model=model_id,
        )
    except (PermissionError, ValueError) as exc:
        await session.rollback()
        _raise_recruit_error(exc)
    finally:
        if staged is not None and staged.path.exists():
            staged.path.unlink(missing_ok=True)


@router.post("/candidates/{candidate_id}/screenings/stream")
async def post_candidate_screening_stream(
    candidate_id: str,
    request: Request,
    file: UploadFile | None = File(default=None),
    resume_text: str | None = Form(default=None),
    model: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Same as POST /candidates/{id}/screenings, streamed as SSE."""

    model_id = _model_override(model)
    permission_context = recruit_permission_context(dict(request.headers), {"resume_text": resume_text})
    staged = None
    if file is not None and file.filename:
        try:
            staged = await stage_material_upload(file)
        except MaterialValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc

    async def events():
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

        async def progress(event: dict[str, Any]) -> None:
            await queue.put(event)

        async def run() -> None:
            try:
                await _begin_ai_run(session, permission_context)
                parsed_document = await _stream_parse(staged, resume_text, progress)
                screening = await rerun_candidate_screening(
                    session,
                    permission_context,
                    candidate_id,
                    parsed_document=parsed_document,
                    resume_text_override=resume_text,
                    source_name=staged.safe_filename if staged else "",
                    source_mime_type=staged.mime_type if staged else "",
                    source_hash=staged.content_hash if staged else "",
                    model=model_id,
                    progress=progress,
                )
                await progress({"type": "step", "key": "save", "status": "done", "label": "评分已保存"})
                await progress({"type": "done", "screening": screening, "usage": usage_summary()})
            except (UnsupportedDocumentTypeError, DocumentParseError, PermissionError, ValueError) as exc:
                await session.rollback()
                await progress({"type": "error", "message": str(exc)})
            except Exception:
                await session.rollback()
                logger.exception("recruit screening stream failed")
                await progress({"type": "error", "message": "screening_failed"})
            finally:
                if staged is not None and staged.path.exists():
                    staged.path.unlink(missing_ok=True)
                await queue.put(None)

        async for frame in _drain_sse(queue, run):
            yield frame

    return _sse_response(events())


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


@router.post("/reports/pdf")
async def post_report_pdf(request: Request):
    require_request_identity(request)
    raw = await request.body()
    if len(raw) > MAX_HTML_BYTES:
        raise HTTPException(status_code=413, detail="report_too_large")
    try:
        body = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="html_required") from exc
    html = body.get("html") if isinstance(body, dict) else None
    if not isinstance(html, str) or not html.strip():
        raise HTTPException(status_code=422, detail="html_required")
    filename = str(body.get("filename") or "report.pdf")
    filename = re.sub(r'[\\/:*?"<>|\r\n]+', "_", filename)[:120] or "report.pdf"
    try:
        pdf = await render_html_to_pdf(html)
    except Exception as exc:
        logger.exception("report pdf render failed")
        raise HTTPException(status_code=500, detail="pdf_render_failed") from exc
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=\"report.pdf\"; filename*=UTF-8''{quote(filename)}"},
    )
