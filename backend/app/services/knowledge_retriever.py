"""Permission-aware knowledge retrieval helpers."""

import re
from typing import Any, TypedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.knowledge import KnowledgeChunk, KnowledgeEmbedding
from app.services.embedding_service import deterministic_embedding
from app.services.knowledge_acl_service import explicit_acl_allows_knowledge
from app.services.knowledge_security_service import (
    evaluate_knowledge_security_policy,
    scan_knowledge_text,
    summarize_policy,
    summarize_scan,
)
from app.services.vector_store import InMemoryVectorStore
from app.services.pgvector_store import search_pgvector_candidates
from app.services.qdrant_store import get_qdrant_store
from app.state.agent_runtime import PermissionContext


class KnowledgeChunkContext(TypedDict):
    chunk_id: str
    text: str
    score: float
    citation: dict[str, Any]
    metadata: dict[str, Any]


def build_metadata_filter(permission_context: PermissionContext) -> dict[str, Any]:
    """Build the first-pass metadata filter for vector retrieval."""

    filters: dict[str, Any] = {
        "tenant_id": permission_context.get("tenant_id"),
    }
    if permission_context.get("project_id"):
        filters["project_id"] = permission_context["project_id"]
    if permission_context.get("team_id"):
        filters["team_id"] = permission_context["team_id"]
    return filters


def is_chunk_allowed(metadata: dict[str, Any], permission_context: PermissionContext) -> bool:
    """Second-pass ACL check after vector search."""

    tenant_id = permission_context.get("tenant_id")
    if tenant_id and metadata.get("tenant_id") != tenant_id:
        return False

    project_id = permission_context.get("project_id")
    if project_id and metadata.get("project_id") not in (None, project_id):
        return False

    team_id = permission_context.get("team_id")
    if team_id and metadata.get("team_id") not in (None, team_id):
        return False

    acl = metadata.get("acl_json") or {}
    allowed_roles = acl.get("roles") or []
    if allowed_roles:
        user_roles = permission_context.get("roles", [])
        if not any(role in allowed_roles for role in user_roles):
            return False

    required_scopes = acl.get("scopes") or []
    if required_scopes:
        allowed_scopes = permission_context.get("allowed_knowledge_scopes", [])
        if not all(scope in allowed_scopes for scope in required_scopes):
            return False

    return True


def retrieve_authorized_chunks(
    query: str,
    vector_store: InMemoryVectorStore,
    chunks_by_id: dict[str, dict[str, Any]],
    permission_context: PermissionContext,
    top_k: int = 5,
) -> list[KnowledgeChunkContext]:
    """Retrieve chunks with first-pass metadata filters and second-pass ACL."""

    query_embedding = deterministic_embedding(query)
    results = vector_store.search(
        query_embedding["vector"],
        top_k=top_k * 3,
        filters=build_metadata_filter(permission_context),
    )

    contexts: list[KnowledgeChunkContext] = []
    for result in results:
        chunk_id = result["id"]
        chunk = chunks_by_id.get(chunk_id)
        if not chunk:
            continue
        metadata = {**result["metadata"], **(chunk.get("metadata_json") or {})}
        if not is_chunk_allowed(metadata, permission_context):
            continue
        security_scan = scan_knowledge_text(str(chunk.get("text") or ""))
        security_policy = evaluate_knowledge_security_policy(
            str(chunk.get("text") or ""),
            scan=security_scan,
        )
        if not security_policy["safe_for_prompt"]:
            continue
        contexts.append(
            {
                "chunk_id": chunk_id,
                "text": chunk.get("text", ""),
                "score": result["score"],
                "citation": {
                    "source_id": metadata.get("source_id"),
                    "document_id": metadata.get("document_id"),
                    "source_locator": metadata.get("source_locator", ""),
                },
                "metadata": {
                    **metadata,
                    "security_scan": summarize_scan(security_scan),
                    "security_policy": summarize_policy(security_policy),
                    "blocked_for_prompt": False,
                },
            }
        )
        if len(contexts) >= top_k:
            break
    return contexts


