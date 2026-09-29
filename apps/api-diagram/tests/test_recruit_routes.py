import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api import routes_recruit
from app.services.auth_service import issue_auth_session
from app.services.guest_session_service import issue_guest_session_token
from app.services import recruit_search_service, recruit_service


def _client():
    app = FastAPI()
    app.include_router(routes_recruit.router, prefix="/api")
    return TestClient(app)


def test_dashboard_route_returns_service_payload(monkeypatch):
    async def fake_dashboard_summary(_session, permission_context):
        assert permission_context["tenant_id"] == "tenant-1"
        return {"summary": {"job_count": 2, "candidate_count": 3, "interview_count": 1, "strong_match_count": 1}}

    monkeypatch.setattr(routes_recruit, "dashboard_summary", fake_dashboard_summary)
    client = _client()

    response = client.get("/api/recruit/dashboard", headers={"x-tenant-id": "tenant-1"})

    assert response.status_code == 200
    assert response.json()["summary"]["job_count"] == 2


def test_create_job_route_forwards_json_payload(monkeypatch):
    async def fake_create_job(_session, _permission_context, body):
        assert body["title"] == "AI 应用产品工程师"
        assert body["recruitment_type"] == "campus"
        return {"job_id": "job-1", "title": body["title"], "recruitment_type": body["recruitment_type"]}

    monkeypatch.setattr(routes_recruit, "create_job", fake_create_job)
    client = _client()

    response = client.post(
        "/api/recruit/jobs",
        headers={"x-tenant-id": "tenant-1"},
        json={"title": "AI 应用产品工程师", "recruitment_type": "campus"},
    )

    assert response.status_code == 200
    assert response.json()["job_id"] == "job-1"
    assert response.json()["recruitment_type"] == "campus"


def test_recruitment_type_defaults_and_is_serialized():
    permission_context = {"tenant_id": "tenant-1"}
    campus_job = recruit_service._build_job(
        permission_context,
        {"title": "AI 应用产品工程师", "recruitment_type": "campus"},
    )
    legacy_job = recruit_service._build_job(permission_context, {"title": "AI 应用产品工程师"})

    assert recruit_service.serialize_job(campus_job)["recruitment_type"] == "campus"
    assert recruit_service.serialize_job(legacy_job)["recruitment_type"] == "unspecified"


@pytest.mark.parametrize("recruitment_type", ["internship", "校园招聘"])
def test_recruitment_type_rejects_unsupported_values(recruitment_type):
    with pytest.raises(ValueError, match="recruitment_type_invalid"):
        recruit_service._build_job(
            {"tenant_id": "tenant-1"},
            {"title": "AI 应用产品工程师", "recruitment_type": recruitment_type},
        )


def test_default_ai_job_route_is_idempotent_service_boundary(monkeypatch):
    async def fake_ensure_default_ai_job(_session, permission_context):
        assert permission_context["tenant_id"] == "tenant-1"
        return {"job_id": "default-ai", "title": "AI 应用产品工程师（业务系统方向）"}

    monkeypatch.setattr(routes_recruit, "ensure_default_ai_job", fake_ensure_default_ai_job)
    client = _client()

    response = client.post("/api/recruit/jobs/default-ai", headers={"x-tenant-id": "tenant-1"})

    assert response.status_code == 200
    assert response.json()["job_id"] == "default-ai"


def test_match_candidates_route_uses_tenant_scope_and_rubric(monkeypatch):
    async def fake_match_candidates(_session, permission_context, body):
        assert permission_context["tenant_id"] == "tenant-1"
        assert body["jd_title"] == "AI 工程师"
        assert body["rubric"]["version"] == "v3"
        return {"matches": [], "total": 0, "evaluated": 0}

    monkeypatch.setattr(routes_recruit, "match_candidates", fake_match_candidates)
    client = _client()

    response = client.post(
        "/api/recruit/matches",
        headers={"x-tenant-id": "tenant-1"},
        json={"jd_title": "AI 工程师", "jd_text": "React 和 Python", "rubric": {"version": "v3"}},
    )

    assert response.status_code == 200
    assert response.json()["matches"] == []


def test_search_conversations_can_be_listed_for_current_user(monkeypatch):
    async def fake_list_search_conversations(_session, permission_context):
        assert permission_context["tenant_id"] == "tenant-1"
        assert permission_context["user_id"] == "user-1"
        return [{"id": "search-1", "title": "AI 工程师", "status": "completed"}]

    monkeypatch.setattr(routes_recruit, "list_search_conversations", fake_list_search_conversations)
    token = issue_auth_session({
        "id": "user-1", "tenant_id": "tenant-1", "email": "user@example.com",
        "display_name": "User", "role": "member", "roles": ["member"], "scopes": [],
    })["access_token"]
    response = _client().get(
        "/api/recruit/search-conversations",
        headers={"authorization": f"Bearer {token}", "x-tenant-id": "other-tenant", "x-user-id": "other-user"},
    )

    assert response.status_code == 200
    assert response.json()[0]["id"] == "search-1"


