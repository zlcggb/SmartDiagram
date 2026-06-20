"""Deterministic knowledge chunking utilities."""

import re
from typing import Any, TypedDict

from app.services.file_parser_service import ParsedDocument


class KnowledgeChunkPayload(TypedDict):
    chunk_index: int
    text: str
    summary: str
    token_count: int
    heading_path: str
    source_locator: str
    metadata: dict[str, Any]


def _rough_tokens(text: str) -> list[str]:
    return re.findall(r"[\w\u4e00-\u9fff]+|[^\s]", text, flags=re.UNICODE)


def _summary(text: str, max_chars: int = 160) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    if len(normalized) <= max_chars:
        return normalized
    return normalized[: max_chars - 1].rstrip() + "..."


def _heading_path(text: str) -> str:
    headings = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            headings.append(stripped.lstrip("#").strip())
    return " / ".join(headings[:4])


def chunk_parsed_document(
    parsed: ParsedDocument,
    target_tokens: int = 800,
    overlap_tokens: int = 80,
) -> list[KnowledgeChunkPayload]:
    """Split parsed document blocks into stable chunk payloads.

    Token counting is approximate and deterministic. It avoids model calls so
    ingestion can run locally before embeddings are configured.
    """

    chunks: list[KnowledgeChunkPayload] = []
    current_tokens: list[str] = []
    current_text_parts: list[str] = []
    current_metadata: dict[str, Any] = {}

    def flush() -> None:
        nonlocal current_tokens, current_text_parts, current_metadata
        text = "\n\n".join(part for part in current_text_parts if part.strip()).strip()
        if not text:
            current_tokens = []
            current_text_parts = []
            current_metadata = {}
            return
        chunks.append(
            {
                "chunk_index": len(chunks),
                "text": text,
                "summary": _summary(text),
                "token_count": len(_rough_tokens(text)),
                "heading_path": _heading_path(text),
                "source_locator": current_metadata.get("source_locator", ""),
                "metadata": dict(current_metadata),
            }
        )
        if overlap_tokens > 0 and current_tokens:
            overlap = current_tokens[-overlap_tokens:]
            current_tokens = overlap
            current_text_parts = [" ".join(overlap)]
        else:
            current_tokens = []
            current_text_parts = []
        current_metadata = {}

    for block in parsed["blocks"]:
        text = block.get("text", "").strip()
        if not text:
            continue
        tokens = _rough_tokens(text)
        locator = ""
        if "page" in block:
            locator = f"page:{block['page']}"
        elif "sheet" in block:
            locator = f"sheet:{block['sheet']}"

        if current_tokens and len(current_tokens) + len(tokens) > target_tokens:
            flush()

        current_tokens.extend(tokens)
        current_text_parts.append(text)
        current_metadata.update(
            {
                "filename": parsed["filename"],
                "block_type": block.get("type", "text"),
                "source_locator": locator or current_metadata.get("source_locator", ""),
            }
        )

        while len(current_tokens) >= target_tokens:
            flush()

    flush()
    return chunks
