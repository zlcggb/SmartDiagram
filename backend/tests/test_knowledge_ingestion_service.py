from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.models.knowledge import KnowledgeChunk, KnowledgeDocument, KnowledgeIngestionJob
from app.services.knowledge_ingestion_service import ingest_uploaded_document, run_knowledge_ingestion_job


class _ScalarResult:
    def __init__(self, values):
        self.values = list(values)

    def scalars(self):
        return self

    def all(self):
        return list(self.values)


class _FakeSession:
    def __init__(self, job, document, existing_chunks):
        self.job = job
        self.document = document
        self.existing_chunks = existing_chunks
        self.rollback_count = 0
        self.commit_count = 0
        self.executed = []

    async def get(self, model, identifier):
        if model is KnowledgeIngestionJob and identifier == self.job.id:
            return self.job
        if model is KnowledgeDocument and identifier == self.document.id:
            return self.document
        return None

    async def execute(self, statement):
        self.executed.append(statement)
        if str(statement).lstrip().upper().startswith("SELECT"):
            return _ScalarResult(self.existing_chunks)
        return _ScalarResult([])

    async def flush(self):
        return None

    async def commit(self):
        self.commit_count += 1

    async def rollback(self):
        self.rollback_count += 1


def _records(status="failed"):
    document = KnowledgeDocument(
        id="doc-1",
        tenant_id="tenant-1",
        source_id="source-1",
        original_filename="brief.txt",
        mime_type="text/plain",
        storage_key="knowledge/brief.txt",
        status=status,
    )
    job = KnowledgeIngestionJob(
        id="job-1",
        tenant_id="tenant-1",
        source_id="source-1",
        document_id=document.id,
        status="queued",
    )
    return job, document


@pytest.mark.asyncio
async def test_retry_replaces_partial_chunks_instead_of_false_completion(tmp_path: Path):
    job, document = _records()
    partial = KnowledgeChunk(
        id="chunk-old",
        tenant_id="tenant-1",
        source_id="source-1",
        document_id=document.id,
        chunk_index=0,
        text="partial",
    )
    session = _FakeSession(job, document, [partial])
    source = tmp_path / "brief.txt"
    source.write_text("complete", encoding="utf-8")

    with (
        patch(
            "app.services.knowledge_ingestion_service.materialize_document_file",
            return_value=source,
        ),
        patch(
            "app.services.knowledge_ingestion_service.ingest_uploaded_document",
            new=AsyncMock(return_value={"chunk_count": 1}),
        ) as ingest,
    ):
        result = await run_knowledge_ingestion_job(session, job.id, tmp_path)

    assert result == {"chunk_count": 1}
    ingest.assert_awaited_once()
    assert any(str(statement).lstrip().upper().startswith("DELETE") for statement in session.executed)


@pytest.mark.asyncio
async def test_failed_ingestion_rolls_back_before_persisting_failure(tmp_path: Path):
    job, document = _records(status="uploaded")
    session = _FakeSession(job, document, [])
    source = tmp_path / "brief.txt"
    source.write_text("content", encoding="utf-8")

    async def fail_ingestion(*_args, **_kwargs):
        raise RuntimeError("parser exploded")

    with (
        patch(
            "app.services.knowledge_ingestion_service.materialize_document_file",
            return_value=source,
        ),
        patch(
            "app.services.knowledge_ingestion_service.ingest_uploaded_document",
            side_effect=fail_ingestion,
        ),
    ):
        result = await run_knowledge_ingestion_job(session, job.id, tmp_path)

    assert result == {"error": "parser exploded"}
    assert session.rollback_count == 1
    assert job.status == "failed"
    assert document.status == "failed"
    assert session.commit_count == 1


@pytest.mark.asyncio
async def test_vision_required_does_not_report_a_completed_job(tmp_path: Path):
    image_path = tmp_path / "chart.png"
    image_path.write_bytes(b"\x89PNG\r\n\x1a\n")
    document = KnowledgeDocument(
        id="doc-vision",
        tenant_id="tenant-1",
        source_id="source-1",
        original_filename="chart.png",
        mime_type="image/png",
        storage_key="knowledge/chart.png",
        status="uploaded",
    )
    job = KnowledgeIngestionJob(
        id="job-vision",
        tenant_id="tenant-1",
        source_id="source-1",
        document_id=document.id,
        status="queued",
    )

    stats = await ingest_uploaded_document(_FakeSession(job, document, []), document, job, image_path)

    assert stats["processing_status"] == "vision_required"
    assert document.status == "vision_required"
    assert job.status == "vision_required"
    assert job.stage == "vision_required"
