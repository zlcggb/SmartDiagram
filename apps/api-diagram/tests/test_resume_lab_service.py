import asyncio

import pytest

from app.core.config import settings
from app.services.resume_lab_service import (
    ReplyStreamer,
    _draft_from_payload,
    _get_draft,
    _serialize,
    document_to_text,
    normalize_document,
    parse_coach_output,
    storage_mode,
)

GUEST = {"tenant_id": "guest-pool", "guest_id": "g1", "principal_kind": "guest"}
USER = {"tenant_id": "t1", "user_id": "u1", "principal_kind": "user"}


def test_storage_mode_keeps_guests_in_browser_by_default(monkeypatch):
    monkeypatch.setattr(settings, "RESUME_LAB_GUEST_PERSIST", False)
    assert storage_mode(GUEST) == "browser"
    assert storage_mode(USER) == "server"
    monkeypatch.setattr(settings, "RESUME_LAB_GUEST_PERSIST", True)
    assert storage_mode(GUEST) == "server"


def test_browser_guest_cannot_reach_db_drafts(monkeypatch):
    monkeypatch.setattr(settings, "RESUME_LAB_GUEST_PERSIST", False)
    with pytest.raises(ValueError, match="resume_draft_not_found"):
        asyncio.run(_get_draft(None, GUEST, "any"))  # type: ignore[arg-type]


def test_browser_draft_round_trips_with_undo_snapshots():
    payload = {
        "title": "我的简历",
        "job_id": "job-1",
        "document": {"basics": {"name": "张三"}},
        "messages": [
            {"id": "m1", "role": "assistant", "content": "改好了", "changes": ["重写简介"], "before": {"summary": "旧"}},
            {"role": "system", "content": "ignored"},
        ],
        "scores": [{"total_score": 70}, "bad"],
        "revision": 3,
        "created_at": "2026-09-27T07:00:00",
    }
    draft = _draft_from_payload(GUEST, "d1", payload)
    assert draft.owner_id == "guest:g1"
    assert len(draft.messages_json) == 1
    assert draft.scores_json == [{"total_score": 70}]
    serialized = _serialize(draft, storage="browser")
    assert serialized["storage"] == "browser"
    assert serialized["messages"][0]["before"]["summary"] == "旧"
    assert serialized["messages"][0]["can_undo"] is True
    assert "before" not in _serialize(draft)["messages"][0]


def test_browser_draft_requires_payload():
    with pytest.raises(ValueError, match="resume_draft_required"):
        _draft_from_payload(GUEST, "d1", None)


def test_normalize_document_fills_schema_and_ids():
    document = normalize_document({"basics": {"name": "张三"}, "projects": [{"name": "智能客服", "details": "• 搭建 RAG"}, "bad"]})
    assert document["basics"]["name"] == "张三"
    assert document["basics"]["email"] == ""
    assert len(document["projects"]) == 1
    assert document["projects"][0]["id"]
    assert document["experience"] == []


def test_document_to_text_uses_section_headings():
    text = document_to_text({
        "basics": {"name": "张三", "email": "a@b.com"},
        "education": [{"school": "深圳大学", "degree": "本科", "major": "计算机", "period": "2020 - 2024"}],
        "skills": [{"name": "语言", "items": "Python、TypeScript"}],
    })
    assert "教育经历" in text
    assert "深圳大学 | 本科 | 计算机 | 2020 - 2024" in text
    assert "语言：Python、TypeScript" in text
    assert "项目经历" not in text


def test_reply_streamer_only_emits_reply_body():
    streamer = ReplyStreamer()
    chunks = ["<re", "ply>你好", "，已优化</re", "ply><changes>[\"a\"]</changes>"]
    emitted = "".join(streamer.feed(chunk) for chunk in chunks)
    assert emitted == "你好，已优化"


def test_parse_coach_output_with_resume():
    reply, changes, resume = parse_coach_output(
        '<reply>改好了</reply><changes>["重写项目"]</changes><resume>{"basics": {"name": "李四"}}</resume>'
    )
    assert reply == "改好了"
    assert changes == ["重写项目"]
    assert resume == {"basics": {"name": "李四"}}


def test_parse_coach_output_without_tags():
    reply, changes, resume = parse_coach_output("直接回答")
    assert reply == "直接回答"
    assert changes == []
    assert resume is None