def test_search_history_requires_identity_and_separates_guests(monkeypatch):
    async def fake_list(_session, context):
        return [{"id": context["guest_id"]}]

    monkeypatch.setattr(routes_recruit, "list_search_conversations", fake_list)
    client = _client()
    assert client.get("/api/recruit/search-conversations", headers={"x-user-id": "user-1"}).status_code == 401
    guest_a = issue_guest_session_token("guest-a")["access_token"]
    guest_b = issue_guest_session_token("guest-b")["access_token"]
    assert client.get("/api/recruit/search-conversations", headers={"authorization": f"Bearer {guest_a}"}).json()[0]["id"] == "guest-a"
    assert client.get("/api/recruit/search-conversations", headers={"authorization": f"Bearer {guest_b}"}).json()[0]["id"] == "guest-b"


def test_search_turn_is_queued_after_persisting(monkeypatch):
    events = []

    async def fake_create(_session, context, body):
        assert context["user_id"] == "user-1"
        assert body["jd_text"] == "React"
        events.append("persisted")
        return {"id": "search-1", "revision": 1, "status": "analyzing"}

    async def fake_run(conversation_id, context, revision):
        events.append((conversation_id, context["user_id"], revision))

    monkeypatch.setattr(routes_recruit, "create_search_conversation", fake_create)
    monkeypatch.setattr(routes_recruit, "run_search_conversation", fake_run)
    token = issue_auth_session({
        "id": "user-1", "tenant_id": "tenant-1", "email": "user@example.com",
        "display_name": "User", "role": "member", "roles": ["member"], "scopes": [],
    })["access_token"]
    response = _client().post(
        "/api/recruit/search-conversations", json={"jd_text": "React", "message": "找 React 工程师"},
        headers={"authorization": f"Bearer {token}"},
    )
    assert response.status_code == 202
    assert events == ["persisted", ("search-1", "user-1", 1)]


def test_background_search_writes_rubric_and_results(monkeypatch):
    conversation = SimpleNamespace(
        revision=2, jd_title="AI 工程师", jd_text="React", turns_json=[{"id": 1, "rubric": None}],
    )

    class FakeSession:
        async def get(self, _model, _id):
            return conversation

    @asynccontextmanager
    async def fake_session():
        yield FakeSession()

    async def fake_rubric(_title, _text):
        return {"version": "v3"}

    async def fake_match(_session, context, body, progress=None):
        assert context["project_id"] is None
        assert body["rubric"]["version"] == "v3"
        assert progress is not None
        await progress({"node": "resume_scan", "status": "started", "message": "正在读取人才库简历"})
        await progress({"node": "resume_scan", "status": "completed", "message": "简历读取完成"})
        return {"matches": [], "total": 2, "evaluated": 0}

    updates = []

    async def fake_update(_id, _revision, **changes):
        updates.append(changes)
        return True

    monkeypatch.setattr(recruit_search_service, "async_session", fake_session)
    monkeypatch.setattr(recruit_search_service, "generate_rubric", fake_rubric)
    monkeypatch.setattr(recruit_search_service, "match_candidates", fake_match)
    monkeypatch.setattr(recruit_search_service, "_update_job", fake_update)
    asyncio.run(recruit_search_service.run_search_conversation("search-1", {"project_id": "local-project"}, 2))
    progress_events = [update["progress_event"] for update in updates if "progress_event" in update]
    assert [(event["node"], event["status"]) for event in progress_events] == [
        ("requirements", "started"),
        ("requirements", "completed"),
        ("resume_scan", "started"),
        ("resume_scan", "completed"),
        ("ranking", "completed"),
    ]
    assert updates[1]["rubric"] == {"version": "v3"}
    assert updates[1]["status"] == "matching"
    assert updates[-1]["status"] == "completed"
    assert updates[-1]["matches"] == {"matches": [], "total": 2, "evaluated": 0}