def _lexical_terms(text: str) -> set[str]:
    """Build deterministic lexical terms, including CJK chars/bigrams."""

    terms: set[str] = set()
    for token in re.findall(r"[\w\u4e00-\u9fff]+", text.lower()):
        terms.add(token)
        cjk_chars = [ch for ch in token if "\u4e00" <= ch <= "\u9fff"]
        if cjk_chars:
            terms.update(cjk_chars)
            terms.update("".join(cjk_chars[index : index + 2]) for index in range(len(cjk_chars) - 1))
    return terms


def _lexical_score(query: str, text: str) -> float:
    query_terms = _lexical_terms(query)
    if not query_terms:
        return 0.0
    text_terms = _lexical_terms(text)
    return len(query_terms & text_terms) / len(query_terms)


def _hybrid_score(vector_score: float, lexical_score: float) -> float:
    """Blend local vector similarity with deterministic lexical relevance."""

    normalized_vector = max(0.0, min(1.0, (vector_score + 1.0) / 2.0))
    return (normalized_vector * 0.65) + (lexical_score * 0.35)


def _chunk_metadata(chunk: KnowledgeChunk) -> dict[str, Any]:
    return {
        "chunk_id": chunk.id,
        "tenant_id": chunk.tenant_id,
        "team_id": chunk.team_id,
        "project_id": chunk.project_id,
        "source_id": chunk.source_id,
        "document_id": chunk.document_id,
        "source_locator": chunk.source_locator,
        "classification": chunk.classification,
        "acl_json": chunk.acl_json,
        **(chunk.metadata_json or {}),
    }


def _scan_and_mark_chunk(chunk: KnowledgeChunk) -> dict[str, Any]:
    scan = scan_knowledge_text(f"{chunk.heading_path}\n{chunk.summary}\n{chunk.text}")
    policy = evaluate_knowledge_security_policy(
        f"{chunk.heading_path}\n{chunk.summary}\n{chunk.text}",
        scan=scan,
    )
    chunk.metadata_json = {
        **(chunk.metadata_json or {}),
        "retrieval_security_scan": scan,
        "retrieval_security_policy": summarize_policy(policy),
    }
    return {
        "scan": scan,
        "policy": policy,
    }


async def _load_vector_candidates(
    session: AsyncSession,
    chunks: list[KnowledgeChunk],
    query: str,
    permission_context: PermissionContext,
    top_k: int,
) -> list[dict[str, Any]]:
    """Build local vector candidates from persisted KnowledgeEmbedding vectors."""

    chunk_ids = [chunk.id for chunk in chunks]
    if not chunk_ids:
        return []

    statement = select(KnowledgeEmbedding).where(
        KnowledgeEmbedding.tenant_id == permission_context.get("tenant_id"),
        KnowledgeEmbedding.chunk_id.in_(chunk_ids),
        KnowledgeEmbedding.status == "active",
    )
    embeddings = list((await session.execute(statement)).scalars().all())
    if not embeddings:
        return []

    chunks_by_id = {chunk.id: chunk for chunk in chunks}
    vector_store = InMemoryVectorStore()
    for embedding in embeddings:
        chunk = chunks_by_id.get(embedding.chunk_id)
        if not chunk:
            continue
        stored_vector = (embedding.metadata_json or {}).get("vector")
        vector_source = (embedding.metadata_json or {}).get("vector_source") or "stored_embedding"
        if not isinstance(stored_vector, list) or not stored_vector:
            # Backward compatibility for embeddings created before vectors were
            # persisted. New ingestion stores the vector and does not need this.
            payload = deterministic_embedding(
                f"{chunk.heading_path}\n{chunk.summary}\n{chunk.text}",
                dimensions=embedding.dimensions or 384,
            )
            stored_vector = payload["vector"]
            vector_source = "reconstructed_legacy"
        vector_store.upsert(
            embedding.vector_id or embedding.chunk_id,
            [float(value) for value in stored_vector],
            {
                "chunk_id": chunk.id,
                "tenant_id": chunk.tenant_id,
                "team_id": chunk.team_id,
                "project_id": chunk.project_id,
                "source_id": chunk.source_id,
                "document_id": chunk.document_id,
                "source_locator": chunk.source_locator,
                "vector_store": embedding.vector_store,
                "embedding_model": embedding.embedding_model,
                "vector_source": vector_source,
            },
        )

    query_embedding = deterministic_embedding(query)
    results = vector_store.search(
        query_embedding["vector"],
        top_k=max(top_k * 5, 25),
        filters=build_metadata_filter(permission_context),
    )
    candidates = []
    for result in results:
        chunk_id = str(result["metadata"].get("chunk_id") or result["id"])
        chunk = chunks_by_id.get(chunk_id)
        if not chunk:
            continue
        lexical = _lexical_score(query, f"{chunk.heading_path}\n{chunk.summary}\n{chunk.text}")
        if result["score"] <= 0 and lexical <= 0:
            continue
        candidates.append(
            {
                "chunk": chunk,
                "vector_score": result["score"],
                "lexical_score": lexical,
                "retrieval_mode": "hybrid_vector",
                "vector_store": result["metadata"].get("vector_store", ""),
                "embedding_model": result["metadata"].get("embedding_model", ""),
                "vector_source": result["metadata"].get("vector_source", ""),
            }
        )
    return candidates


