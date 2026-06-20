"""Knowledge ingestion orchestration."""

import hashlib
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.common import utc_now
from app.models.knowledge import (
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeEmbedding,
    KnowledgeIngestionJob,
)
from app.services.embedding_service import deterministic_embedding
from app.services.file_parser_service import parse_file
from app.services.knowledge_chunker import chunk_parsed_document
from app.services.knowledge_security_service import (
    evaluate_knowledge_security_policy,
    scan_knowledge_chunk_payload,
    summarize_policy,
)
from app.services.object_storage import get_object_storage
from app.services.pgvector_store import ensure_pgvector_schema, upsert_pgvector_embedding
from app.services.qdrant_store import get_qdrant_store, qdrant_point_payload


def _configured_vector_store_name() -> str:
    backend = settings.KNOWLEDGE_VECTOR_BACKEND.lower()
    if backend in {"pgvector", "qdrant"}:
        return backend
    return "local-hash"


def materialize_document_file(
    storage_root: str | Path,
    document: KnowledgeDocument,
) -> Path:
    """Ensure a knowledge document object is available as a local parse file."""

    file_path = Path(storage_root) / document.storage_key
    if file_path.exists():
        return file_path

    content = get_object_storage().get_object(document.storage_key)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(content)
    return file_path


async def ingest_uploaded_document(
    session: AsyncSession,
    document: KnowledgeDocument,
    job: KnowledgeIngestionJob,
    file_path: str | Path,
) -> dict:
    """Parse, chunk, and register embeddings for an uploaded document."""

    job.started_at = job.started_at or utc_now()
    job.status = "running"
    job.stage = "parsing"
    job.progress = 0.1
    document.status = "indexing"

    parsed = parse_file(file_path, document.mime_type, document.original_filename)
    job.stage = "chunking"
    job.progress = 0.35

    chunk_payloads = chunk_parsed_document(parsed)
    chunks: list[KnowledgeChunk] = []
    embeddings: list[KnowledgeEmbedding] = []
    security_counts = {
        "safe": 0,
        "flagged": 0,
        "high": 0,
    }

    for payload in chunk_payloads:
        security_scan = scan_knowledge_chunk_payload(payload)
        security_policy = evaluate_knowledge_security_policy(
            "\n".join(
                [
                    str(payload.get("heading_path") or ""),
                    str(payload.get("summary") or ""),
                    str(payload.get("text") or ""),
                ]
            ),
            scan=security_scan,
        )
        if security_scan["safe_for_prompt"]:
            security_counts["safe"] += 1
        else:
            security_counts["flagged"] += 1
        if security_scan["severity"] == "high":
            security_counts["high"] += 1

        chunk = KnowledgeChunk(
            tenant_id=document.tenant_id,
            team_id=document.team_id,
            project_id=document.project_id,
            source_id=document.source_id,
            document_id=document.id,
            chunk_index=payload["chunk_index"],
            heading_path=payload["heading_path"],
            source_locator=payload["source_locator"],
            text=payload["text"],
            summary=payload["summary"],
            token_count=payload["token_count"],
            status="active",
            classification=document.classification,
            created_by=document.created_by,
            acl_json=document.acl_json,
            metadata_json={
                **payload["metadata"],
                "security_scan": security_scan,
                "security_policy": summarize_policy(security_policy),
            },
        )
        session.add(chunk)
        chunks.append(chunk)

    await session.flush()

    vector_store_name = _configured_vector_store_name()
    for chunk, payload in zip(chunks, chunk_payloads, strict=True):
        embedding = deterministic_embedding(payload["text"])
        embeddings.append(
            KnowledgeEmbedding(
                tenant_id=document.tenant_id,
                chunk_id=chunk.id,
                vector_store=vector_store_name,
                vector_id=chunk.id,
                embedding_model=embedding["embedding_model"],
                dimensions=embedding["dimensions"],
                status="active",
                metadata_json={
                    "registered": True,
                    "vector": embedding["vector"],
                    "vector_source": "stored_embedding",
                    "text_hash": hashlib.sha256(payload["text"].encode("utf-8")).hexdigest(),
                },
            )
        )

    for embedding in embeddings:
        session.add(embedding)
    await session.flush()

    if vector_store_name == "pgvector":
        await ensure_pgvector_schema(session)
        for chunk, embedding in zip(chunks, embeddings, strict=True):
            vector = (embedding.metadata_json or {}).get("vector") or []
            await upsert_pgvector_embedding(
                session,
                chunk=chunk,
                embedding=embedding,
                vector=[float(value) for value in vector],
                metadata={
                    "source_id": chunk.source_id,
                    "document_id": chunk.document_id,
                    "source_locator": chunk.source_locator,
                    "classification": chunk.classification,
                },
            )
    elif vector_store_name == "qdrant":
        qdrant = get_qdrant_store()
        qdrant.ensure_collection(int(settings.KNOWLEDGE_VECTOR_DIMENSIONS))
        for chunk, embedding in zip(chunks, embeddings, strict=True):
            vector = [float(value) for value in ((embedding.metadata_json or {}).get("vector") or [])]
            qdrant.upsert(
                point_id=chunk.id,
                vector=vector,
                payload=qdrant_point_payload(
                    chunk=chunk,
                    embedding=embedding,
                    metadata={
                        "source_id": chunk.source_id,
                        "document_id": chunk.document_id,
                        "source_locator": chunk.source_locator,
                        "classification": chunk.classification,
                    },
                ),
            )

    document.status = "indexed"
    document.metadata_json = {
        **(document.metadata_json or {}),
        "security_scan": {
            "safe_chunk_count": security_counts["safe"],
            "flagged_chunk_count": security_counts["flagged"],
            "high_risk_chunk_count": security_counts["high"],
        },
    }
    job.status = "completed"
    job.stage = "completed"
    job.progress = 1.0
    job.ended_at = utc_now()
    job.stats_json = {
        **(job.stats_json or {}),
        "block_count": parsed["metadata"]["block_count"],
        "chunk_count": len(chunks),
        "embedding_count": len(embeddings),
        "security_scan": security_counts,
    }

    return {
        "block_count": parsed["metadata"]["block_count"],
        "chunk_count": len(chunks),
        "embedding_count": len(embeddings),
        "security_scan": security_counts,
    }


