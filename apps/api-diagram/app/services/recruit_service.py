"""Recruiting / ATS service layer."""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any

from sqlalchemy import delete, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.common import utc_now
from app.models.recruit import (
    RecruitActivity,
    RecruitCandidate,
    RecruitInterview,
    RecruitInterviewQuestionSet,
    RecruitJob,
    RecruitMetric,
    RecruitResume,
    RecruitScreeningResult,
)
from app.services.access_control_service import can_access_project, ensure_project_membership, ensure_team_membership
from app.services.audit_service import ensure_principals
from app.services.permission_service import build_permission_context
from app.services.talent_screening_service import (
    build_fallback_screening,
    compile_resume_text,
    extract_resume_profile,
    normalize_text,
    screen_candidate_profile,
)

DEFAULT_STAGE_CONFIG = [
    {"key": "applied", "label": "待筛选"},
    {"key": "screening", "label": "AI 初筛"},
    {"key": "interview", "label": "初试"},
    {"key": "final", "label": "复试 / 终试"},
    {"key": "offer", "label": "Offer"},
    {"key": "talent_pool", "label": "入池"},
    {"key": "rejected", "label": "淘汰"},
]

DEFAULT_AI_JOB_TITLE = "AI 应用产品工程师（业务系统方向）"
DEFAULT_AI_JOB_DESCRIPTION = (
    "招聘能够使用 React、TypeScript、Python、AI agent、RAG 和自动化工作流，"
    "完成真实业务系统交付的人才。"
)
DEFAULT_AI_JOB_BODY = {
    "title": DEFAULT_AI_JOB_TITLE,
    "department": "AI 人才招聘",
    "status": "open",
    "priority": "high",
    "description": DEFAULT_AI_JOB_DESCRIPTION,
    "requirements": (
        "熟悉前端或全栈开发；会使用 AI 编程工具、Agent、RAG 或自动化工作流；"
        "有 CRM、销售、客服、运营或生产系统交付经验优先。"
    ),
    "tags": "AI,AI人才,业务系统",
}


def _context_value(permission_context: dict[str, Any], key: str) -> str | None:
    value = permission_context.get(key)
    if value in (None, ""):
        return None
    return str(value)


def _current_user_id(permission_context: dict[str, Any]) -> str | None:
    if permission_context.get("principal_kind") == "guest":
        return None
    return _context_value(permission_context, "user_id")


