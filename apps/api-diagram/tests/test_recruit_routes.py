from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import routes_recruit


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
        return {"job_id": "job-1", "title": body["title"]}

    monkeypatch.setattr(routes_recruit, "create_job", fake_create_job)
    client = _client()

    response = client.post(
        "/api/recruit/jobs",
        headers={"x-tenant-id": "tenant-1"},
        json={"title": "AI 应用产品工程师"},
    )

    assert response.status_code == 200
    assert response.json()["job_id"] == "job-1"


def test_default_ai_job_route_is_idempotent_service_boundary(monkeypatch):
    async def fake_ensure_default_ai_job(_session, permission_context):
        assert permission_context["tenant_id"] == "tenant-1"
        return {"job_id": "default-ai", "title": "AI 应用产品工程师（业务系统方向）"}

    monkeypatch.setattr(routes_recruit, "ensure_default_ai_job", fake_ensure_default_ai_job)
    client = _client()

    response = client.post("/api/recruit/jobs/default-ai", headers={"x-tenant-id": "tenant-1"})

    assert response.status_code == 200
    assert response.json()["job_id"] == "default-ai"


def test_resume_preview_returns_automatically_extracted_profile(monkeypatch):
    async def fake_parsed_upload(_file):
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


def test_create_candidate_route_accepts_form_and_file(monkeypatch):
    async def fake_create_candidate(_session, _permission_context, **kwargs):
        assert kwargs["body"]["job_id"] == "job-1"
        assert kwargs["source_name"] == "resume.txt"
        return {"candidate_id": "candidate-1", "full_name": kwargs["body"]["full_name"]}

    monkeypatch.setattr(routes_recruit, "create_candidate", fake_create_candidate)
    async def fake_parsed_upload(_file):
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

    async def fake_parsed_upload(_file):
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