async def run_knowledge_ingestion_job(
    session: AsyncSession,
    job_id: str,
    storage_root: str | Path,
) -> dict:
    """Run a queued ingestion job and persist success or failure state."""

    job = await session.get(KnowledgeIngestionJob, job_id)
    if not job:
        raise ValueError(f"Knowledge ingestion job not found: {job_id}")
    if job.status == "completed":
        return job.stats_json or {}
    if not job.document_id:
        job.status = "failed"
        job.stage = "failed"
        job.error_message = "Ingestion job has no document_id."
        job.ended_at = utc_now()
        await session.commit()
        return job.stats_json or {}

    document = await session.get(KnowledgeDocument, job.document_id)
    if not document:
        job.status = "failed"
        job.stage = "failed"
        job.error_message = "Knowledge document not found."
        job.ended_at = utc_now()
        await session.commit()
        return job.stats_json or {}

    existing_chunks = list(
        (
            await session.execute(
                select(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id)
            )
        )
        .scalars()
        .all()
    )
    if existing_chunks:
        job.status = "completed"
        job.stage = "completed"
        job.progress = 1.0
        job.ended_at = job.ended_at or utc_now()
        await session.commit()
        return job.stats_json or {}

    try:
        file_path = materialize_document_file(storage_root, document)
        stats = await ingest_uploaded_document(session, document, job, file_path)
        await session.commit()
        return stats
    except Exception as exc:
        job.status = "failed"
        job.stage = "failed"
        job.progress = 1.0
        job.error_message = str(exc)
        job.ended_at = utc_now()
        document.status = "failed"
        await session.commit()
        return {
            "error": str(exc),
        }