def _tags(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        source = value
    else:
        source = str(value).split(",")
    result: list[str] = []
    for item in source:
        text = normalize_text(str(item))
        if text and text not in result:
            result.append(text)
    return result


def _body_text(primary: str | None, secondary: str | None = None) -> str:
    first = normalize_text(primary)
    second = normalize_text(secondary)
    if first and second and first != second:
        return f"{first}\n\n{second}"
    return first or second


async def _ensure_write_access(session: AsyncSession, permission_context: dict[str, Any], project_id: str | None) -> None:
    await ensure_principals(session, permission_context, None)
    if project_id:
        await ensure_project_membership(session, permission_context, project_id=project_id)
    if permission_context.get("team_id"):
        await ensure_team_membership(session, permission_context)


async def _ensure_read_access(session: AsyncSession, permission_context: dict[str, Any], project_id: str | None) -> None:
    if project_id and not await can_access_project(session, permission_context, project_id, "project:read"):
        raise PermissionError("project_access_denied")


async def _get_job(session: AsyncSession, permission_context: dict[str, Any], job_id: str) -> RecruitJob:
    job = await session.get(RecruitJob, job_id)
    if not job or job.tenant_id != permission_context["tenant_id"]:
        raise ValueError("job_not_found")
    await _ensure_read_access(session, permission_context, job.project_id)
    return job


async def _get_candidate(session: AsyncSession, permission_context: dict[str, Any], candidate_id: str) -> RecruitCandidate:
    candidate = await session.get(RecruitCandidate, candidate_id)
    if not candidate or candidate.tenant_id != permission_context["tenant_id"]:
        raise ValueError("candidate_not_found")
    await _ensure_read_access(session, permission_context, candidate.project_id)
    return candidate


async def _latest_screenings_map(
    session: AsyncSession,
    tenant_id: str,
    candidate_ids: list[str],
) -> dict[str, RecruitScreeningResult]:
    if not candidate_ids:
        return {}
    statement = (
        select(RecruitScreeningResult)
        .where(
            RecruitScreeningResult.tenant_id == tenant_id,
            RecruitScreeningResult.candidate_id.in_(candidate_ids),
        )
        .order_by(desc(RecruitScreeningResult.created_at))
    )
    results = (await session.execute(statement)).scalars().all()
    latest: dict[str, RecruitScreeningResult] = {}
    for item in results:
        latest.setdefault(item.candidate_id, item)
    return latest


async def _latest_resume_profiles_map(
    session: AsyncSession,
    tenant_id: str,
    candidate_ids: list[str],
) -> dict[str, dict[str, Any]]:
    if not candidate_ids:
        return {}
    statement = (
        select(RecruitResume)
        .where(
            RecruitResume.tenant_id == tenant_id,
            RecruitResume.candidate_id.in_(candidate_ids),
        )
        .order_by(desc(RecruitResume.created_at))
    )
    rows = (await session.execute(statement)).scalars().all()
    profiles: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.candidate_id in profiles:
            continue
        profile = row.profile_json or (
            extract_resume_profile(row.parsed_text) if row.parsed_text else {}
        )
        if isinstance(profile, dict):
            profiles[row.candidate_id] = profile
    return profiles


async def _question_sets_map(
    session: AsyncSession,
    tenant_id: str,
    candidate_ids: list[str],
) -> dict[str, list[RecruitInterviewQuestionSet]]:
    if not candidate_ids:
        return {}
    statement = (
        select(RecruitInterviewQuestionSet)
        .where(
            RecruitInterviewQuestionSet.tenant_id == tenant_id,
            RecruitInterviewQuestionSet.candidate_id.in_(candidate_ids),
        )
        .order_by(desc(RecruitInterviewQuestionSet.created_at))
    )
    rows = (await session.execute(statement)).scalars().all()
    grouped: dict[str, list[RecruitInterviewQuestionSet]] = {}
    for row in rows:
        grouped.setdefault(row.candidate_id, []).append(row)
    return grouped


def serialize_job(job: RecruitJob, *, candidate_count: int = 0) -> dict[str, Any]:
    return {
        "job_id": job.id,
        "title": job.title,
        "department": job.department,
        "location": job.location,
        "employment_type": job.employment_type,
        "status": job.status,
        "hiring_manager": job.hiring_manager,
        "recruiter": job.recruiter,
        "priority": job.priority,
        "headcount": job.headcount,
        "description": job.description,
        "requirements": job.requirements,
        "stage_config": job.stage_config_json or DEFAULT_STAGE_CONFIG,
        "tags": job.tags_json or [],
        "candidate_count": candidate_count,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
    }


def serialize_screening(row: RecruitScreeningResult | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "screening_id": row.id,
        "total_score": row.total_score,
        "max_score": row.max_score,
        "score_version": row.score_version,
        "score_breakdown": {
            "keyword_match": row.keyword_match_score,
            "skills_coverage": row.skills_coverage_score,
            "section_completeness": row.section_completeness_score,
        },
        "recommendation": row.recommendation,
        "evaluation_mode": row.evaluation_mode,
        "overall_summary": row.overall_summary,
        "matched_signals": row.matched_signals_json or [],
        "matched_keywords": row.matched_keywords_json or [],
        "missing_keywords": row.missing_keywords_json or [],
        "recommendations": row.recommendations_json or [],
        "strengths": row.strengths_json or [],
        "risks": row.risks_json or [],
        "interview_questions": row.interview_questions_json or [],
        "dimension_scores": row.dimension_scores_json or [],
        "score_report": row.report_json or (row.raw_result_json or {}).get("score_report") or {},
        "evidence_excerpt": row.evidence_excerpt,
        "created_at": row.created_at.isoformat(),
    }


def serialize_interview(row: RecruitInterview) -> dict[str, Any]:
    return {
        "interview_id": row.id,
        "interview_type": row.interview_type,
        "stage": row.stage,
        "interviewer": row.interviewer,
        "scheduled_at": row.scheduled_at.isoformat() if row.scheduled_at else None,
        "decision": row.decision,
        "score": row.score,
        "notes": row.notes,
        "summary": row.summary,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def _profile_summary(profile: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(profile, dict):
        return None

    def text(value: Any) -> str:
        return normalize_text(str(value or ""))

    def records(key: str, title_key: str, detail_key: str) -> list[dict[str, str]]:
        items = profile.get(key)
        if not isinstance(items, list):
            return []
        result: list[dict[str, str]] = []
        for item in items[:2]:
            if not isinstance(item, dict):
                continue
            title = text(item.get(title_key))
            detail = text(item.get(detail_key))
            years = text(item.get("years"))
            if title or detail or years:
                result.append({"title": title, "detail": detail, "years": years})
        return result

    education = records("education", "institution", "major")
    experience = records("experience", "company", "title")
    projects = records("projects", "name", "role")
    skills = [
        normalized
        for item in profile.get("skills", [])
        if (normalized := text(item))
    ] if isinstance(profile.get("skills"), list) else []

    headline = text(profile.get("headline"))
    if headline in {"个人简历", "简历", "个人资料"}:
        headline = ""
    summary = {
        "full_name": text(profile.get("full_name")),
        "headline": headline,
        "summary": text(profile.get("summary")),
        "education": education,
        "experience": experience,
        "projects": projects,
        "skills": list(dict.fromkeys(skills))[:6],
    }
    return summary if any(summary.values()) else None


def serialize_candidate(
    candidate: RecruitCandidate,
    *,
    job: RecruitJob | None = None,
    latest_screening: RecruitScreeningResult | None = None,
    interview_count: int = 0,
    profile_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "candidate_id": candidate.id,
        "job_id": candidate.job_id,
        "job_title": job.title if job else "",
        "full_name": candidate.full_name,
        "email": candidate.email,
        "phone": candidate.phone,
        "current_company": candidate.current_company,
        "location": candidate.location,
        "source_channel": candidate.source_channel,
        "status": candidate.status,
        "current_stage": candidate.current_stage,
        "ranking": candidate.ranking,
        "portfolio_url": candidate.portfolio_url,
        "linkedin_url": candidate.linkedin_url,
        "summary": candidate.summary,
        "notes": candidate.notes,
        "tags": candidate.tags_json or [],
        "profile_summary": _profile_summary(profile_summary),
        "latest_screening": serialize_screening(latest_screening),
        "interview_count": interview_count,
        "created_at": candidate.created_at.isoformat(),
        "updated_at": candidate.updated_at.isoformat(),
    }


async def _log_activity(
    session: AsyncSession,
    permission_context: dict[str, Any],
    *,
    activity_type: str,
    message: str,
    candidate_id: str | None = None,
    job_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    session.add(
        RecruitActivity(
            tenant_id=permission_context["tenant_id"],
            team_id=_context_value(permission_context, "team_id"),
            project_id=_context_value(permission_context, "project_id"),
            candidate_id=candidate_id,
            job_id=job_id,
            activity_type=activity_type,
            message=message,
            metadata_json=metadata or {},
            created_by=_current_user_id(permission_context),
        )
    )


async def list_jobs(session: AsyncSession, permission_context: dict[str, Any]) -> dict[str, Any]:
    statement = select(RecruitJob).where(RecruitJob.tenant_id == permission_context["tenant_id"]).order_by(desc(RecruitJob.updated_at))
    if permission_context.get("project_id"):
        statement = statement.where(RecruitJob.project_id == permission_context.get("project_id"))
    jobs = (await session.execute(statement)).scalars().all()
    counts = Counter()
    if jobs:
        count_rows = (
            await session.execute(
                select(RecruitCandidate.job_id).where(
                    RecruitCandidate.tenant_id == permission_context["tenant_id"],
                    RecruitCandidate.job_id.in_([job.id for job in jobs]),
                )
            )
        ).all()
        counts = Counter(row[0] for row in count_rows)
    return {"jobs": [serialize_job(job, candidate_count=counts.get(job.id, 0)) for job in jobs], "count": len(jobs)}


async def create_job(session: AsyncSession, permission_context: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    await _ensure_write_access(session, permission_context, _context_value(permission_context, "project_id"))
    job = _build_job(permission_context, body)
    session.add(job)
    await session.flush()
    await _log_activity(session, permission_context, activity_type="job.created", message=f"创建岗位：{job.title}", job_id=job.id)
    await session.commit()
    await session.refresh(job)
    return serialize_job(job)


async def ensure_default_ai_job(
    session: AsyncSession,
    permission_context: dict[str, Any],
) -> dict[str, Any]:
    """Provision one idempotent AI role for the simplified resume flow."""

    await _ensure_write_access(session, permission_context, _context_value(permission_context, "project_id"))
    statement = select(RecruitJob).where(
        RecruitJob.tenant_id == permission_context["tenant_id"],
        RecruitJob.title == DEFAULT_AI_JOB_TITLE,
    )
    existing = (await session.execute(statement)).scalars().first()
    if existing:
        return serialize_job(existing)

    job = _build_job(permission_context, DEFAULT_AI_JOB_BODY)
    session.add(job)
    await session.flush()
    await _log_activity(
        session,
        permission_context,
        activity_type="job.created",
        message=f"创建默认 AI 岗位：{job.title}",
        job_id=job.id,
        metadata={"provisioned": True},
    )
    await session.commit()
    await session.refresh(job)
    return serialize_job(job)


async def update_job(session: AsyncSession, permission_context: dict[str, Any], job_id: str, body: dict[str, Any]) -> dict[str, Any]:
    job = await _get_job(session, permission_context, job_id)
    await _ensure_write_access(session, permission_context, job.project_id)
    fields = [
        "title",
        "department",
        "location",
        "employment_type",
        "status",
        "hiring_manager",
        "recruiter",
        "priority",
        "description",
        "requirements",
    ]
    for field in fields:
        if field in body:
            setattr(job, field, normalize_text(str(body.get(field) or "")))
    if "headcount" in body:
        job.headcount = max(1, int(body.get("headcount") or 1))
    if "tags" in body:
        job.tags_json = _tags(body.get("tags"))
    if "stage_config" in body and isinstance(body.get("stage_config"), list):
        job.stage_config_json = body["stage_config"]
    job.updated_at = utc_now()
    await _log_activity(session, permission_context, activity_type="job.updated", message=f"更新岗位：{job.title}", job_id=job.id)
    await session.commit()
    await session.refresh(job)
    return serialize_job(job)


async def get_job_detail(session: AsyncSession, permission_context: dict[str, Any], job_id: str) -> dict[str, Any]:
    job = await _get_job(session, permission_context, job_id)
    candidates_statement = (
        select(RecruitCandidate)
        .where(RecruitCandidate.tenant_id == permission_context["tenant_id"], RecruitCandidate.job_id == job_id)
        .order_by(desc(RecruitCandidate.updated_at))
    )
    candidates = (await session.execute(candidates_statement)).scalars().all()
    latest_map = await _latest_screenings_map(session, permission_context["tenant_id"], [candidate.id for candidate in candidates])
    profiles_map = await _latest_resume_profiles_map(session, permission_context["tenant_id"], [candidate.id for candidate in candidates])
    stage_counts = Counter(candidate.current_stage for candidate in candidates)
    return {
        "job": serialize_job(job, candidate_count=len(candidates)),
        "pipeline": [{"stage": stage["key"], "label": stage["label"], "count": stage_counts.get(stage["key"], 0)} for stage in (job.stage_config_json or DEFAULT_STAGE_CONFIG)],
        "candidates": [
            serialize_candidate(
                candidate,
                job=job,
                latest_screening=latest_map.get(candidate.id),
                profile_summary=profiles_map.get(candidate.id),
            )
            for candidate in candidates[:8]
        ],
    }


async def list_candidates(
    session: AsyncSession,
    permission_context: dict[str, Any],
    *,
    job_id: str | None = None,
    stage: str | None = None,
    query: str | None = None,
) -> dict[str, Any]:
    statement = select(RecruitCandidate).where(RecruitCandidate.tenant_id == permission_context["tenant_id"]).order_by(desc(RecruitCandidate.updated_at))
    if permission_context.get("project_id"):
        statement = statement.where(RecruitCandidate.project_id == permission_context.get("project_id"))
    if job_id:
        statement = statement.where(RecruitCandidate.job_id == job_id)
    if stage:
        statement = statement.where(RecruitCandidate.current_stage == stage)
    if query:
        pattern = f"%{query.strip()}%"
        statement = statement.where(
            or_(
                RecruitCandidate.full_name.ilike(pattern),
                RecruitCandidate.email.ilike(pattern),
                RecruitCandidate.current_company.ilike(pattern),
            )
        )
    candidates = (await session.execute(statement)).scalars().all()
    job_ids = list(dict.fromkeys(candidate.job_id for candidate in candidates))
    jobs = {}
    if job_ids:
        jobs = {
            row.id: row
            for row in (await session.execute(select(RecruitJob).where(RecruitJob.id.in_(job_ids)))).scalars().all()
        }
    latest_map = await _latest_screenings_map(session, permission_context["tenant_id"], [candidate.id for candidate in candidates])
    profiles_map = await _latest_resume_profiles_map(session, permission_context["tenant_id"], [candidate.id for candidate in candidates])
    interview_rows = []
    if candidates:
        interview_rows = (
            await session.execute(
                select(RecruitInterview.candidate_id).where(
                    RecruitInterview.tenant_id == permission_context["tenant_id"],
                    RecruitInterview.candidate_id.in_([candidate.id for candidate in candidates]),
                )
            )
        ).all()
    interview_counts = Counter(row[0] for row in interview_rows)
    return {
        "candidates": [
            serialize_candidate(
                candidate,
                job=jobs.get(candidate.job_id),
                latest_screening=latest_map.get(candidate.id),
                interview_count=interview_counts.get(candidate.id, 0),
                profile_summary=profiles_map.get(candidate.id),
            )
            for candidate in candidates
        ],
        "count": len(candidates),
    }


async def _duplicate_candidate(
    session: AsyncSession,
    tenant_id: str,
    job_id: str,
    email: str,
) -> RecruitCandidate | None:
    if not email:
        return None
    statement = select(RecruitCandidate).where(
        RecruitCandidate.tenant_id == tenant_id,
        RecruitCandidate.job_id == job_id,
        RecruitCandidate.email == email,
    )
    return (await session.execute(statement)).scalar_one_or_none()


def _build_job(permission_context: dict[str, Any], body: dict[str, Any]) -> RecruitJob:
    now = utc_now()
    job = RecruitJob(
        tenant_id=permission_context["tenant_id"],
        team_id=_context_value(permission_context, "team_id"),
        project_id=_context_value(permission_context, "project_id"),
        title=normalize_text(str(body.get("title") or "")),
        department=normalize_text(str(body.get("department") or "")),
        location=normalize_text(str(body.get("location") or "")),
        employment_type=normalize_text(str(body.get("employment_type") or "full-time")) or "full-time",
        status=normalize_text(str(body.get("status") or "draft")) or "draft",
        hiring_manager=normalize_text(str(body.get("hiring_manager") or "")),
        recruiter=normalize_text(str(body.get("recruiter") or "")),
        priority=normalize_text(str(body.get("priority") or "medium")) or "medium",
        headcount=max(1, int(body.get("headcount") or 1)),
        description=normalize_text(str(body.get("description") or "")),
        requirements=normalize_text(str(body.get("requirements") or "")),
        stage_config_json=body.get("stage_config") or DEFAULT_STAGE_CONFIG,
        tags_json=_tags(body.get("tags")),
        metadata_json={"origin": "recruit-module"},
        created_by=_current_user_id(permission_context),
        created_at=now,
        updated_at=now,
    )
    if not job.title:
        raise ValueError("job_title_required")
    return job


def _build_candidate(
    permission_context: dict[str, Any],
    job: RecruitJob,
    body: dict[str, Any],
) -> RecruitCandidate:
    candidate = RecruitCandidate(
        tenant_id=permission_context["tenant_id"],
        team_id=_context_value(permission_context, "team_id"),
        project_id=job.project_id or _context_value(permission_context, "project_id"),
        job_id=job.id,
        full_name=normalize_text(str(body.get("full_name") or "")),
        email=normalize_text(str(body.get("email") or "")).lower(),
        phone=normalize_text(str(body.get("phone") or "")),
        current_company=normalize_text(str(body.get("current_company") or "")),
        location=normalize_text(str(body.get("location") or "")),
        source_channel=normalize_text(str(body.get("source_channel") or "manual")) or "manual",
        status=normalize_text(str(body.get("status") or "active")) or "active",
        current_stage=normalize_text(str(body.get("current_stage") or "applied")) or "applied",
        ranking=normalize_text(str(body.get("ranking") or "review")) or "review",
        portfolio_url=normalize_text(str(body.get("portfolio_url") or "")),
        linkedin_url=normalize_text(str(body.get("linkedin_url") or "")),
        summary=normalize_text(str(body.get("summary") or "")),
        notes=normalize_text(str(body.get("notes") or "")),
        tags_json=_tags(body.get("tags")),
        metadata_json={"origin": "recruit-module"},
        created_by=_current_user_id(permission_context),
    )
    if not candidate.full_name:
        raise ValueError("candidate_name_required")
    return candidate


async def _persist_screening(
    session: AsyncSession,
    permission_context: dict[str, Any],
    *,
    candidate: RecruitCandidate,
    job: RecruitJob,
    resume_text: str,
    screening_result: dict[str, Any] | None = None,
) -> RecruitScreeningResult:
    result = screening_result or await screen_candidate_profile(
        candidate_name=candidate.full_name,
        jd_text=_body_text(job.description, job.requirements),
        resume_text=resume_text,
    )
    score_breakdown = result.get("score_breakdown") or {}
    screening = RecruitScreeningResult(
        tenant_id=candidate.tenant_id,
        team_id=candidate.team_id,
        project_id=candidate.project_id,
        candidate_id=candidate.id,
        job_id=job.id,
        total_score=int(result.get("total_score") or 0),
        max_score=int(result.get("max_score") or 100),
        keyword_match_score=float(score_breakdown.get("keyword_match") or 0),
        skills_coverage_score=float(score_breakdown.get("skills_coverage") or 0),
        section_completeness_score=float(score_breakdown.get("section_completeness") or 0),
        score_version=normalize_text(str(result.get("score_version") or "evidence-v2")) or "evidence-v2",
        recommendation=normalize_text(str(result.get("recommendation") or "")),
        evaluation_mode=normalize_text(str(result.get("evaluation_mode") or "ai")) or "ai",
        overall_summary=normalize_text(str(result.get("overall_summary") or "")),
        matched_signals_json=result.get("matched_signals") or [],
        matched_keywords_json=result.get("matched_keywords") or [],
        missing_keywords_json=result.get("missing_keywords") or [],
        recommendations_json=result.get("recommendations") or [],
        strengths_json=result.get("strengths") or [],
        risks_json=result.get("risks") or [],
        interview_questions_json=result.get("interview_questions") or [],
        dimension_scores_json=result.get("dimension_scores") or [],
        report_json=result.get("score_report") or {},
        evidence_excerpt=normalize_text(str(result.get("evidence_excerpt") or "")),
        raw_result_json=result,
        created_by=_current_user_id(permission_context),
    )
    session.add(screening)
    await session.flush()
    if screening.interview_questions_json:
        session.add(
            RecruitInterviewQuestionSet(
                tenant_id=candidate.tenant_id,
                team_id=candidate.team_id,
                project_id=candidate.project_id,
                candidate_id=candidate.id,
                job_id=job.id,
                screening_result_id=screening.id,
                title=f"{candidate.full_name} 面试问题建议",
                questions_json=screening.interview_questions_json,
                source=screening.evaluation_mode,
                created_by=_current_user_id(permission_context),
            )
        )
    candidate.ranking = (
        "strong" if screening.total_score >= 85 else "medium" if screening.total_score >= 70 else "watch"
    )
    candidate.current_stage = "screening" if candidate.current_stage == "applied" else candidate.current_stage
    candidate.updated_at = utc_now()
    await _log_activity(
        session,
        permission_context,
        activity_type="candidate.screened",
        message=f"{candidate.full_name} 完成 AI 初筛",
        candidate_id=candidate.id,
        job_id=job.id,
        metadata={"score": screening.total_score, "recommendation": screening.recommendation},
    )
    return screening


async def create_candidate(
    session: AsyncSession,
    permission_context: dict[str, Any],
    *,
    body: dict[str, Any],
    parsed_document: dict[str, Any] | None = None,
    source_name: str = "",
    source_mime_type: str = "",
    source_hash: str = "",
) -> dict[str, Any]:
    job_id = normalize_text(str(body.get("job_id") or ""))
    if not job_id:
        raise ValueError("job_id_required")
    job = await _get_job(session, permission_context, job_id)
    await _ensure_write_access(session, permission_context, job.project_id)
    resume_text = compile_resume_text(parsed_document, body.get("resume_text"))
    extracted_profile = extract_resume_profile(resume_text) if resume_text else {}
    candidate_body = {
        **body,
        "full_name": normalize_text(str(body.get("full_name") or "")) or extracted_profile.get("full_name", ""),
        "email": normalize_text(str(body.get("email") or "")).lower() or extracted_profile.get("email", "").lower(),
        "phone": normalize_text(str(body.get("phone") or "")) or extracted_profile.get("phone", ""),
        "current_company": normalize_text(str(body.get("current_company") or "")) or extracted_profile.get("current_company", ""),
        "location": normalize_text(str(body.get("location") or "")) or extracted_profile.get("location", ""),
    }
    email = normalize_text(str(candidate_body.get("email") or "")).lower()
    duplicate = await _duplicate_candidate(session, permission_context["tenant_id"], job_id, email)
    if duplicate:
        raise ValueError("candidate_duplicate")

    candidate = _build_candidate(permission_context, job, candidate_body)
    session.add(candidate)
    await session.flush()

    if resume_text:
        session.add(
            RecruitResume(
                tenant_id=candidate.tenant_id,
                team_id=candidate.team_id,
                project_id=candidate.project_id,
                candidate_id=candidate.id,
                filename=source_name,
                mime_type=source_mime_type,
                content_hash=source_hash,
                route_mode=str((parsed_document or {}).get("metadata", {}).get("route_mode") or "text"),
                processing_status=str((parsed_document or {}).get("metadata", {}).get("processing_status") or "parsed"),
                parsed_text=resume_text,
                profile_json=extracted_profile,
                metadata_json=(parsed_document or {}).get("metadata") or {},
                created_by=_current_user_id(permission_context),
            )
        )
        screening = await _persist_screening(session, permission_context, candidate=candidate, job=job, resume_text=resume_text)
    else:
        screening = None

    await _log_activity(
        session,
        permission_context,
        activity_type="candidate.created",
        message=f"新增候选人：{candidate.full_name}",
        candidate_id=candidate.id,
        job_id=job.id,
        metadata={"source_channel": candidate.source_channel},
    )
    await session.commit()
    await session.refresh(candidate)
    return serialize_candidate(candidate, job=job, latest_screening=screening, interview_count=0)


async def create_screening_workflow(
    session: AsyncSession,
    permission_context: dict[str, Any],
    *,
    body: dict[str, Any],
    parsed_document: dict[str, Any] | None = None,
    source_name: str = "",
    source_mime_type: str = "",
    source_hash: str = "",
) -> dict[str, Any]:
    """Persist one JD + resume screening as a single database transaction."""

    await _ensure_write_access(session, permission_context, _context_value(permission_context, "project_id"))
    jd_text = normalize_text(str(body.get("jd_text") or ""))
    if not jd_text:
        raise ValueError("jd_text_required")

    job = _build_job(
        permission_context,
        {
            "title": body.get("jd_title"),
            "department": "AI 人才招聘",
            "status": "open",
            "priority": body.get("priority") or "medium",
            "description": jd_text,
            "requirements": jd_text,
            "tags": "AI,AI人才",
        },
    )
    session.add(job)
    await session.flush()

    resume_text = compile_resume_text(parsed_document, body.get("resume_text"))
    if not resume_text:
        raise ValueError("resume_text_required")
    extracted_profile = extract_resume_profile(resume_text)
    candidate = _build_candidate(
        permission_context,
        job,
        {
            "full_name": body.get("candidate_name") or extracted_profile.get("full_name") or "候选人",
            "email": body.get("email") or extracted_profile.get("email"),
            "phone": body.get("phone") or extracted_profile.get("phone"),
            "current_company": body.get("current_company") or extracted_profile.get("current_company"),
            "location": body.get("location") or extracted_profile.get("location"),
            "source_channel": body.get("source_channel"),
            "summary": body.get("summary") or extracted_profile.get("summary"),
            "notes": body.get("notes"),
            "tags": body.get("tags"),
            "resume_text": body.get("resume_text"),
        },
    )
    duplicate = await _duplicate_candidate(
        session,
        permission_context["tenant_id"],
        job.id,
        candidate.email,
    )
    if duplicate:
        raise ValueError("candidate_duplicate")
    session.add(candidate)
    await session.flush()

    session.add(
        RecruitResume(
            tenant_id=candidate.tenant_id,
            team_id=candidate.team_id,
            project_id=candidate.project_id,
            candidate_id=candidate.id,
            filename=source_name,
            mime_type=source_mime_type,
            content_hash=source_hash,
            route_mode=str((parsed_document or {}).get("metadata", {}).get("route_mode") or "text"),
            processing_status=str((parsed_document or {}).get("metadata", {}).get("processing_status") or "parsed"),
            parsed_text=resume_text,
            profile_json=extracted_profile,
            metadata_json=(parsed_document or {}).get("metadata") or {},
            created_by=_current_user_id(permission_context),
        )
    )
    screening_result = await screen_candidate_profile(
        candidate_name=candidate.full_name,
        jd_text=jd_text,
        resume_text=resume_text,
        source_name=source_name,
    )
    screening = await _persist_screening(
        session,
        permission_context,
        candidate=candidate,
        job=job,
        resume_text=resume_text,
        screening_result=screening_result,
    )
    await _log_activity(
        session,
        permission_context,
        activity_type="job.created",
        message=f"创建岗位：{job.title}",
        job_id=job.id,
    )
    await _log_activity(
        session,
        permission_context,
        activity_type="candidate.created",
        message=f"新增候选人：{candidate.full_name}",
        candidate_id=candidate.id,
        job_id=job.id,
        metadata={"source_channel": candidate.source_channel, "workflow": "screening"},
    )
    await session.commit()
    await session.refresh(job)
    await session.refresh(candidate)
    await session.refresh(screening)
    return {
        "job": serialize_job(job, candidate_count=1),
        "candidate": serialize_candidate(
            candidate,
            job=job,
            latest_screening=screening,
            interview_count=0,
        ),
        "screening": serialize_screening(screening),
    }


async def get_candidate_detail(session: AsyncSession, permission_context: dict[str, Any], candidate_id: str) -> dict[str, Any]:
    candidate = await _get_candidate(session, permission_context, candidate_id)
    job = await session.get(RecruitJob, candidate.job_id)
    screening_statement = (
        select(RecruitScreeningResult)
        .where(
            RecruitScreeningResult.tenant_id == permission_context["tenant_id"],
            RecruitScreeningResult.candidate_id == candidate.id,
        )
        .order_by(desc(RecruitScreeningResult.created_at))
    )
    screenings = (await session.execute(screening_statement)).scalars().all()
    interviews_statement = (
        select(RecruitInterview)
        .where(RecruitInterview.tenant_id == permission_context["tenant_id"], RecruitInterview.candidate_id == candidate.id)
        .order_by(desc(RecruitInterview.created_at))
    )
    interviews = (await session.execute(interviews_statement)).scalars().all()
    resumes = (
        await session.execute(
            select(RecruitResume)
            .where(RecruitResume.tenant_id == permission_context["tenant_id"], RecruitResume.candidate_id == candidate.id)
            .order_by(desc(RecruitResume.created_at))
        )
    ).scalars().all()
    question_sets = (
        await session.execute(
            select(RecruitInterviewQuestionSet)
            .where(
                RecruitInterviewQuestionSet.tenant_id == permission_context["tenant_id"],
                RecruitInterviewQuestionSet.candidate_id == candidate.id,
            )
            .order_by(desc(RecruitInterviewQuestionSet.created_at))
        )
    ).scalars().all()
    activities = (
        await session.execute(
            select(RecruitActivity)
            .where(RecruitActivity.tenant_id == permission_context["tenant_id"], RecruitActivity.candidate_id == candidate.id)
            .order_by(desc(RecruitActivity.created_at))
        )
    ).scalars().all()
    resume_payloads = [
        {
            "resume_id": row.id,
            "filename": row.filename,
            "mime_type": row.mime_type,
            "route_mode": row.route_mode,
            "processing_status": row.processing_status,
            "parsed_text": row.parsed_text,
            "profile": row.profile_json or (
                extract_resume_profile(row.parsed_text) if row.parsed_text else {}
            ),
            "created_at": row.created_at.isoformat(),
        }
        for row in resumes
    ]
    legacy_report = None
    if resumes and resumes[0].parsed_text and job:
        legacy_report = build_fallback_screening(
            candidate_name=candidate.full_name,
            jd_text=_body_text(job.description, job.requirements),
            resume_text=resumes[0].parsed_text,
            source_name=resumes[0].filename,
        )
    screening_payloads: list[dict[str, Any]] = []
    for row in screenings:
        payload = serialize_screening(row)
        if payload and not payload.get("score_report") and legacy_report:
            payload["score_report"] = legacy_report.get("score_report") or {}
        if payload:
            screening_payloads.append(payload)
    candidate_payload = serialize_candidate(
        candidate,
        job=job,
        latest_screening=screenings[0] if screenings else None,
        interview_count=len(interviews),
    )
    if screening_payloads:
        candidate_payload["latest_screening"] = screening_payloads[0]
    return {
        "candidate": candidate_payload,
        "job": serialize_job(job, candidate_count=0) if job else None,
        "resumes": resume_payloads,
        "screenings": screening_payloads,
        "interviews": [serialize_interview(row) for row in interviews],
        "question_sets": [
            {
                "question_set_id": row.id,
                "title": row.title,
                "questions": row.questions_json or [],
                "source": row.source,
                "created_at": row.created_at.isoformat(),
            }
            for row in question_sets
        ],
        "activities": [
            {
                "activity_id": row.id,
                "activity_type": row.activity_type,
                "message": row.message,
                "metadata": row.metadata_json or {},
                "created_at": row.created_at.isoformat(),
            }
            for row in activities
        ],
    }


async def update_candidate_stage(
    session: AsyncSession,
    permission_context: dict[str, Any],
    candidate_id: str,
    *,
    stage: str,
    status: str | None = None,
) -> dict[str, Any]:
    candidate = await _get_candidate(session, permission_context, candidate_id)
    await _ensure_write_access(session, permission_context, candidate.project_id)
    candidate.current_stage = normalize_text(stage) or candidate.current_stage
    if status is not None:
        candidate.status = normalize_text(status) or candidate.status
    candidate.updated_at = utc_now()
    await _log_activity(
        session,
        permission_context,
        activity_type="candidate.stage_changed",
        message=f"{candidate.full_name} 进入 {candidate.current_stage}",
        candidate_id=candidate.id,
        job_id=candidate.job_id,
        metadata={"status": candidate.status},
    )
    await session.commit()
    return {"candidate_id": candidate.id, "current_stage": candidate.current_stage, "status": candidate.status}


def _normalized_profile_records(value: Any, fields: tuple[str, ...]) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    records: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        record = {field: normalize_text(str(item.get(field) or "")) for field in fields}
        if any(record.values()):
            record["source_locator"] = record.get("source_locator") or "人工修订"
            records.append(record)
    return records


async def update_candidate_profile(
    session: AsyncSession,
    permission_context: dict[str, Any],
    candidate_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    candidate = await _get_candidate(session, permission_context, candidate_id)
    await _ensure_write_access(session, permission_context, candidate.project_id)

    candidate_fields = (
        "full_name",
        "email",
        "phone",
        "current_company",
        "location",
        "source_channel",
        "portfolio_url",
        "linkedin_url",
        "summary",
        "notes",
    )
    changed_fields: list[str] = []
    for field in candidate_fields:
        if field not in body:
            continue
        value = normalize_text(str(body.get(field) or ""))
        if field == "email":
            value = value.lower()
        if field == "full_name" and not value:
            raise ValueError("candidate_name_required")
        if getattr(candidate, field) != value:
            setattr(candidate, field, value)
            changed_fields.append(field)
    if "tags" in body:
        tags = _tags(body.get("tags"))
        if candidate.tags_json != tags:
            candidate.tags_json = tags
            changed_fields.append("tags")

    latest_resume = (
        await session.execute(
            select(RecruitResume)
            .where(
                RecruitResume.tenant_id == permission_context["tenant_id"],
                RecruitResume.candidate_id == candidate.id,
            )
            .order_by(desc(RecruitResume.created_at))
        )
    ).scalars().first()
    edited_profile = body.get("profile")
    profile: dict[str, Any] | None = None
    if isinstance(edited_profile, dict):
        base_profile = dict(
            (latest_resume.profile_json or (
                extract_resume_profile(latest_resume.parsed_text) if latest_resume and latest_resume.parsed_text else {}
            )) if latest_resume else {}
        )
        for field in ("headline", "summary"):
            if field in edited_profile:
                base_profile[field] = normalize_text(str(edited_profile.get(field) or ""))
        for key, fields in (
            ("education", ("institution", "degree", "major", "years", "evidence", "source_locator")),
            ("experience", ("company", "title", "years", "evidence", "source_locator")),
            ("projects", ("name", "role", "years", "evidence", "source_locator", "kind")),
        ):
            if key in edited_profile:
                base_profile[key] = _normalized_profile_records(edited_profile.get(key), fields)
        if "skills" in edited_profile:
            skills = edited_profile.get("skills")
            base_profile["skills"] = _tags(skills if isinstance(skills, list) else str(skills or ""))

        base_profile.update({
            "full_name": candidate.full_name,
            "email": candidate.email,
            "phone": candidate.phone,
            "current_company": candidate.current_company,
            "location": candidate.location,
        })
        base_profile["section_presence"] = {
            "education": bool(base_profile.get("education")),
            "experience": bool(base_profile.get("experience")),
            "projects": bool(base_profile.get("projects")),
            "skills": bool(base_profile.get("skills")),
        }
        profile = base_profile
        if latest_resume:
            latest_resume.profile_json = profile
            latest_resume.updated_at = utc_now()
        else:
            session.add(
                RecruitResume(
                    tenant_id=candidate.tenant_id,
                    team_id=candidate.team_id,
                    project_id=candidate.project_id,
                    candidate_id=candidate.id,
                    filename="人工维护候选人档案",
                    route_mode="manual",
                    processing_status="manual_profile",
                    profile_json=profile,
                    metadata_json={"source": "candidate_profile_editor"},
                    created_by=_current_user_id(permission_context),
                )
            )
        changed_fields.append("profile")

    candidate.updated_at = utc_now()
    await _log_activity(
        session,
        permission_context,
        activity_type="candidate.profile_updated",
        message=f"更新候选人档案：{candidate.full_name}",
        candidate_id=candidate.id,
        job_id=candidate.job_id,
        metadata={"fields": changed_fields},
    )
    await session.commit()
    await session.refresh(candidate)
    return serialize_candidate(candidate, profile_summary=profile)


async def add_interview(
    session: AsyncSession,
    permission_context: dict[str, Any],
    candidate_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    candidate = await _get_candidate(session, permission_context, candidate_id)
    await _ensure_write_access(session, permission_context, candidate.project_id)
    scheduled_at = None
    scheduled_value = body.get("scheduled_at")
    if isinstance(scheduled_value, str) and scheduled_value.strip():
        try:
            scheduled_at = datetime.fromisoformat(scheduled_value.strip().replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            scheduled_at = None
    interview = RecruitInterview(
        tenant_id=candidate.tenant_id,
        team_id=candidate.team_id,
        project_id=candidate.project_id,
        candidate_id=candidate.id,
        job_id=candidate.job_id,
        interview_type=normalize_text(str(body.get("interview_type") or "onsite")) or "onsite",
        stage=normalize_text(str(body.get("stage") or candidate.current_stage)) or candidate.current_stage,
        interviewer=normalize_text(str(body.get("interviewer") or "")),
        scheduled_at=scheduled_at,
        decision=normalize_text(str(body.get("decision") or "")),
        score=int(body["score"]) if body.get("score") not in (None, "") else None,
        notes=normalize_text(str(body.get("notes") or "")),
        summary=normalize_text(str(body.get("summary") or "")),
        created_by=_current_user_id(permission_context),
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    session.add(interview)
    candidate.current_stage = interview.stage or candidate.current_stage
    candidate.updated_at = utc_now()
    await _log_activity(
        session,
        permission_context,
        activity_type="interview.logged",
        message=f"记录 {candidate.full_name} 的 {interview.stage} 面试",
        candidate_id=candidate.id,
        job_id=candidate.job_id,
        metadata={"decision": interview.decision, "score": interview.score},
    )
    await session.commit()
    await session.refresh(interview)
    return serialize_interview(interview)


async def rerun_candidate_screening(
    session: AsyncSession,
    permission_context: dict[str, Any],
    candidate_id: str,
    *,
    parsed_document: dict[str, Any] | None = None,
    resume_text_override: str | None = None,
    source_name: str = "",
    source_mime_type: str = "",
    source_hash: str = "",
) -> dict[str, Any]:
    candidate = await _get_candidate(session, permission_context, candidate_id)
    await _ensure_write_access(session, permission_context, candidate.project_id)
    job = await _get_job(session, permission_context, candidate.job_id)
    resume_text = compile_resume_text(parsed_document, resume_text_override)
    if not resume_text:
        latest_resume = (
            await session.execute(
                select(RecruitResume)
                .where(RecruitResume.tenant_id == permission_context["tenant_id"], RecruitResume.candidate_id == candidate.id)
                .order_by(desc(RecruitResume.created_at))
            )
        ).scalars().first()
        resume_text = latest_resume.parsed_text if latest_resume else ""
    if not resume_text:
        raise ValueError("resume_text_required")
    if parsed_document or resume_text_override:
        session.add(
            RecruitResume(
                tenant_id=candidate.tenant_id,
                team_id=candidate.team_id,
                project_id=candidate.project_id,
                candidate_id=candidate.id,
                filename=source_name,
                mime_type=source_mime_type,
                content_hash=source_hash,
                route_mode=str((parsed_document or {}).get("metadata", {}).get("route_mode") or "text"),
                processing_status=str((parsed_document or {}).get("metadata", {}).get("processing_status") or "parsed"),
                parsed_text=resume_text,
                metadata_json=(parsed_document or {}).get("metadata") or {},
                created_by=_current_user_id(permission_context),
            )
        )
    screening = await _persist_screening(session, permission_context, candidate=candidate, job=job, resume_text=resume_text)
    await session.commit()
    await session.refresh(screening)
    return serialize_screening(screening)


async def list_interviews(session: AsyncSession, permission_context: dict[str, Any]) -> dict[str, Any]:
    statement = select(RecruitInterview).where(RecruitInterview.tenant_id == permission_context["tenant_id"]).order_by(desc(RecruitInterview.created_at))
    if permission_context.get("project_id"):
        statement = statement.where(RecruitInterview.project_id == permission_context.get("project_id"))
    interviews = (await session.execute(statement)).scalars().all()
    candidate_ids = list(dict.fromkeys(row.candidate_id for row in interviews))
    candidates = {}
    if candidate_ids:
        candidates = {
            row.id: row
            for row in (await session.execute(select(RecruitCandidate).where(RecruitCandidate.id.in_(candidate_ids)))).scalars().all()
        }
    return {
        "interviews": [
            {
                **serialize_interview(row),
                "candidate_name": candidates.get(row.candidate_id).full_name if candidates.get(row.candidate_id) else "",
                "job_id": row.job_id,
            }
            for row in interviews
        ],
        "count": len(interviews),
    }


async def dashboard_summary(session: AsyncSession, permission_context: dict[str, Any]) -> dict[str, Any]:
    jobs = (await session.execute(select(RecruitJob).where(RecruitJob.tenant_id == permission_context["tenant_id"]))).scalars().all()
    candidates = (await session.execute(select(RecruitCandidate).where(RecruitCandidate.tenant_id == permission_context["tenant_id"]))).scalars().all()
    interviews = (await session.execute(select(RecruitInterview).where(RecruitInterview.tenant_id == permission_context["tenant_id"]))).scalars().all()
    latest_map = await _latest_screenings_map(session, permission_context["tenant_id"], [candidate.id for candidate in candidates])
    profiles_map = await _latest_resume_profiles_map(session, permission_context["tenant_id"], [candidate.id for candidate in candidates])
    pipeline_counter = Counter(candidate.current_stage for candidate in candidates)
    source_counter = Counter(candidate.source_channel or "manual" for candidate in candidates)
    strong_count = sum(1 for screening in latest_map.values() if screening.total_score >= 85)
    jobs_by_id = {job.id: job for job in jobs}
    recent_candidates = sorted(candidates, key=lambda item: item.updated_at, reverse=True)[:6]
    return {
        "summary": {
            "job_count": len(jobs),
            "candidate_count": len(candidates),
            "interview_count": len(interviews),
            "strong_match_count": strong_count,
        },
        "pipeline": [{"stage": key, "count": count} for key, count in pipeline_counter.items()],
        "sources": [{"source": key, "count": count} for key, count in source_counter.items()],
        "recent_candidates": [
            serialize_candidate(
                candidate,
                job=jobs_by_id.get(candidate.job_id),
                latest_screening=latest_map.get(candidate.id),
                profile_summary=profiles_map.get(candidate.id),
            )
            for candidate in recent_candidates
        ],
        "open_jobs": [serialize_job(job, candidate_count=sum(1 for candidate in candidates if candidate.job_id == job.id)) for job in jobs[:4]],
    }


async def analytics_summary(session: AsyncSession, permission_context: dict[str, Any]) -> dict[str, Any]:
    jobs = (await session.execute(select(RecruitJob).where(RecruitJob.tenant_id == permission_context["tenant_id"]))).scalars().all()
    candidates = (await session.execute(select(RecruitCandidate).where(RecruitCandidate.tenant_id == permission_context["tenant_id"]))).scalars().all()
    screenings = (
        await session.execute(select(RecruitScreeningResult).where(RecruitScreeningResult.tenant_id == permission_context["tenant_id"]))
    ).scalars().all()
    interviews = (
        await session.execute(select(RecruitInterview).where(RecruitInterview.tenant_id == permission_context["tenant_id"]))
    ).scalars().all()
    stage_counter = Counter(candidate.current_stage for candidate in candidates)
    source_counter = Counter(candidate.source_channel or "manual" for candidate in candidates)
    job_counter = Counter(candidate.job_id for candidate in candidates)
    avg_score = round(sum(row.total_score for row in screenings) / len(screenings), 2) if screenings else 0.0
    by_job = []
    screenings_by_candidate = {}
    for screening in screenings:
        screenings_by_candidate.setdefault(screening.candidate_id, screening)
    for job in jobs:
        job_candidates = [candidate for candidate in candidates if candidate.job_id == job.id]
        passed = sum(
            1
            for candidate in job_candidates
            if (screenings_by_candidate.get(candidate.id) and screenings_by_candidate[candidate.id].total_score >= 70)
        )
        offers = sum(1 for candidate in job_candidates if candidate.current_stage == "offer")
        by_job.append(
            {
                "job_id": job.id,
                "title": job.title,
                "candidate_count": job_counter.get(job.id, 0),
                "screen_pass_count": passed,
                "offer_count": offers,
            }
        )
    analytics = {
        "average_score": avg_score,
        "stage_breakdown": [{"stage": key, "count": count} for key, count in stage_counter.items()],
        "source_breakdown": [{"source": key, "count": count} for key, count in source_counter.items()],
        "job_breakdown": by_job,
        "interview_load": [{"stage": key, "count": count} for key, count in Counter(row.stage for row in interviews).items()],
    }
    await session.execute(
        delete(RecruitMetric).where(
            RecruitMetric.tenant_id == permission_context["tenant_id"],
            RecruitMetric.project_id == _context_value(permission_context, "project_id"),
        )
    )
    timestamp = utc_now()
    metric_rows = [
        RecruitMetric(
            tenant_id=permission_context["tenant_id"],
            team_id=_context_value(permission_context, "team_id"),
            project_id=_context_value(permission_context, "project_id"),
            metric_name="average_score",
            metric_value=avg_score,
            measured_at=timestamp,
        )
    ]
    metric_rows.extend(
        RecruitMetric(
            tenant_id=permission_context["tenant_id"],
            team_id=_context_value(permission_context, "team_id"),
            project_id=_context_value(permission_context, "project_id"),
            metric_name="stage_breakdown",
            dimension_key="stage",
            dimension_value=item["stage"],
            metric_value=item["count"],
            measured_at=timestamp,
        )
        for item in analytics["stage_breakdown"]
    )
    metric_rows.extend(
        RecruitMetric(
            tenant_id=permission_context["tenant_id"],
            team_id=_context_value(permission_context, "team_id"),
            project_id=_context_value(permission_context, "project_id"),
            metric_name="source_breakdown",
            dimension_key="source",
            dimension_value=item["source"],
            metric_value=item["count"],
            measured_at=timestamp,
        )
        for item in analytics["source_breakdown"]
    )
    session.add_all(metric_rows)
    await session.commit()
    return analytics


def recruit_permission_context(request_headers: dict[str, Any], body: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = dict(body or {})
    merged.setdefault("tenant_id", request_headers.get("x-tenant-id"))
    merged.setdefault("user_id", request_headers.get("x-user-id"))
    merged.setdefault("team_id", request_headers.get("x-team-id"))
    merged.setdefault("project_id", request_headers.get("x-project-id"))
    merged.setdefault("roles", request_headers.get("x-roles"))
    merged.setdefault("scopes", request_headers.get("x-scopes"))
    return build_permission_context(merged)
