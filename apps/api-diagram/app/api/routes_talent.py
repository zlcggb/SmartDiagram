"""Recruiting demo routes backed by the existing AI configuration."""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.services.file_parser_service import (
    DocumentParseError,
    UnsupportedDocumentTypeError,
)
from app.services.material_gateway_service import MaterialValidationError, stage_material_upload
from app.services.permission_service import build_permission_context
from app.services.resume_extraction_service import extract_resume_document
from app.services.talent_rubric_service import generate_rubric, parse_rubric_json
from app.services.talent_screening_service import compile_resume_text, normalize_text, screen_candidate_profile

router = APIRouter(prefix="/talent", tags=["talent"])


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


@router.post("/rubric")
async def build_rubric(request: Request):
    """Turn a JD into a weighted, evidence-checkable scorecard (cached per JD)."""

    body = await request.json()
    build_permission_context(
        _permission_body(request, None, None, None, None, None, None)
    )
    jd_text = normalize_text(str(body.get("jd_text") or ""))
    if not jd_text:
        raise HTTPException(status_code=422, detail="jd_text_required")
    jd_title = normalize_text(str(body.get("jd_title") or ""))
    return await generate_rubric(jd_title, jd_text[:12_000], use_cache=not body.get("refresh"))


@router.post("/screen")
async def screen_resume(
    request: Request,
    file: UploadFile | None = File(default=None),
    jd_text: str = Form(...),
    jd_title: str | None = Form(default=None),
    rubric_json: str | None = Form(default=None),
    resume_text: str | None = Form(default=None),
    candidate_name: str | None = Form(default=None),
    channel: str | None = Form(default=None),
    tenant_id: str | None = Form(default=None),
    user_id: str | None = Form(default=None),
    team_id: str | None = Form(default=None),
    project_id: str | None = Form(default=None),
    roles: str | None = Form(default=None),
    scopes: str | None = Form(default=None),
):
    """Score a candidate resume against a JD using the existing LLM setup."""

    build_permission_context(
        _permission_body(request, tenant_id, user_id, team_id, project_id, roles, scopes)
    )

    normalized_jd = normalize_text(jd_text)
    if not normalized_jd:
        raise HTTPException(status_code=422, detail="jd_text_required")

    staged = None
    parsed_document = None
    source_name = ""

    try:
        if file is not None and file.filename:
            try:
                staged = await stage_material_upload(file)
            except MaterialValidationError as exc:
                raise HTTPException(
                    status_code=exc.status_code,
                    detail={"code": exc.code, "message": exc.message},
                ) from exc

            source_name = staged.safe_filename
            try:
                parsed_document = await extract_resume_document(
                    staged.path,
                    mime_type=staged.mime_type,
                    filename=staged.safe_filename,
                    allow_ocr=not normalize_text(resume_text),
                )
            except UnsupportedDocumentTypeError as exc:
                raise HTTPException(status_code=415, detail=str(exc)) from exc
            except DocumentParseError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        combined_resume_text = compile_resume_text(parsed_document, resume_text)
        if not combined_resume_text:
            raise HTTPException(status_code=422, detail="resume_text_required")

        normalized_title = normalize_text(jd_title)
        extraction = ((parsed_document or {}).get("metadata") or {}).get("extraction") or {}
        if extraction.get("method") in (None, "none"):
            extraction = {"method": "manual", "char_count": len(combined_resume_text), "ocr_pages": [], "warnings": []}
        result = await screen_candidate_profile(
            candidate_name=normalize_text(candidate_name) or "候选人",
            jd_text=normalized_jd,
            resume_text=combined_resume_text,
            source_name=source_name,
            rubric=parse_rubric_json(rubric_json, jd_title=normalized_title, jd_text=normalized_jd),
            jd_title=normalized_title,
            extraction=extraction,
        )
        return {
            **result,
            "channel": normalize_text(channel),
            "resume_filename": source_name,
            "parsed_blocks": len((parsed_document or {}).get("blocks") or []),
        }
    finally:
        if staged is not None and staged.path.exists():
            staged.path.unlink(missing_ok=True)
