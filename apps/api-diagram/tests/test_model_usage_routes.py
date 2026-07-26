from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import routes_billing


class _FakeSession:
    async def commit(self):
        return None

    async def rollback(self):
        return None


def _client(monkeypatch, *, secret="shared-secret"):
    app = FastAPI()
    app.include_router(routes_billing.router, prefix="/api")
    session = _FakeSession()

    async def override_session():
        yield session

    async def authenticated(_request, _session):
        return (
            {
                "id": "user-1",
                "tenant_id": "tenant-1",
                "roles": ["member"],
                "scopes": [],
            },
            object(),
        )

    monkeypatch.setattr(routes_billing.settings, "PPT_INTERNAL_API_SECRET", secret)
    monkeypatch.setattr(routes_billing, "_authenticated_db_user", authenticated)
    app.dependency_overrides[routes_billing.get_session] = override_session
    return TestClient(app), session


def _event_body():
    return {
        "external_event_id": "evt-1",
        "tenant_id": "attacker-tenant",
        "user_id": "attacker-user",
        "project_id": "ppt-1",
        "slide_id": "slide-1",
        "source": "ppt",
        "stage": "svg",
        "provider": "openai-compatible",
        "model": "model-a",
        "status": "succeeded",
        "input_tokens": 100,
        "output_tokens": 25,
        "total_tokens": 125,
        "usage_available": True,
        "duration_ms": 50,
        "output_summary": "第 1 页设计稿",
        "started_at": "2026-07-25T08:00:00",
        "ended_at": "2026-07-25T08:00:01",
    }


def test_ingest_requires_internal_secret(monkeypatch):
    client, _ = _client(monkeypatch)

    response = client.post(
        "/api/billing/model-usage-events",
        headers={"Authorization": "Bearer user-token"},
        json=_event_body(),
    )

    assert response.status_code == 403


def test_ingest_derives_identity_and_is_idempotent(monkeypatch):
    client, _ = _client(monkeypatch)
    captured = []

    async def pricing(_session, _env_raw):
        return {"model-a": {"input": 0.1, "output": 0.2, "cache": 0.05, "currency": "CNY"}}

    async def persist(_session, *, tenant_id, user_id, payload, pricing):
        captured.append((tenant_id, user_id, payload, pricing))
        return {"id": "row-1", "external_event_id": payload["external_event_id"]}, len(captured) == 1

    monkeypatch.setattr(routes_billing, "resolve_model_pricing", pricing)
    monkeypatch.setattr(routes_billing, "persist_model_usage_event", persist)

    headers = {
        "Authorization": "Bearer user-token",
        "X-PPT-Internal-Secret": "shared-secret",
    }
    first = client.post("/api/billing/model-usage-events", headers=headers, json=_event_body())
    second = client.post("/api/billing/model-usage-events", headers=headers, json=_event_body())

    assert first.status_code == 200
    assert first.json()["created"] is True
    assert second.status_code == 200
    assert second.json()["created"] is False
    assert captured[0][0:2] == ("tenant-1", "user-1")
    assert captured[0][2].get("tenant_id") is None
    assert captured[0][2].get("user_id") is None
    assert captured[0][3]["model-a"]["currency"] == "CNY"


def test_query_returns_month_project_summary_and_events(monkeypatch):
    client, _ = _client(monkeypatch)

    async def summarize(_session, *, tenant_id, user_id, period, project_id, limit, offset):
        assert (tenant_id, user_id, period, project_id, limit, offset) == (
            "tenant-1",
            "user-1",
            "2026-07",
            "ppt-1",
            20,
            0,
        )
        return {
            "period": "2026-07",
            "summary": {"call_count": 2, "total_tokens": 125, "estimated_cost": 0.01},
            "project_summary": {"call_count": 1, "total_tokens": 75, "estimated_cost": 0.006},
            "events": [
                {
                    "id": "row-1",
                    "started_at": datetime(2026, 7, 25, 8, 0, 0).isoformat(),
                    "model": "model-a",
                }
            ],
            "total": 1,
        }

    async def budget(*_args, **_kwargs):
        return {"budget": {"monthly_token_limit": 5_000_000}}

    monkeypatch.setattr(routes_billing, "get_model_usage_dashboard", summarize)
    monkeypatch.setattr(routes_billing, "get_budget_metrics_snapshot", budget)

    response = client.get(
        "/api/billing/me/model-usage",
        headers={"Authorization": "Bearer user-token"},
        params={"period": "2026-07", "project_id": "ppt-1", "limit": 20},
    )

    assert response.status_code == 200
    assert response.json()["summary"]["call_count"] == 2
    assert response.json()["project_summary"]["call_count"] == 1
    assert response.json()["budget"]["monthly_token_limit"] == 5_000_000
