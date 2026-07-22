"""Deterministic, source-locator-aware knowledge chunking utilities."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.services.file_parser_service import ParsedBlock, ParsedDocument


class KnowledgeChunkPayload(TypedDict):
    chunk_index: int
    text: str
    summary: str
    token_count: int
    heading_path: str
    source_locator: str
    metadata: dict[str, Any]


_TOKEN_PATTERN = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s]", flags=re.UNICODE)


def _rough_tokens(text: str) -> list[str]:
    """Count each CJK character while keeping Latin words as one rough token."""

    return [match.group(0) for match in _TOKEN_PATTERN.finditer(text)]


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


def _legacy_locator(block: ParsedBlock) -> str:
    if block.get("source_locator"):
        return str(block["source_locator"])
    if "page" in block:
        return f"pdf:page={block['page']}"
    if "slide" in block:
        return f"pptx:slide={block['slide']}"
    if "sheet" in block:
        return f"xlsx:sheet={block['sheet']}"
    return ""


def _split_block_text(text: str, target_tokens: int, overlap_tokens: int) -> list[str]:
    matches = list(_TOKEN_PATTERN.finditer(text))
    if not matches:
        return []
    target = max(1, int(target_tokens))
    overlap = min(max(0, int(overlap_tokens)), target - 1)
    parts: list[str] = []
    start_token = 0
    while start_token < len(matches):
        end_token = min(len(matches), start_token + target)
        start_char = matches[start_token].start()
        end_char = matches[end_token - 1].end()
        part = text[start_char:end_char].strip()
        if part:
            parts.append(part)
        if end_token >= len(matches):
            break
        start_token = end_token - overlap
    return parts


def chunk_parsed_document(
    parsed: ParsedDocument,
    target_tokens: int = 800,
    overlap_tokens: int = 80,
) -> list[KnowledgeChunkPayload]:
    """Split blocks without ever carrying text or overlap across locators."""

    chunks: list[KnowledgeChunkPayload] = []
    for block_index, block in enumerate(parsed["blocks"]):
        text = block.get("text", "").strip()
        if not text:
            continue
        locator = _legacy_locator(block)
        parts = _split_block_text(text, target_tokens, overlap_tokens)
        part_count = len(parts)
        for part_index, part in enumerate(parts, start=1):
            metadata = {
                **(block.get("metadata") or {}),
                "filename": parsed["filename"],
                "block_index": block_index,
                "block_type": block.get("type", "text"),
                "source_locator": locator,
                "part_index": part_index,
                "part_count": part_count,
            }
            chunks.append(
                {
                    "chunk_index": len(chunks),
                    "text": part,
                    "summary": _summary(part),
                    "token_count": len(_rough_tokens(part)),
                    "heading_path": _heading_path(part),
                    "source_locator": locator,
                    "metadata": metadata,
                }
            )
    return chunks