async def _load_native_vector_candidates(
    session: AsyncSession,
    chunks: list[KnowledgeChunk],
    query: str,
    permission_context: PermissionContext,
    top_k: int,
) -> list[dict[str, Any]]:
    """Load candidates from a configured native vector backend."""

    backend = settings.KNOWLEDGE_VECTOR_BACKEND.lower()
    if backend not in {"pgvector", "qdrant"}:
        return []

    query_embedding = deterministic_embedding(query)
    if backend == "pgvector":
        results = await search_pgvector_candidates(
            session,
            query_vector=query_embedding["vector"],
            permission_context=permission_context,
            top_k=max(top_k * 5, 25),
        )
        retrieval_mode = "pgvector"
        vector_source = "native_pgvector"
    else:
        results = get_qdrant_store().search(
            query_vector=query_embedding["vector"],
            permission_context=permission_context,
            top_k=max(top_k * 5, 25),
        )
        retrieval_mode = "qdrant"
        vector_source = "native_qdrant"
    chunks_by_id = {chunk.id: chunk for chunk in chunks}
    candidates = []
    for result in results:
        chunk = chunks_by_id.get(str(result["chunk_id"]))
        if not chunk:
            continue
        lexical = _lexical_score(query, f"{chunk.heading_path}\n{chunk.summary}\n{chunk.text}")
        if float(result["score"]) <= 0 and lexical <= 0:
            continue
        candidates.append(
            {
                "chunk": chunk,
                "vector_score": float(result["score"]),
                "lexical_score": lexical,
                "retrieval_mode": retrieval_mode,
                "vector_store": retrieval_mode,
                "embedding_model": result.get("embedding_model", ""),
                "vector_source": vector_source,
            }
        )
    return candidates


