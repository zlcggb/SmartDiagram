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
