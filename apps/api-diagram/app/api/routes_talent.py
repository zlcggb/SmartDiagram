"""Recruiting demo routes backed by the existing AI configuration."""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.services.file_parser_service import (
    DocumentParseError,
    UnsupportedDocumentTypeError,
    parse_file,
)
from app.services.material_gateway_service import MaterialValidationError, stage_material_upload
from app.services.permission_service import build_permission_context
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


@router.post("/screen")
async def screen_resume(
    request: Request,
    file: UploadFile | None = File(default=None),
    jd_text: str = Form(...),
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
                parsed_document = parse_file(
                    staged.path,
                    mime_type=staged.mime_type,
                    filename=staged.safe_filename,
                )
            except UnsupportedDocumentTypeError as exc:
                raise HTTPException(status_code=415, detail=str(exc)) from exc
            except DocumentParseError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        combined_resume_text = compile_resume_text(parsed_document, resume_text)
        if not combined_resume_text:
            raise HTTPException(status_code=422, detail="resume_text_required")

        result = await screen_candidate_profile(
            candidate_name=normalize_text(candidate_name) or "候选人",
            jd_text=normalized_jd,
            resume_text=combined_resume_text,
            source_name=source_name,
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