async def retrieve_authorized_chunks_from_db(
    session: AsyncSession,
    query: str,
    permission_context: PermissionContext,
    top_k: int = 5,
) -> list[KnowledgeChunkContext]:
    """Retrieve authorized chunks from PostgreSQL metadata.

    This is a deterministic local retriever for the MVP. It can be replaced by
    pgvector/Qdrant/Milvus search while preserving the same second-pass ACL
    check and output shape.
    """

    tenant_id = permission_context.get("tenant_id")
    if not tenant_id:
        return []

    statement = select(KnowledgeChunk).where(
        KnowledgeChunk.tenant_id == tenant_id,
        KnowledgeChunk.status == "active",
    )
    if permission_context.get("project_id"):
        statement = statement.where(
            (KnowledgeChunk.project_id == permission_context["project_id"])
            | (KnowledgeChunk.project_id.is_(None))
        )
    if permission_context.get("team_id"):
        statement = statement.where(
            (KnowledgeChunk.team_id == permission_context["team_id"])
            | (KnowledgeChunk.team_id.is_(None))
        )

    chunks = list((await session.execute(statement)).scalars().all())
    try:
        vector_candidates = await _load_native_vector_candidates(
            session,
            chunks,
            query,
            permission_context,
            top_k=top_k,
        )
    except Exception:
        if not settings.KNOWLEDGE_VECTOR_FALLBACK_TO_LOCAL:
            raise
        vector_candidates = []
    if not vector_candidates:
        vector_candidates = await _load_vector_candidates(
            session,
            chunks,
            query,
            permission_context,
            top_k=top_k,
        )
    if vector_candidates:
        candidate_entries = vector_candidates
    else:
        candidate_entries = [
            {
                "chunk": chunk,
                "vector_score": 0.0,
                "lexical_score": _lexical_score(query, f"{chunk.heading_path}\n{chunk.summary}\n{chunk.text}"),
                "retrieval_mode": "lexical_fallback",
                "vector_store": "",
                "embedding_model": "",
                "vector_source": "",
            }
            for chunk in chunks
        ]

    scored: list[KnowledgeChunkContext] = []
    for entry in candidate_entries:
        chunk = entry["chunk"]
        metadata = _chunk_metadata(chunk)
        explicit_acl = await explicit_acl_allows_knowledge(
            session,
            metadata,
            permission_context,
            required_scope="knowledge:read",
        )
        if explicit_acl is False:
            continue
        if explicit_acl is None and not is_chunk_allowed(metadata, permission_context):
            continue
        lexical_score = float(entry["lexical_score"])
        vector_score = float(entry["vector_score"])
        score = _hybrid_score(vector_score, lexical_score)
        if score <= 0.0:
            continue
        security_evaluation = _scan_and_mark_chunk(chunk)
        security_scan = security_evaluation["scan"]
        security_policy = security_evaluation["policy"]
        security_summary = summarize_scan(security_scan)
        policy_summary = summarize_policy(security_policy)
        if not security_policy["safe_for_prompt"]:
            scored.append(
                {
                    "chunk_id": chunk.id,
                    "text": "",
                    "score": score,
                    "citation": {
                        "source_id": chunk.source_id,
                        "document_id": chunk.document_id,
                        "source_locator": chunk.source_locator,
                    },
                    "metadata": {
                        **metadata,
                        "security_scan": security_summary,
                        "security_policy": policy_summary,
                        "blocked_for_prompt": True,
                        "retrieval": {
                            "mode": entry["retrieval_mode"],
                            "score": score,
                            "vector_score": vector_score,
                            "lexical_score": lexical_score,
                            "vector_store": entry["vector_store"],
                            "embedding_model": entry["embedding_model"],
                            "vector_source": entry["vector_source"],
                        },
                    },
                }
            )
            continue
        scored.append(
            {
                "chunk_id": chunk.id,
                "text": chunk.text,
                "score": score,
                "citation": {
                    "source_id": chunk.source_id,
                    "document_id": chunk.document_id,
                    "source_locator": chunk.source_locator,
                },
                "metadata": metadata,
            }
        )
        scored[-1]["metadata"] = {
            **scored[-1]["metadata"],
            "security_scan": security_summary,
            "security_policy": policy_summary,
            "blocked_for_prompt": False,
            "retrieval": {
                "mode": entry["retrieval_mode"],
                "score": score,
                "vector_score": vector_score,
                "lexical_score": lexical_score,
                "vector_store": entry["vector_store"],
                "embedding_model": entry["embedding_model"],
                "vector_source": entry["vector_source"],
            },
        }

    ranked = sorted(scored, key=lambda item: item["score"], reverse=True)
    return [item for item in ranked if not item["metadata"].get("blocked_for_prompt")][:top_k]
