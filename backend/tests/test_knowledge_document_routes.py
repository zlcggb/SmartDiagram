from collections import deque

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import routes_knowledge
from app.models.knowledge import KnowledgeChunk, KnowledgeDocument, KnowledgeIngestionJob


class _ScalarResult:
    def __init__(self, values):
        self.values = list(values)

    def scalars(self):
        return self

    def all(self):
        return list(self.values)

    def first(self):
        return self.values[0] if self.values else None


class _FakeSession:
    def __init__(self, document, results=(), jobs=()):
        self.document = document
        self.jobs = {job.id: job for job in jobs}
        self.results = deque(_ScalarResult(result) for result in results)

    async def get(self, model, identifier):
        if model is KnowledgeDocument and identifier == self.document.id:
            return self.document
        if model is KnowledgeIngestionJob:
            return self.jobs.get(identifier)
        return None

    async def execute(self, _statement):
        return self.results.popleft() if self.results else _ScalarResult([])


def _document(status="indexed"):
    return KnowledgeDocument(
        id="doc-1",
        tenant_id="tenant-1",
        team_id="team-1",
        project_id="project-1",
        source_id="source-1",
        title="经营复盘",
        original_filename="经营复盘.pptx",
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        storage_key="knowledge/deck.pptx",
        content_hash="a" * 64,
        status=status,
        acl_json={"roles": ["owner"]},
        metadata_json={"size_bytes": 1024, "route_mode": "full-context"},
    )


def _client(monkeypatch, session):
    app = FastAPI()
    app.include_router(routes_knowledge.router, prefix="/api")

    async def override_session():
        yield session

    async def allow_project(*_args, **_kwargs):
        return True

    async def allow_acl(*_args, **_kwargs):
        return True

    app.dependency_overrides[routes_knowledge.get_session] = override_session
    monkeypatch.setattr(routes_knowledge, "can_access_project", allow_project)
    monkeypatch.setattr(
        routes_knowledge,
        "explicit_acl_allows_knowledge",
        allow_acl,
        raising=False,
    )
    return TestClient(app)


def _params(scopes="knowledge:read"):
    return {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "team_id": "team-1",
        "project_id": "project-1",
        "roles": "owner",
        "scopes": scopes,
    }


def test_document_detail_is_authorized_and_reports_latest_job(monkeypatch):
    document = _document()
    job = KnowledgeIngestionJob(
        id="job-1",
        tenant_id="tenant-1",
        source_id=document.source_id,
        document_id=document.id,
        status="completed",
        stage="completed",
        progress=1.0,
    )
    client = _client(monkeypatch, _FakeSession(document, results=[[job]]))

    response = client.get(f"/api/knowledge/documents/{document.id}", params=_params())

    assert response.status_code == 200
    body = response.json()
    assert body["document_id"] == document.id
    assert body["job_id"] == job.id
    assert body["ingestion_job_id"] == job.id
    assert body["original_filename"] == "经营复盘.pptx"
    assert body["route_mode"] == "full-context"


def test_document_detail_requires_knowledge_read_scope(monkeypatch):
    document = _document()
    client = _client(monkeypatch, _FakeSession(document))

    response = client.get(
        f"/api/knowledge/documents/{document.id}",
        params=_params(scopes="diagram:read"),
    )

    assert response.status_code == 403


def test_document_chunks_are_paginated_and_cited(monkeypatch):
    document = _document()
    chunks = [
        KnowledgeChunk(
            id=f"chunk-{index}",
            tenant_id="tenant-1",
            team_id="team-1",
            project_id="project-1",
            source_id=document.source_id,
            document_id=document.id,
            chunk_index=index,
            text=f"slide {index}",
            summary=f"summary {index}",
            source_locator=f"pptx:slide={index + 1}",
            token_count=10,
            metadata_json={"part_index": 1},
        )
        for index in range(2)
    ]
    client = _client(monkeypatch, _FakeSession(document, results=[chunks]))

    response = client.get(
        f"/api/knowledge/documents/{document.id}/chunks",
        params={**_params(), "cursor": 0, "limit": 1},
    )

    assert response.status_code == 200
    body = response.json()
    assert [chunk["chunk_id"] for chunk in body["chunks"]] == ["chunk-0"]
    assert body["chunks"][0]["citation"] == {
        "source_id": "source-1",
        "document_id": "doc-1",
        "source_locator": "pptx:slide=1",
    }
    assert body["next_cursor"] == 1
    assert body["has_more"] is True


def test_document_chunks_report_not_ready_instead_of_empty_success(monkeypatch):
    document = _document(status="indexing")
    job = KnowledgeIngestionJob(
        id="job-1",
        tenant_id="tenant-1",
        source_id=document.source_id,
        document_id=document.id,
        status="running",
        stage="parsing",
        progress=0.25,
    )
    client = _client(monkeypatch, _FakeSession(document, results=[[job]]))

    response = client.get(
        f"/api/knowledge/documents/{document.id}/chunks",
        params=_params(),
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "document_not_ready"
    assert response.json()["detail"]["job_id"] == "job-1"


def test_ingestion_job_enforces_the_document_acl(monkeypatch):
    document = _document()
    job = KnowledgeIngestionJob(
        id="job-1",
        tenant_id="tenant-1",
        source_id=document.source_id,
        document_id=document.id,
        status="running",
        stage="parsing",
        progress=0.25,
    )
    client = _client(monkeypatch, _FakeSession(document, jobs=[job]))

    async def deny_acl(*_args, **_kwargs):
        return False

    monkeypatch.setattr(routes_knowledge, "explicit_acl_allows_knowledge", deny_acl)

    response = client.get(
        f"/api/knowledge/ingestion-jobs/{job.id}",
        params=_params(),
    )

    assert response.status_code == 403


def test_upload_route_uses_material_gateway_and_accepts_ppt_parse_headers(monkeypatch):
    document = _document()
    client = _client(monkeypatch, _FakeSession(document))
    headers = {
        "x-tenant-id": "tenant-1",
        "x-user-id": "user-1",
        "x-team-id": "team-1",
        "x-project-id": "project-1",
        "x-roles": "owner",
        "x-scopes": "knowledge:read,knowledge:write",
        "x-ingestion-mode": "background",
        "x-parse-profile": "deep",
        "x-route-mode": "auto",
    }

    response = client.post(
        "/api/knowledge/documents",
        headers=headers,
        files={
            "file": (
                "spoofed.pptx",
                b"%PDF-1.7\n",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            )
        },
    )

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "file_signature_mismatch"