def test_match_candidates_emits_retrieval_and_per_candidate_progress(monkeypatch):
    candidates = [
        SimpleNamespace(id="candidate-1", full_name="候选人甲", project_id=None),
        SimpleNamespace(id="candidate-2", full_name="候选人乙", project_id=None),
    ]
    resumes = [
        SimpleNamespace(candidate_id="candidate-1", parsed_text="React Python", filename="a.pdf"),
        SimpleNamespace(candidate_id="candidate-2", parsed_text="React", filename="b.pdf"),
    ]

    class FakeResult:
        def __init__(self, rows):
            self.rows = rows

        def scalars(self):
            return SimpleNamespace(all=lambda: self.rows)

    class FakeSession:
        def __init__(self):
            self.query_count = 0

        async def execute(self, _statement):
            self.query_count += 1
            return FakeResult(candidates if self.query_count == 1 else resumes)

    async def allow_read(_session, _context, _project_id):
        return None

    async def fake_screen(candidate_name, **_kwargs):
        return {
            "total_score": 70 if candidate_name == "候选人甲" else 95,
            "max_score": 100,
            "evaluation_mode": "ai",
        }

    monkeypatch.setattr(recruit_service, "_ensure_read_access", allow_read)
    monkeypatch.setattr(recruit_service, "parse_rubric_json", lambda *_args, **_kwargs: {"requirements": [{"signals": ["React"]}]})
    monkeypatch.setattr(recruit_service, "extract_keywords", lambda _text: ["react", "python"])
    monkeypatch.setattr(recruit_service, "screen_candidate_profile", fake_screen)
    monkeypatch.setattr(recruit_service, "serialize_candidate", lambda candidate: {
        "candidate_id": candidate.id,
        "full_name": candidate.full_name,
    })
    events = []

    async def record_progress(event):
        events.append(event)

    result = asyncio.run(recruit_service.match_candidates(
        FakeSession(),
        {"tenant_id": "tenant-1", "project_id": None},
        {"jd_title": "工程师", "jd_text": "React", "rubric": {"version": "v3"}},
        progress=record_progress,
    ))

    milestones = [(event["node"], event["status"]) for event in events if event["status"] != "progress"]
    assert milestones == [
        ("resume_scan", "started"),
        ("resume_scan", "completed"),
        ("keyword_retrieval", "started"),
        ("keyword_retrieval", "completed"),
        ("evaluation", "started"),
        ("evaluation", "completed"),
        ("ranking", "started"),
    ]
    assert events[1]["data"] == {"candidate_count": 2, "readable_resume_count": 2}
    assert events[3]["data"]["keyword_terms"] == ["python", "react"]
    candidate_events = [event for event in events if "candidate_name" in event.get("data", {})]
    assert [(event["data"]["candidate_name"], event["data"]["evaluation_status"]) for event in candidate_events] == [
        ("候选人甲", "evaluating"),
        ("候选人甲", "completed"),
        ("候选人乙", "evaluating"),
        ("候选人乙", "completed"),
    ]
    assert [item["candidate"]["full_name"] for item in result["matches"]] == ["候选人乙", "候选人甲"]


