"""Optional Qdrant-backed knowledge vector store."""

import json
import re
from typing import Any
from urllib import error, request

from app.core.config import settings
from app.models.knowledge import KnowledgeChunk, KnowledgeEmbedding
from app.state.agent_runtime import PermissionContext


class QdrantStoreError(RuntimeError):
    """Raised when Qdrant operations fail."""


def qdrant_point_id(point_id: str) -> str:
    """Normalize internal 32-char hex ids into Qdrant-compatible UUID ids."""

    value = str(point_id)
    if re.fullmatch(r"[0-9a-fA-F]{32}", value):
        return f"{value[0:8]}-{value[8:12]}-{value[12:16]}-{value[16:20]}-{value[20:32]}"
    return value


def qdrant_filter(permission_context: PermissionContext) -> dict[str, Any]:
    """Build first-pass Qdrant tenant filter.

    Team/project ACL is still enforced by the PostgreSQL second pass, because
    chunks may intentionally be tenant-wide with null project/team values.
    """

    tenant_id = permission_context.get("tenant_id")
    if not tenant_id:
        return {}
    return {
        "must": [
            {
                "key": "tenant_id",
                "match": {"value": tenant_id},
            }
        ]
    }


def qdrant_point_payload(
    *,
    chunk: KnowledgeChunk,
    embedding: KnowledgeEmbedding,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    """Build Qdrant point payload for one knowledge chunk."""

    return {
        "chunk_id": chunk.id,
        "tenant_id": chunk.tenant_id,
        "team_id": chunk.team_id,
        "project_id": chunk.project_id,
        "source_id": chunk.source_id,
        "document_id": chunk.document_id,
        "source_locator": chunk.source_locator,
        "embedding_model": embedding.embedding_model,
        "metadata": metadata,
    }


class QdrantVectorStore:
    """Minimal Qdrant HTTP adapter using standard-library urllib."""

    def __init__(
        self,
        *,
        url: str,
        collection: str,
        api_key: str = "",
        timeout_seconds: int = 30,
    ) -> None:
        if not url or not collection:
            raise QdrantStoreError("Qdrant requires URL and collection")
        self.url = url.rstrip("/")
        self.collection = collection
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["api-key"] = self.api_key
        return headers

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        data = json.dumps(body or {}).encode("utf-8") if body is not None else None
        req = request.Request(
            f"{self.url}{path}",
            data=data,
            headers=self._headers(),
            method=method,
        )
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as response:
                raw = response.read()
        except error.HTTPError as exc:
            raw_error = exc.read().decode("utf-8", errors="replace")
            raise QdrantStoreError(
                f"Qdrant {method} {path} failed with HTTP {exc.code}: {raw_error}"
            ) from exc
        except error.URLError as exc:
            raise QdrantStoreError(f"Qdrant {method} {path} failed: {exc}") from exc
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def ensure_collection(self, dimensions: int) -> None:
        if self.collection_exists():
            return
        self._request(
            "PUT",
            f"/collections/{self.collection}",
            {
                "vectors": {
                    "size": dimensions,
                    "distance": "Cosine",
                }
            },
        )

    def collection_exists(self) -> bool:
        try:
            self._request("GET", f"/collections/{self.collection}")
            return True
        except QdrantStoreError as exc:
            if "HTTP 404" in str(exc):
                return False
            raise

    def upsert(
        self,
        *,
        point_id: str,
        vector: list[float],
        payload: dict[str, Any],
    ) -> None:
        self._request(
            "PUT",
            f"/collections/{self.collection}/points?wait=true",
            {
                "points": [
                    {
                        "id": qdrant_point_id(point_id),
                        "vector": vector,
                        "payload": payload,
                    }
                ]
            },
        )

    def search(
        self,
        *,
        query_vector: list[float],
        permission_context: PermissionContext,
        top_k: int,
    ) -> list[dict[str, Any]]:
        response = self._request(
            "POST",
            f"/collections/{self.collection}/points/search",
            {
                "vector": query_vector,
                "limit": max(top_k, 1),
                "with_payload": True,
                "filter": qdrant_filter(permission_context),
            },
        )
        points = response.get("result") or []
        results: list[dict[str, Any]] = []
        for point in points:
            payload = point.get("payload") or {}
            results.append(
                {
                    "chunk_id": payload.get("chunk_id") or str(point.get("id")),
                    "score": float(point.get("score") or 0.0),
                    "source_id": payload.get("source_id"),
                    "document_id": payload.get("document_id"),
                    "source_locator": payload.get("source_locator", ""),
                    "embedding_model": payload.get("embedding_model", ""),
                    "metadata": payload.get("metadata") or {},
                }
            )
        return results


def get_qdrant_store() -> QdrantVectorStore:
    """Return configured Qdrant vector store."""

    return QdrantVectorStore(
        url=settings.QDRANT_URL,
        collection=settings.QDRANT_COLLECTION,
        api_key=settings.QDRANT_API_KEY,
        timeout_seconds=settings.QDRANT_TIMEOUT_SECONDS,
    )
