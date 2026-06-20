"""Embedding service interfaces and local deterministic fallback."""

import hashlib
import math
from typing import TypedDict


class EmbeddingPayload(TypedDict):
    text: str
    vector: list[float]
    embedding_model: str
    dimensions: int


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def deterministic_embedding(text: str, dimensions: int = 384) -> EmbeddingPayload:
    """Return a deterministic local embedding for development and tests.

    This is not a semantic embedding model. It provides a stable vector shape so
    ingestion, storage, and retrieval plumbing can be built before external
    embedding providers are configured.
    """

    vector = [0.0 for _ in range(dimensions)]
    tokens = text.lower().split()
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign

    return {
        "text": text,
        "vector": _normalize(vector),
        "embedding_model": "local-hash-v1",
        "dimensions": dimensions,
    }


def embed_texts(texts: list[str], dimensions: int = 384) -> list[EmbeddingPayload]:
    """Embed multiple texts with the current local fallback."""

    return [deterministic_embedding(text, dimensions=dimensions) for text in texts]
