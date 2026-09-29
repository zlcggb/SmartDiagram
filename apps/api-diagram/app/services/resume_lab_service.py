"""Resume optimization lab: structured resume drafts, AI coaching chat and iterative re-scoring."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any, Awaitable, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.llm import create_llm, extract_text_content
from app.models.common import new_id, utc_now
from app.models.recruit import RecruitResume, RecruitResumeDraft, RecruitScreeningResult
from app.services.audit_service import ensure_principals
from app.services.recruit_ai_usage import add_usage, record_usage, role_model, with_usage
from app.services.recruit_service import (
    _body_text,
    _get_candidate,
    _get_job,
    _job_rubric,
    serialize_screening,
)
from app.services.talent_screening_service import extract_resume_profile, screen_candidate_profile

Progress = Callable[[dict[str, Any]], Awaitable[None]]

BASIC_FIELDS = ("name", "headline", "email", "phone", "location", "links")
SECTION_FIELDS: dict[str, tuple[str, ...]] = {
    "education": ("school", "degree", "major", "period", "details"),
    "experience": ("company", "title", "period", "details"),
    "projects": ("name", "role", "period", "details"),
    "skills": ("name", "items"),
    "awards": ("title", "period", "details"),
}
SECTION_LABELS = {
    "education": "教育经历",
    "experience": "工作 / 实习经历",
    "projects": "项目经历",
    "skills": "专业技能",
    "awards": "荣誉奖项 / 证书",
}
_MAX_MESSAGES = 60
_MAX_SCORES = 12
_HISTORY_TURNS = 12
_REPLY_OPEN, _REPLY_CLOSE = "<reply>", "</reply>"


def _owner_id(context: dict[str, Any]) -> str:
    if context.get("principal_kind") == "guest":
        return f"guest:{context['guest_id']}"
    return f"user:{context['user_id']}"


def persists_drafts(context: dict[str, Any]) -> bool:
    """Signed-in users always use the DB; guests only when RESUME_LAB_GUEST_PERSIST is on."""

    return context.get("principal_kind") != "guest" or settings.RESUME_LAB_GUEST_PERSIST


def storage_mode(context: dict[str, Any]) -> str:
    return "server" if persists_drafts(context) else "browser"


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _short_id() -> str:
    return uuid.uuid4().hex[:10]


def empty_document() -> dict[str, Any]:
    return {"basics": {key: "" for key in BASIC_FIELDS}, "summary": "", **{section: [] for section in SECTION_FIELDS}}


def normalize_document(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    basics_source = source.get("basics") if isinstance(source.get("basics"), dict) else {}
    document: dict[str, Any] = {
        "basics": {key: _clip(basics_source.get(key), 300) for key in BASIC_FIELDS},
        "summary": _clip(source.get("summary"), 3000),
    }
    for section, fields in SECTION_FIELDS.items():
        items = source.get(section) if isinstance(source.get(section), list) else []
        rows = []
        for item in items[:24]:
            if not isinstance(item, dict):
                continue
            row = {"id": _clip(item.get("id"), 40) or _short_id()}
            row.update({field: _clip(item.get(field), 5000 if field == "details" else 400) for field in fields})
            rows.append(row)
        document[section] = rows
    return document


def document_to_text(document: dict[str, Any]) -> str:
    """Plain-text rendering with conventional headings so the resume extractor and scorer can parse it."""

    doc = normalize_document(document)
    basics = doc["basics"]
    lines = [basics["name"], basics["headline"]]
    contact = " | ".join(value for value in (basics["phone"], basics["email"], basics["location"], basics["links"]) if value)
    if contact:
        lines.append(f"联系方式：{contact}")
    if doc["summary"]:
        lines += ["", "个人简介", doc["summary"]]
    for section, fields in SECTION_FIELDS.items():
        rows = [row for row in doc[section] if any(row[field] for field in fields)]
        if not rows:
            continue
        lines += ["", SECTION_LABELS[section]]
        for row in rows:
            if section == "skills":
                lines.append(f"{row['name']}：{row['items']}" if row["name"] else row["items"])
                continue
            header_fields = [field for field in fields if field != "details"]
            header = " | ".join(row[field] for field in header_fields if row[field])
            if header:
                lines.append(header)
            if row.get("details"):
                lines.append(row["details"])
    return "\n".join(line for line in lines if line is not None).strip()


def _extract_json_object(raw_text: str) -> dict[str, Any] | None:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw_text or "").strip())
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _tag_content(text: str, tag: str) -> str | None:
    match = re.search(rf"<{tag}>(.*?)</{tag}>", text, flags=re.S)
    return match.group(1).strip() if match else None


class ReplyStreamer:
    """Extracts the <reply>…</reply> portion of a streamed completion, holding back partial closing tags."""

    def __init__(self) -> None:
        self.buffer = ""
        self.sent = 0

    def feed(self, delta: str) -> str:
        self.buffer += delta
        start = self.buffer.find(_REPLY_OPEN)
        if start == -1:
            return ""
        body_start = start + len(_REPLY_OPEN)
        end = self.buffer.find(_REPLY_CLOSE, body_start)
        limit = end if end != -1 else max(body_start, len(self.buffer) - len(_REPLY_CLOSE))
        chunk = self.buffer[body_start + self.sent : limit]
        self.sent += len(chunk)
        return chunk


def parse_coach_output(text: str) -> tuple[str, list[str], dict[str, Any] | None]:
    reply = _tag_content(text, "reply")
    if reply is None:
        reply = re.sub(r"<(changes|resume)>.*?(</\1>|$)", "", text, flags=re.S).replace(_REPLY_OPEN, "").strip()
    changes: list[str] = []
    raw_changes = _tag_content(text, "changes")
    if raw_changes:
        try:
            parsed = json.loads(raw_changes)
            if isinstance(parsed, list):
                changes = [_clip(item, 200) for item in parsed if _clip(item, 200)][:12]
        except json.JSONDecodeError:
            changes = [_clip(line.lstrip("-•· "), 200) for line in raw_changes.splitlines() if line.strip()][:12]
    raw_resume = _tag_content(text, "resume")
    resume = _extract_json_object(raw_resume) if raw_resume else None
    return reply, changes, resume


_SCHEMA_HINT = json.dumps(
    {
        "basics": {key: "" for key in BASIC_FIELDS},
        "summary": "",
        **{section: [{"id": "", **{field: "" for field in fields}}] for section, fields in SECTION_FIELDS.items()},
    },
    ensure_ascii=False,
)


def _profile_to_document(profile: dict[str, Any], candidate: Any = None) -> dict[str, Any]:
    document = empty_document()
    document["basics"].update({
        "name": _clip(profile.get("full_name") or getattr(candidate, "full_name", ""), 300),
        "headline": _clip(profile.get("headline"), 300),
        "email": _clip(profile.get("email") or getattr(candidate, "email", ""), 300),
        "phone": _clip(profile.get("phone") or getattr(candidate, "phone", ""), 300),
        "location": _clip(profile.get("location") or getattr(candidate, "location", ""), 300),
    })
    document["summary"] = _clip(profile.get("summary"), 3000)
    for item in profile.get("education") or []:
        document["education"].append({"school": item.get("institution"), "degree": item.get("degree"), "major": item.get("major"), "period": item.get("years"), "details": item.get("evidence")})
    for item in profile.get("experience") or []:
        document["experience"].append({"company": item.get("company"), "title": item.get("title"), "period": item.get("years"), "details": item.get("evidence")})
    for item in profile.get("projects") or []:
        document["projects"].append({"name": item.get("name"), "role": item.get("role"), "period": item.get("years"), "details": item.get("evidence")})
    for item in profile.get("competitions") or []:
        document["awards"].append({"title": item.get("name"), "period": item.get("years"), "details": item.get("evidence")})
    skills = [str(skill) for skill in profile.get("skills") or [] if skill]
    if skills:
        document["skills"].append({"name": "技能", "items": "、".join(skills)})
    return normalize_document(document)


async def structure_resume_text(resume_text: str, *, model: str | None = None) -> dict[str, Any] | None:
    messages = [
        SystemMessage(content=(
            "你是简历结构化助手。把用户提供的简历原文忠实整理为 JSON，不要编造、不要润色、不要删减关键信息。"
            "details 字段保留原文要点，每条要点单独一行并以「• 」开头。period 使用「2022.09 - 2026.06」格式。"
            f"只输出 JSON，结构如下（id 留空即可）：\n{_SCHEMA_HINT}"
        )),
        HumanMessage(content=f"简历原文：\n{resume_text[:14_000]}"),
    ]
    try:
        llm = with_usage(create_llm(model=model or role_model("screening"), temperature=0.1))
        response = await llm.ainvoke(messages)
        output = extract_text_content(response.content)
        record_usage("screening", llm, response.usage_metadata, prompt_text=resume_text, output_text=output)
    except Exception:
        return None
    parsed = _extract_json_object(output)
    return normalize_document(parsed) if parsed else None


def _score_entry(result: dict[str, Any], *, label: str, revision: int) -> dict[str, Any]:
    return {
        "id": _short_id(),
        "label": label,
        "revision": revision,
        "total_score": int(result.get("total_score") or 0),
        "max_score": int(result.get("max_score") or 100),
        "recommendation": _clip(result.get("recommendation"), 200),
        "overall_summary": _clip(result.get("overall_summary"), 2000),
        "strengths": list(result.get("strengths") or [])[:8],
        "risks": list(result.get("risks") or [])[:8],
        "recommendations": list(result.get("recommendations") or [])[:8],
        "missing_keywords": list(result.get("missing_keywords") or [])[:16],
        "score_report": result.get("score_report") or {},
        "created_at": utc_now().isoformat(),
    }


def _serialize(draft: RecruitResumeDraft, job: Any = None, *, storage: str = "server") -> dict[str, Any]:
    # Browser-stored drafts keep undo snapshots client-side, so they are returned in full.
    keep_snapshots = storage == "browser"
    return {
        "id": draft.id,
        "title": draft.title,
        "candidate_id": draft.candidate_id,
        "job_id": draft.job_id,
        "job": {"job_id": job.id, "title": job.title, "recruitment_type": job.recruitment_type} if job else None,
        "document": normalize_document(draft.document_json),
        "messages": [
            {
                **{key: value for key, value in item.items() if keep_snapshots or key != "before"},
                "can_undo": bool(item.get("before")),
            }
            for item in draft.messages_json or []
        ],
        "scores": draft.scores_json or [],
        "revision": draft.revision,
        "storage": storage,
        "created_at": draft.created_at.isoformat(),
        "updated_at": draft.updated_at.isoformat(),
    }


def _parse_time(value: Any) -> datetime:
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return utc_now()


def _message_from_payload(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict) or item.get("role") not in ("user", "assistant", "score"):
        return None
    entry: dict[str, Any] = {
        "id": _clip(item.get("id"), 40) or _short_id(),
        "role": item["role"],
        "content": _clip(item.get("content"), 8000),
        "created_at": _clip(item.get("created_at"), 40) or utc_now().isoformat(),
    }
    if isinstance(item.get("changes"), list):
        entry["changes"] = [_clip(change, 200) for change in item["changes"][:12]]
    if isinstance(item.get("before"), dict):
        entry["before"] = normalize_document(item["before"])
    if item.get("undone"):
        entry["undone"] = True
    if item.get("score_id"):
        entry["score_id"] = _clip(item.get("score_id"), 40)
    return entry


def _draft_from_payload(context: dict[str, Any], draft_id: str, payload: Any) -> RecruitResumeDraft:
    """Rebuilds a browser-stored draft in memory; it is never added to the DB session."""

    if not isinstance(payload, dict):
        raise ValueError("resume_draft_required")
    messages = [entry for entry in map(_message_from_payload, list(payload.get("messages") or [])[-_MAX_MESSAGES:]) if entry]
    scores = [item for item in list(payload.get("scores") or [])[-_MAX_SCORES:] if isinstance(item, dict)]
    try:
        revision = max(1, int(payload.get("revision") or 1))
    except (TypeError, ValueError):
        revision = 1
    return RecruitResumeDraft(
        id=draft_id,
        tenant_id=context["tenant_id"],
        owner_id=_owner_id(context),
        candidate_id=_clip(payload.get("candidate_id"), 64) or None,
        job_id=_clip(payload.get("job_id"), 64) or None,
        title=_clip(payload.get("title"), 120),
        document_json=normalize_document(payload.get("document")),
        messages_json=messages,
        scores_json=scores,
        revision=revision,
        created_at=_parse_time(payload.get("created_at")),
        updated_at=_parse_time(payload.get("updated_at")),
    )


async def _load_draft(
    session: AsyncSession, context: dict[str, Any], draft_id: str, body: dict[str, Any],
) -> RecruitResumeDraft:
    if persists_drafts(context):
        return await _get_draft(session, context, draft_id)
    return _draft_from_payload(context, draft_id, body.get("draft"))


async def _save_draft(session: AsyncSession, context: dict[str, Any]) -> None:
    if persists_drafts(context):
        await session.commit()


async def _get_draft(session: AsyncSession, context: dict[str, Any], draft_id: str) -> RecruitResumeDraft:
    if not persists_drafts(context):
        raise ValueError("resume_draft_not_found")
    draft = await session.scalar(
        select(RecruitResumeDraft).where(
            RecruitResumeDraft.id == draft_id,
            RecruitResumeDraft.tenant_id == context["tenant_id"],
            RecruitResumeDraft.owner_id == _owner_id(context),
        )
    )
    if draft is None:
        raise ValueError("resume_draft_not_found")
    return draft


async def _draft_job(session: AsyncSession, context: dict[str, Any], draft: RecruitResumeDraft):
    if not draft.job_id:
        return None
    try:
        return await _get_job(session, context, draft.job_id)
    except (PermissionError, ValueError):
        return None


async def list_resume_drafts(session: AsyncSession, context: dict[str, Any]) -> list[dict[str, Any]]:
    if not persists_drafts(context):
        return []
    drafts = (
        await session.scalars(
            select(RecruitResumeDraft)
            .where(RecruitResumeDraft.tenant_id == context["tenant_id"], RecruitResumeDraft.owner_id == _owner_id(context))
            .order_by(desc(RecruitResumeDraft.updated_at))
            .limit(50)
        )
    ).all()
    result = []
    for draft in drafts:
        scores = draft.scores_json or []
        result.append({
            "id": draft.id,
            "title": draft.title,
            "candidate_id": draft.candidate_id,
            "job_id": draft.job_id,
            "latest_score": scores[-1]["total_score"] if scores else None,
            "first_score": scores[0]["total_score"] if scores else None,
            "score_count": len(scores),
            "updated_at": draft.updated_at.isoformat(),
        })
    return result


async def get_resume_draft(session: AsyncSession, context: dict[str, Any], draft_id: str) -> dict[str, Any]:
    draft = await _get_draft(session, context, draft_id)
    return _serialize(draft, await _draft_job(session, context, draft))


async def create_resume_draft(
    session: AsyncSession, context: dict[str, Any], body: dict[str, Any], *, model: str | None = None,
) -> dict[str, Any]:
    candidate_id = _clip(body.get("candidate_id"), 64) or None
    job_id = _clip(body.get("job_id"), 64) or None
    resume_text = _clip(body.get("resume_text"), 20_000)
    persist = persists_drafts(context)
    if persist:
        await ensure_principals(session, context, None)
    candidate = None
    scores: list[dict[str, Any]] = []
    if candidate_id:
        existing = await session.scalar(
            select(RecruitResumeDraft)
            .where(
                RecruitResumeDraft.tenant_id == context["tenant_id"],
                RecruitResumeDraft.owner_id == _owner_id(context),
                RecruitResumeDraft.candidate_id == candidate_id,
            )
            .order_by(desc(RecruitResumeDraft.updated_at))
        ) if persist else None
        if existing is not None and not body.get("force_new"):
            return _serialize(existing, await _draft_job(session, context, existing))
        candidate = await _get_candidate(session, context, candidate_id)
        job_id = candidate.job_id
        latest_resume = await session.scalar(
            select(RecruitResume)
            .where(RecruitResume.tenant_id == context["tenant_id"], RecruitResume.candidate_id == candidate.id)
            .order_by(desc(RecruitResume.created_at))
        )
        if latest_resume is not None and not resume_text:
            resume_text = latest_resume.parsed_text or ""
        latest_screening = await session.scalar(
            select(RecruitScreeningResult)
            .where(RecruitScreeningResult.tenant_id == context["tenant_id"], RecruitScreeningResult.candidate_id == candidate.id)
            .order_by(desc(RecruitScreeningResult.created_at))
        )
        if latest_screening is not None:
            scores.append(_score_entry(serialize_screening(latest_screening) or {}, label="原始简历", revision=0))
    if not job_id:
        raise ValueError("job_id_required")
    job = await _get_job(session, context, job_id)

    document = await structure_resume_text(resume_text, model=model) if resume_text else None
    if document is None and resume_text:
        document = _profile_to_document(extract_resume_profile(resume_text), candidate)
    if document is None:
        document = _profile_to_document({}, candidate)

    name = document["basics"]["name"] or (candidate.full_name if candidate else "")
    now = utc_now()
    draft = RecruitResumeDraft(
        id=new_id(),
        tenant_id=context["tenant_id"],
        owner_id=_owner_id(context),
        candidate_id=candidate.id if candidate else None,
        job_id=job.id,
        title=f"{name or '我的简历'} · {job.title}"[:120],
        document_json=document,
        messages_json=[{
            "id": _short_id(),
            "role": "assistant",
            "content": (
                f"简历已载入模板，目标岗位是「{job.title}」。右侧可以直接点击任意文字修改，改动会自动保存。\n\n"
                "你可以让我：对照 JD 找差距、把经历改写成「动作 + 结果 + 数据」、精简到一页，"
                "或者直接点「重新评分」看看当前分数。"
            ),
            "created_at": utc_now().isoformat(),
        }],
        scores_json=scores,
        revision=1,
        created_at=now,
        updated_at=now,
    )
    if not persist:
        return _serialize(draft, job, storage="browser")
    session.add(draft)
    await session.commit()
    return _serialize(draft, job)


async def update_resume_draft(
    session: AsyncSession, context: dict[str, Any], draft_id: str, body: dict[str, Any],
) -> dict[str, Any]:
    draft = await _get_draft(session, context, draft_id)
    if "document" in body:
        draft.document_json = normalize_document(body.get("document"))
        draft.revision += 1
    if body.get("title"):
        draft.title = _clip(body.get("title"), 120)
    draft.updated_at = utc_now()
    await session.commit()
    return {"id": draft.id, "revision": draft.revision, "updated_at": draft.updated_at.isoformat()}


async def delete_resume_draft(session: AsyncSession, context: dict[str, Any], draft_id: str) -> None:
    draft = await _get_draft(session, context, draft_id)
    await session.delete(draft)
    await session.commit()


async def undo_resume_change(
    session: AsyncSession, context: dict[str, Any], draft_id: str, message_id: str,
) -> dict[str, Any]:
    draft = await _get_draft(session, context, draft_id)
    messages = list(draft.messages_json or [])
    index = next((i for i, item in enumerate(messages) if item.get("id") == message_id and item.get("before")), -1)
    if index == -1:
        raise ValueError("resume_change_not_found")
    draft.document_json = normalize_document(messages[index]["before"])
    messages[index] = {**{k: v for k, v in messages[index].items() if k != "before"}, "undone": True}
    draft.messages_json = messages
    draft.revision += 1
    draft.updated_at = utc_now()
    await session.commit()
    return _serialize(draft, await _draft_job(session, context, draft))


def _coach_messages(draft: RecruitResumeDraft, job: Any, user_message: str) -> list[Any]:
    jd_text = _body_text(job.description, job.requirements) if job else ""
    latest = (draft.scores_json or [])[-1] if draft.scores_json else None
    score_context = "尚未评分。"
    if latest:
        score_context = json.dumps({
            "total_score": latest.get("total_score"),
            "recommendation": latest.get("recommendation"),
            "summary": latest.get("overall_summary"),
            "gaps": latest.get("risks"),
            "suggestions": latest.get("recommendations"),
            "missing_keywords": latest.get("missing_keywords"),
        }, ensure_ascii=False)
    system = (
        "你是资深招聘官兼简历教练，帮助候选人针对目标岗位迭代优化简历。\n"
        "原则：\n"
        "1. 绝不编造经历、公司、学历、数字或技能。原文缺少的关键信息，用「【待补充：xxx】」占位；"
        "xxx 写成用户能直接回答的具体问题（如「【待补充：团队规模及你负责的模块】」），同一处缺失合并为一个占位。"
        "界面会把占位自动弹窗问用户，回复中无需逐条复述。\n"
        "1.1 用户提供「待补充」的回答时：用专业简历语言改写后替换对应占位并与上下文融为通顺的一条要点；"
        "标记「不适用」的删去该占位及其引导语；未回答的占位原样保留。此时必须输出修改后的简历。\n"
        "2. 改写经历时使用「动作 + 方法/技术 + 可验证结果」结构，要点以「• 」开头、每条一行，贴合 JD 关键词但不堆砌。\n"
        "3. 回复简洁、具体、中文；先说结论，再列 2-5 条要点。只是提问或分析时不要改简历。\n"
        "4. 若用户明确要求修改，或修改能直接提升匹配度，则输出完整的新简历 JSON（保留未改动部分与已有 id）。\n"
        "输出格式（严格遵守，标签外不要有任何内容）：\n"
        "<reply>给用户的回复（可用简单 Markdown）</reply>\n"
        "<changes>[\"改动说明1\", \"改动说明2\"]</changes>   ← 仅在修改简历时输出\n"
        "<resume>{完整简历 JSON}</resume>   ← 仅在修改简历时输出\n\n"
        f"简历 JSON 结构：{_SCHEMA_HINT}\n\n"
        f"目标岗位：{job.title if job else '未指定'}\n岗位 JD：\n{jd_text[:6000] or '（无）'}\n\n"
        f"最近一次 AI 评分：{score_context}"
    )
    messages: list[Any] = [SystemMessage(content=system)]
    for item in (draft.messages_json or [])[-_HISTORY_TURNS:]:
        if item.get("role") == "user":
            messages.append(HumanMessage(content=str(item.get("content") or "")))
        elif item.get("role") == "assistant":
            messages.append(AIMessage(content=str(item.get("content") or "")))
    current = json.dumps(normalize_document(draft.document_json), ensure_ascii=False)
    messages.append(HumanMessage(content=f"当前简历 JSON：\n{current}\n\n我的要求：{user_message}"))
    return messages


async def run_resume_chat(
    session: AsyncSession,
    context: dict[str, Any],
    draft_id: str,
    body: dict[str, Any],
    *,
    model: str | None,
    progress: Progress,
) -> dict[str, Any]:
    message = _clip(body.get("message"), 4000)
    if not message:
        raise ValueError("message_required")
    draft = await _load_draft(session, context, draft_id, body)
    job = await _draft_job(session, context, draft)
    llm_messages = _coach_messages(draft, job, message)
    user_entry = {"id": _short_id(), "role": "user", "content": message, "created_at": utc_now().isoformat()}

    llm = with_usage(create_llm(model=model or role_model("screening"), temperature=0.4))
    streamer = ReplyStreamer()
    usage = None
    rewriting = False
    async for chunk in llm.astream(llm_messages):
        usage = add_usage(usage, chunk.usage_metadata)
        delta = extract_text_content(chunk.content)
        if not delta:
            continue
        text = streamer.feed(delta)
        if text:
            await progress({"type": "token", "text": text})
        if not rewriting and "<resume>" in streamer.buffer:
            rewriting = True
            await progress({"type": "status", "label": "正在改写简历…"})
    output = streamer.buffer
    record_usage(
        "screening", llm, usage,
        prompt_text="\n".join(extract_text_content(item.content) for item in llm_messages), output_text=output,
    )

    reply, changes, resume = parse_coach_output(output)
    assistant_entry: dict[str, Any] = {
        "id": _short_id(),
        "role": "assistant",
        "content": reply or "（没有生成回复，请换个说法再试一次）",
        "created_at": utc_now().isoformat(),
    }
    if resume is not None:
        before = normalize_document(draft.document_json)
        after = normalize_document(resume)
        if after != before:
            assistant_entry.update({"changes": changes, "before": before})
            draft.document_json = after
            draft.revision += 1
    draft.messages_json = [*(draft.messages_json or []), user_entry, assistant_entry][-_MAX_MESSAGES:]
    draft.updated_at = utc_now()
    await _save_draft(session, context)
    return _serialize(draft, job, storage=storage_mode(context))


async def run_resume_score(
    session: AsyncSession,
    context: dict[str, Any],
    draft_id: str,
    body: dict[str, Any],
    *,
    model: str | None,
    progress: Progress,
) -> dict[str, Any]:
    draft = await _load_draft(session, context, draft_id, body)
    if not draft.job_id:
        raise ValueError("job_id_required")
    job = await _get_job(session, context, draft.job_id)
    document = normalize_document(draft.document_json)
    resume_text = document_to_text(document)
    if len(resume_text) < 40:
        raise ValueError("resume_text_required")
    result = await screen_candidate_profile(
        candidate_name=document["basics"]["name"] or draft.title,
        jd_text=_body_text(job.description, job.requirements),
        resume_text=resume_text,
        rubric=await _job_rubric(job),
        jd_title=job.title,
        model=model,
        progress=progress,
    )
    scores = list(draft.scores_json or [])
    iteration = sum(1 for item in scores if item.get("revision", 0) > 0) + 1
    entry = _score_entry(result, label=f"第 {iteration} 版", revision=draft.revision)
    previous = scores[-1]["total_score"] if scores else None
    delta = entry["total_score"] - previous if previous is not None else None
    delta_text = f"（{'+' if delta >= 0 else ''}{delta}）" if delta is not None else ""
    draft.scores_json = [*scores, entry][-_MAX_SCORES:]
    draft.messages_json = [*(draft.messages_json or []), {
        "id": _short_id(),
        "role": "score",
        "content": f"{entry['label']}评分 {entry['total_score']} 分{delta_text} · {entry['recommendation']}",
        "score_id": entry["id"],
        "created_at": entry["created_at"],
    }][-_MAX_MESSAGES:]
    draft.updated_at = utc_now()
    await _save_draft(session, context)
    return _serialize(draft, job, storage=storage_mode(context))
