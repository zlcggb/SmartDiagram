"""Persist talent-search conversations and run matching after the HTTP response."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import async_session
from app.core.logger import logger
from app.models.common import utc_now
from app.models.recruit import RecruitSearchConversation
from app.services.audit_service import ensure_principals
from app.services.recruit_service import match_candidates
from app.services.talent_rubric_service import generate_rubric, parse_rubric_json


def _owner_id(context: dict[str, Any]) -> str:
    if context.get("principal_kind") == "guest":
        return f"guest:{context['guest_id']}"
    return f"user:{context['user_id']}"


def _serialize(conversation: RecruitSearchConversation) -> dict[str, Any]:
    return {
        "id": conversation.id,
        "title": conversation.title,
        "jd_title": conversation.jd_title,
        "jd_text": conversation.jd_text,
        "source": conversation.source_json,
        "turns": conversation.turns_json,
        "status": conversation.status,
        "revision": conversation.revision,
        "created_at": conversation.created_at.isoformat(),
        "updated_at": conversation.updated_at.isoformat(),
    }


def _append_progress_event(turn: dict[str, Any], progress_event: dict[str, Any]) -> dict[str, Any]:
    events = turn.get("events") or []
    return {
        **turn,
        "events": [
            *events,
            {**progress_event, "id": len(events) + 1, "created_at": utc_now().isoformat()},
        ],
    }


async def _get_conversation(
    session: AsyncSession, context: dict[str, Any], conversation_id: str,
) -> RecruitSearchConversation:
    conversation = await session.scalar(
        select(RecruitSearchConversation).where(
            RecruitSearchConversation.id == conversation_id,
            RecruitSearchConversation.tenant_id == context["tenant_id"],
            RecruitSearchConversation.owner_id == _owner_id(context),
        )
    )
    if conversation is None:
        raise ValueError("search_conversation_not_found")
    return conversation


async def _expire_stale(session: AsyncSession, conversation: RecruitSearchConversation) -> None:
    if conversation.status not in ("analyzing", "matching"):
        return
    if utc_now() - conversation.updated_at < timedelta(seconds=settings.WORKER_STALE_JOB_TIMEOUT_SECONDS):
        return
    turn = {**conversation.turns_json[-1], "status": "failed", "error": "检索已中断，请重试。"}
    events = turn.get("events") or []
    active_node = events[-1].get("node", "requirements") if events else "requirements"
    turn = _append_progress_event(turn, {
        "node": active_node,
        "status": "failed",
        "message": "检索已中断",
        "detail": "任务超时，请重试。",
    })
    conversation.turns_json = [*conversation.turns_json[:-1], turn]
    conversation.status = "failed"
    conversation.updated_at = utc_now()
    await session.commit()


async def list_search_conversations(session: AsyncSession, context: dict[str, Any]) -> list[dict[str, Any]]:
    conversations = (
        await session.scalars(
            select(RecruitSearchConversation)
            .where(
                RecruitSearchConversation.tenant_id == context["tenant_id"],
                RecruitSearchConversation.owner_id == _owner_id(context),
            )
            .order_by(desc(RecruitSearchConversation.updated_at))
            .limit(30)
        )
    ).all()
    return [
        {"id": item.id, "title": item.title, "status": item.status, "updated_at": item.updated_at.isoformat()}
        for item in conversations
    ]


async def get_search_conversation(
    session: AsyncSession, context: dict[str, Any], conversation_id: str,
) -> dict[str, Any]:
    conversation = await _get_conversation(session, context, conversation_id)
    await _expire_stale(session, conversation)
    return _serialize(conversation)


async def get_search_event_batch(
    conversation_id: str, context: dict[str, Any], after_id: int,
) -> tuple[list[dict[str, Any]], str]:
    async with async_session() as session:
        conversation = await _get_conversation(session, context, conversation_id)
        await _expire_stale(session, conversation)
        turn = conversation.turns_json[-1] if conversation.turns_json else {}
        events = [event for event in turn.get("events", []) if int(event.get("id", 0)) > after_id]
        return events, conversation.status


async def create_search_conversation(
    session: AsyncSession, context: dict[str, Any], body: dict[str, Any],
) -> dict[str, Any]:
    jd_text = str(body.get("jd_text") or "").strip()[:12_000]
    if not jd_text:
        raise ValueError("jd_text_required")
    message = str(body.get("message") or "").strip()[:2_000]
    source = body.get("source") if isinstance(body.get("source"), dict) else {}
    source = {key: str(source.get(key) or "")[:12_000] for key in ("label", "title", "text", "kind")} if source else {}
    jd_title = str(body.get("jd_title") or "人才检索").strip()[:200]
    await ensure_principals(session, context, None)
    conversation = RecruitSearchConversation(
        tenant_id=context["tenant_id"],
        owner_id=_owner_id(context),
        title=(message or source.get("label") or jd_title)[:80],
        jd_title=jd_title,
        jd_text=jd_text,
        source_json=source,
        turns_json=[{"id": 1, "text": message or f"按「{source.get('label') or jd_title}」找人才", "status": "analyzing"}],
    )
    session.add(conversation)
    await session.commit()
    return _serialize(conversation)


async def append_search_turn(
    session: AsyncSession, context: dict[str, Any], conversation_id: str, body: dict[str, Any],
) -> dict[str, Any]:
    conversation = await _get_conversation(session, context, conversation_id)
    if conversation.status in ("analyzing", "matching"):
        raise ValueError("search_conversation_busy")
    message = str(body.get("message") or "").strip()[:2_000]
    if not message:
        raise ValueError("message_required")
    conversation.jd_text = f"{conversation.jd_text}\n\n补充条件：{message}"[-12_000:]
    conversation.turns_json = [
        *conversation.turns_json,
        {"id": conversation.turns_json[-1]["id"] + 1, "text": message, "status": "analyzing"},
    ]
    conversation.status = "analyzing"
    conversation.revision += 1
    conversation.updated_at = utc_now()
    await session.commit()
    return _serialize(conversation)


async def retry_search_turn(
    session: AsyncSession, context: dict[str, Any], conversation_id: str, body: dict[str, Any],
) -> dict[str, Any]:
    conversation = await _get_conversation(session, context, conversation_id)
    if conversation.status in ("analyzing", "matching"):
        raise ValueError("search_conversation_busy")
    turn = conversation.turns_json[-1]
    rubric = body.get("rubric") or turn.get("rubric")
    if rubric:
        rubric = parse_rubric_json(json.dumps(rubric, ensure_ascii=False), jd_title=conversation.jd_title, jd_text=conversation.jd_text)
        if not rubric:
            raise ValueError("rubric_required")
    conversation.status = "matching" if rubric else "analyzing"
    conversation.turns_json = [
        *conversation.turns_json[:-1],
        {**turn, "status": conversation.status, "rubric": rubric, "matches": None, "summary": None, "error": None, "events": []},
    ]
    conversation.revision += 1
    conversation.updated_at = utc_now()
    await session.commit()
    return _serialize(conversation)


async def _update_job(
    conversation_id: str,
    revision: int,
    *,
    progress_event: dict[str, Any] | None = None,
    **updates: Any,
) -> bool:
    async with async_session() as session:
        conversation = await session.get(RecruitSearchConversation, conversation_id)
        if conversation is None or conversation.revision != revision or conversation.status not in ("analyzing", "matching"):
            return False
        turn = {**conversation.turns_json[-1], **updates}
        if progress_event is not None:
            turn = _append_progress_event(turn, progress_event)
        conversation.turns_json = [*conversation.turns_json[:-1], turn]
        if "status" in updates:
            conversation.status = updates["status"]
        conversation.updated_at = utc_now()
        await session.commit()
    return True


async def run_search_conversation(conversation_id: str, context: dict[str, Any], revision: int) -> None:
    current_node = "requirements"
    try:
        async with async_session() as session:
            conversation = await session.get(RecruitSearchConversation, conversation_id)
            if conversation is None or conversation.revision != revision:
                return
            jd_title, jd_text = conversation.jd_title, conversation.jd_text
            rubric = conversation.turns_json[-1].get("rubric")
        if not rubric:
            await _update_job(conversation_id, revision, progress_event={
                "node": "requirements",
                "status": "started",
                "message": "正在拆解岗位需求",
                "detail": "从 JD 中提取岗位目标、评分要求与硬性门槛。",
            })
            rubric = await generate_rubric(jd_title, jd_text[:12_000])
        requirement_count = len(rubric.get("requirements", []))
        knockout_count = len(rubric.get("knockouts", []))
        if not await _update_job(
            conversation_id,
            revision,
            progress_event={
                "node": "requirements",
                "status": "completed",
                "message": "岗位评分标准已整理",
                "detail": f"形成 {requirement_count} 项评分要求、{knockout_count} 项硬性门槛。",
                "data": {"requirement_count": requirement_count, "knockout_count": knockout_count},
            },
            rubric=jsonable_encoder(rubric),
            status="matching",
        ):
            return

        current_node = "resume_scan"

        async def report_progress(event: dict[str, Any]) -> None:
            nonlocal current_node
            current_node = str(event.get("node") or current_node)
            await _update_job(conversation_id, revision, progress_event=jsonable_encoder(event))

        async with async_session() as session:
            result = await match_candidates(
                session,
                {**context, "project_id": None},
                {"jd_title": jd_title, "jd_text": jd_text, "rubric": rubric},
                progress=report_progress,
            )
        current_node = "ranking"
        await _update_job(
            conversation_id,
            revision,
            progress_event={
                "node": "ranking",
                "status": "completed",
                "message": "匹配结果已排序",
                "detail": f"已评估 {result['evaluated']} / {result['total']} 份可解析简历，按人岗评分排序。",
                "data": {"recalled_count": result["total"], "evaluated_count": result["evaluated"]},
            },
            status="completed",
            matches=jsonable_encoder(result),
            summary=f"已评估 {result['evaluated']} / {result['total']} 份简历", error=None,
        )
    except Exception:
        logger.exception("Talent search failed for conversation %s", conversation_id)
        await _update_job(
            conversation_id,
            revision,
            progress_event={
                "node": current_node,
                "status": "failed",
                "message": "当前步骤未能完成",
                "detail": "人才检索失败，请重试。",
            },
            status="failed",
            error="人才检索失败，请重试。",
        )