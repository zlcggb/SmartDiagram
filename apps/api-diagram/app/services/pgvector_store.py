"""Optional pgvector-backed knowledge vector store."""

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.knowledge import KnowledgeChunk, KnowledgeEmbedding
from app.state.agent_runtime import PermissionContext


def vector_to_pgvector_literal(vector: list[float]) -> str:
    """Serialize a Python vector to pgvector's text input format."""

    values = []
    for value in vector:
        numeric = float(value)
        if numeric != numeric or numeric in {float("inf"), float("-inf")}:
            numeric = 0.0
        values.append(f"{numeric:.8f}")
    return "[" + ",".join(values) + "]"


async def ensure_pgvector_schema(session: AsyncSession) -> None:
    """Create the optional pgvector extension/table when enabled."""

    dimensions = int(settings.KNOWLEDGE_VECTOR_DIMENSIONS)
    await session.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    await session.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS knowledge_embedding_vectors (
                chunk_id text PRIMARY KEY,
                tenant_id text NOT NULL,
                team_id text NULL,
                project_id text NULL,
                source_id text NOT NULL,
                document_id text NOT NULL,
                source_locator text NOT NULL DEFAULT '',
                embedding vector({dimensions}) NOT NULL,
                embedding_model text NOT NULL DEFAULT '',
                metadata_json jsonb NOT NULL DEFAULT '{{}}'::jsonb,
                updated_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
    )
    await session.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_vectors_tenant "
            "ON knowledge_embedding_vectors (tenant_id)"
        )
    )


async def upsert_pgvector_embedding(
    session: AsyncSession,
    *,
    chunk: KnowledgeChunk,
    embedding: KnowledgeEmbedding,
    vector: list[float],
    metadata: dict[str, Any],
) -> None:
    """Upsert one chunk embedding into the pgvector table."""

    await session.execute(
        text(
            """
            INSERT INTO knowledge_embedding_vectors (
                chunk_id,
                tenant_id,
                team_id,
                project_id,
                source_id,
                document_id,
                source_locator,
                embedding,
                embedding_model,
                metadata_json,
                updated_at
            )
            VALUES (
                :chunk_id,
                :tenant_id,
                :team_id,
                :project_id,
                :source_id,
                :document_id,
                :source_locator,
                CAST(:embedding AS vector),
                :embedding_model,
                CAST(:metadata_json AS jsonb),
                now()
            )
            ON CONFLICT (chunk_id) DO UPDATE SET
                tenant_id = EXCLUDED.tenant_id,
                team_id = EXCLUDED.team_id,
                project_id = EXCLUDED.project_id,
                source_id = EXCLUDED.source_id,
                document_id = EXCLUDED.document_id,
                source_locator = EXCLUDED.source_locator,
                embedding = EXCLUDED.embedding,
                embedding_model = EXCLUDED.embedding_model,
                metadata_json = EXCLUDED.metadata_json,
                updated_at = now()
            """
        ),
        {
            "chunk_id": chunk.id,
            "tenant_id": chunk.tenant_id,
            "team_id": chunk.team_id,
            "project_id": chunk.project_id,
            "source_id": chunk.source_id,
            "document_id": chunk.document_id,
            "source_locator": chunk.source_locator,
            "embedding": vector_to_pgvector_literal(vector),
            "embedding_model": embedding.embedding_model,
            "metadata_json": json.dumps(metadata),
        },
    )


async def search_pgvector_candidates(
    session: AsyncSession,
    *,
    query_vector: list[float],
    permission_context: PermissionContext,
    top_k: int,
) -> list[dict[str, Any]]:
    """Search pgvector nearest neighbors with tenant/team/project filters."""

    tenant_id = permission_context.get("tenant_id")
    if not tenant_id:
        return []

    clauses = ["tenant_id = :tenant_id"]
    params: dict[str, Any] = {
        "tenant_id": tenant_id,
        "query_vector": vector_to_pgvector_literal(query_vector),
        "limit": max(top_k, 1),
    }
    if permission_context.get("project_id"):
        clauses.append("(project_id IS NULL OR project_id = :project_id)")
        params["project_id"] = permission_context["project_id"]
    if permission_context.get("team_id"):
        clauses.append("(team_id IS NULL OR team_id = :team_id)")
        params["team_id"] = permission_context["team_id"]

    statement = text(
        f"""
        SELECT
            chunk_id,
            source_id,
            document_id,
            source_locator,
            embedding_model,
            metadata_json,
            1 - (embedding <=> CAST(:query_vector AS vector)) AS score
        FROM knowledge_embedding_vectors
        WHERE {' AND '.join(clauses)}
        ORDER BY embedding <=> CAST(:query_vector AS vector)
        LIMIT :limit
        """
    )
    rows = (await session.execute(statement, params)).mappings().all()
    return [
        {
            "chunk_id": row["chunk_id"],
            "score": float(row["score"] or 0.0),
            "source_id": row["source_id"],
            "document_id": row["document_id"],
            "source_locator": row["source_locator"],
            "embedding_model": row["embedding_model"],
            "metadata": row["metadata_json"] or {},
        }
        for row in rows
    ]
