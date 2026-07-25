"""Vector store abstraction and in-memory implementation for local RAG work."""

import math
from typing import Any, TypedDict


class VectorSearchResult(TypedDict):
    id: str
    score: float
    metadata: dict[str, Any]


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return numerator / (left_norm * right_norm)


def _matches_filter(metadata: dict[str, Any], filters: dict[str, Any] | None) -> bool:
    if not filters:
        return True
    for key, expected in filters.items():
        if expected is None:
            continue
        actual = metadata.get(key)
        if isinstance(expected, list):
            if actual not in expected:
                return False
        elif actual != expected:
            return False
    return True


class InMemoryVectorStore:
    """Small vector store useful for local tests and retriever wiring."""

    def __init__(self) -> None:
        self._items: dict[str, tuple[list[float], dict[str, Any]]] = {}

    def upsert(self, vector_id: str, vector: list[float], metadata: dict[str, Any]) -> None:
        self._items[vector_id] = (vector, metadata)

    def delete(self, vector_id: str) -> None:
        self._items.pop(vector_id, None)

    def search(
        self,
        query_vector: list[float],
        top_k: int = 5,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorSearchResult]:
        scored: list[VectorSearchResult] = []
        for vector_id, (vector, metadata) in self._items.items():
            if not _matches_filter(metadata, filters):
                continue
            scored.append(
                {
                    "id": vector_id,
                    "score": _cosine_similarity(query_vector, vector),
                    "metadata": metadata,
                }
            )
        return sorted(scored, key=lambda item: item["score"], reverse=True)[:top_k]