def test_search_progress_stream_replays_after_last_event_id(monkeypatch):
    calls = []
    progress_event = {
        "id": 2,
        "node": "evaluation",
        "status": "progress",
        "message": "候选人评估完成",
        "data": {"candidate_name": "候选人甲", "score": 82},
    }

    async def fake_get_conversation(_session, context, conversation_id):
        assert context["user_id"] == "user-1"
        assert conversation_id == "search-1"
        return {"id": conversation_id}

    async def fake_event_batch(conversation_id, _context, after_id):
        calls.append((conversation_id, after_id))
        return ([progress_event] if after_id == 1 else []), "completed"

    monkeypatch.setattr(routes_recruit, "get_search_conversation", fake_get_conversation)
    monkeypatch.setattr(routes_recruit, "get_search_event_batch", fake_event_batch)
    token = issue_auth_session({
        "id": "user-1", "tenant_id": "tenant-1", "email": "user@example.com",
        "display_name": "User", "role": "member", "roles": ["member"], "scopes": [],
    })["access_token"]
    client = _client()

    assert client.get("/api/recruit/search-conversations/search-1/events").status_code == 401
    response = client.get(
        "/api/recruit/search-conversations/search-1/events",
        headers={"authorization": f"Bearer {token}", "Last-Event-ID": "1"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "id: 2" in response.text
    assert '"candidate_name": "候选人甲"' in response.text
    assert calls == [("search-1", 1), ("search-1", 2)]


def test_retry_search_resets_progress_event_cursor(monkeypatch):
    conversation = SimpleNamespace(
        id="search-1",
        status="completed",
        turns_json=[{
            "id": 1,
            "text": "继续找 React 工程师",
            "status": "completed",
            "rubric": {"version": "v3"},
            "matches": {"matches": [], "total": 2, "evaluated": 2},
            "events": [{"id": 19, "node": "ranking", "status": "completed", "message": "旧结果"}],
        }],
        jd_title="工程师",
        jd_text="React",
        revision=4,
    )

    async def fake_get_conversation(_session, _context, _conversation_id):
        return conversation

    class FakeSession:
        async def commit(self):
            return None

    monkeypatch.setattr(recruit_search_service, "_get_conversation", fake_get_conversation)
    monkeypatch.setattr(recruit_search_service, "parse_rubric_json", lambda *_args, **_kwargs: {"requirements": [], "knockouts": []})
    monkeypatch.setattr(recruit_search_service, "_serialize", lambda item: {
        "id": item.id,
        "status": item.status,
        "revision": item.revision,
        "turns": item.turns_json,
    })

    result = asyncio.run(recruit_search_service.retry_search_turn(
        FakeSession(), {}, "search-1", {"rubric": {"version": "v3"}},
    ))

    assert result["status"] == "matching"
    assert result["revision"] == 5
    assert result["turns"][-1]["events"] == []


def test_resume_preview_returns_automatically_extracted_profile(monkeypatch):
    async def fake_parsed_upload(_file, **_):
        return {
            "blocks": [
                {
                    "source_locator": "pdf:page=1",
                    "text": "何勋杰\n邮箱：ada@example.com\n联系电话：13538059262",
                }
            ],
            "metadata": {"processing_status": "parsed"},
        }, "resume.pdf", "application/pdf", "hash", None

    monkeypatch.setattr(routes_recruit, "_parsed_upload", fake_parsed_upload)
    client = _client()

    response = client.post(
        "/api/recruit/resume-preview",
        headers={"x-tenant-id": "tenant-1"},
        files={"file": ("resume.pdf", b"%PDF-1.7", "application/pdf")},
    )

    assert response.status_code == 200
    assert response.json()["profile"]["full_name"] == "何勋杰"
    assert response.json()["profile"]["email"] == "ada@example.com"


def test_resume_preview_rejects_unverified_extraction(monkeypatch):
    async def fake_parsed_upload(_file, **_):
        return {
            "blocks": [{"type": "text", "text": "姓名：周刘成\n乱码\u0378\u0378\u0378\u0378"}],
            "metadata": {
                "processing_status": "review_required",
                "extraction": {"quality": "poor", "verified": False, "warnings": ["PDF 文字层损坏"]},
            },
        }, "resume.pdf", "application/pdf", "hash", None

    monkeypatch.setattr(routes_recruit, "_parsed_upload", fake_parsed_upload)
    response = _client().post(
        "/api/recruit/resume-preview",
        headers={"x-tenant-id": "tenant-1"},
        files={"file": ("resume.pdf", b"%PDF-1.7", "application/pdf")},
    )

    assert response.status_code == 422
    assert "质量" in response.json()["detail"]


def test_stream_parse_does_not_report_unverified_text_as_complete(monkeypatch, tmp_path):
    path = tmp_path / "resume.pdf"
    path.write_bytes(b"%PDF-1.7")

    async def fake_extract(*_args, **_kwargs):
        return {
            "blocks": [],
            "metadata": {
                "processing_status": "review_required",
                "extraction": {"quality": "poor", "verified": False, "warnings": ["OCR 失败"]},
            },
        }

    monkeypatch.setattr(routes_recruit, "extract_resume_document", fake_extract)
    events = []

    async def progress(event):
        events.append(event)

    staged = SimpleNamespace(path=path, mime_type="application/pdf", safe_filename="resume.pdf")
    try:
        asyncio.run(routes_recruit._stream_parse(staged, None, progress))
    except ValueError as error:
        assert "质量" in str(error)
    else:
        raise AssertionError("unverified resume text must not be accepted")

    assert not any(event.get("status") == "done" for event in events)


def test_jd_preview_extracts_uploaded_text(monkeypatch):
    async def fake_parsed_upload(_file, **_):
        return {"blocks": [{"text": "招聘 React 和 Python 工程师"}]}, "job.pdf", "application/pdf", "hash", None

    monkeypatch.setattr(routes_recruit, "_parsed_upload", fake_parsed_upload)
    client = _client()

    response = client.post(
        "/api/recruit/jd-preview",
        headers={"x-tenant-id": "tenant-1"},
        files={"file": ("job.pdf", b"%PDF-1.7", "application/pdf")},
    )

    assert response.status_code == 200
    assert "React" in response.json()["parsed_text"]


def test_create_candidate_route_accepts_form_and_file(monkeypatch):
    async def fake_create_candidate(_session, _permission_context, **kwargs):
        assert kwargs["body"]["job_id"] == "job-1"
        assert kwargs["source_name"] == "resume.txt"
        return {"candidate_id": "candidate-1", "full_name": kwargs["body"]["full_name"]}

    monkeypatch.setattr(routes_recruit, "create_candidate", fake_create_candidate)
    async def fake_parsed_upload(_file, **_):
        return {"blocks": [{"text": "resume"}], "metadata": {}}, "resume.txt", "text/plain", "hash", None

    monkeypatch.setattr(routes_recruit, "_parsed_upload", fake_parsed_upload)
    client = _client()

    response = client.post(
        "/api/recruit/candidates",
        headers={"x-tenant-id": "tenant-1"},
        data={"job_id": "job-1", "full_name": "Ada"},
        files={"file": ("resume.txt", b"resume", "text/plain")},
    )

    assert response.status_code == 200
    assert response.json()["candidate_id"] == "candidate-1"


def test_create_candidate_rejects_unverified_resume_before_persisting(monkeypatch, tmp_path):
    staged_path = tmp_path / "resume.pdf"
    staged_path.write_bytes(b"%PDF-1.7")

    async def unexpected_create(*_args, **_kwargs):
        raise AssertionError("unverified resume must not be persisted")

    async def fake_parsed_upload(_file, **_):
        return {
            "blocks": [{"type": "text", "text": "姓名：周刘成\n乱码\u0378\u0378\u0378\u0378"}],
            "metadata": {
                "processing_status": "review_required",
                "extraction": {"quality": "poor", "verified": False, "warnings": ["PDF 文字层损坏"]},
            },
        }, "resume.pdf", "application/pdf", "hash", SimpleNamespace(path=staged_path)

    monkeypatch.setattr(routes_recruit, "create_candidate", unexpected_create)
    monkeypatch.setattr(routes_recruit, "_parsed_upload", fake_parsed_upload)
    response = _client().post(
        "/api/recruit/candidates",
        headers={"x-tenant-id": "tenant-1"},
        data={"job_id": "job-1"},
        files={"file": ("resume.pdf", b"%PDF-1.7", "application/pdf")},
    )

    assert response.status_code == 422
    assert staged_path.exists() is False


def test_update_candidate_profile_forwards_editable_profile(monkeypatch):
    async def fake_update_candidate_profile(_session, permission_context, candidate_id, body):
        assert permission_context["tenant_id"] == "tenant-1"
        assert candidate_id == "candidate-1"
        assert body["full_name"] == "Ada Lovelace"
        assert body["profile"]["skills"] == ["Python", "RAG"]
        return {"candidate_id": candidate_id, "full_name": body["full_name"]}

    monkeypatch.setattr(routes_recruit, "update_candidate_profile", fake_update_candidate_profile)
    client = _client()

    response = client.patch(
        "/api/recruit/candidates/candidate-1",
        headers={"x-tenant-id": "tenant-1"},
        json={
            "full_name": "Ada Lovelace",
            "profile": {"skills": ["Python", "RAG"]},
        },
    )

    assert response.status_code == 200
    assert response.json()["full_name"] == "Ada Lovelace"


def test_screening_workbench_persists_jd_and_resume(monkeypatch):
    async def fake_create_screening_workflow(_session, _permission_context, **kwargs):
        assert kwargs["body"]["jd_title"] == "AI 应用工程师"
        assert kwargs["source_name"] == "resume.pdf"
        return {
            "job": {"job_id": "job-1"},
            "candidate": {"candidate_id": "candidate-1"},
            "screening": {"total_score": 88},
        }

    monkeypatch.setattr(routes_recruit, "create_screening_workflow", fake_create_screening_workflow)

    async def fake_parsed_upload(_file, **_):
        return {"blocks": [{"text": "resume"}], "metadata": {}}, "resume.pdf", "application/pdf", "hash", None

    monkeypatch.setattr(routes_recruit, "_parsed_upload", fake_parsed_upload)
    client = _client()

    response = client.post(
        "/api/recruit/workbench",
        headers={"x-tenant-id": "tenant-1"},
        data={
            "jd_title": "AI 应用工程师",
            "jd_text": "需要 AI 与前端交付能力",
            "candidate_name": "Ada",
            "resume_text": "",
        },
        files={"file": ("resume.pdf", b"%PDF-1.7", "application/pdf")},
    )

    assert response.status_code == 200
    assert response.json()["candidate"]["candidate_id"] == "candidate-1"
