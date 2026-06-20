"""Deterministic checks between generated diagrams and retrieved knowledge."""

from __future__ import annotations

import re
from typing import Any, TypedDict


class ConsistencyResult(TypedDict):
    status: str
    ok: bool
    needs_user_input: bool
    checked_chunks: int
    missing_required_terms: list[str]
    forbidden_terms_present: list[str]
    coverage_ratio: float
    citations: list[dict[str, Any]]
    note: str


TERM_SPLIT_RE = re.compile(r"[,，、;；\n]+")
DIRECTIVE_RE = re.compile(
    r"(required_terms|must_include|forbidden_terms|must_not_include|必须包含|关键节点|禁止包含|不得包含)\s*[:：]\s*([^\n]+)",
    re.IGNORECASE,
)


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def _normalize_term(term: str) -> str:
    return re.sub(r"\s+", "", term or "").strip().lower()


def _list_value(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        return [item.strip() for item in TERM_SPLIT_RE.split(value) if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


def _directive_terms(text: str) -> tuple[list[str], list[str]]:
    required: list[str] = []
    forbidden: list[str] = []
    for match in DIRECTIVE_RE.finditer(text or ""):
        key = match.group(1).lower()
        terms = [item.strip() for item in TERM_SPLIT_RE.split(match.group(2)) if item.strip()]
        if key in {"forbidden_terms", "must_not_include", "禁止包含", "不得包含"}:
            forbidden.extend(terms)
        else:
            required.extend(terms)
    return required, forbidden


def _chunk_terms(chunk: dict[str, Any]) -> tuple[list[str], list[str]]:
    metadata = chunk.get("metadata") or {}
    required = []
    forbidden = []
    for key in ("required_terms", "must_include_terms", "must_include"):
        required.extend(_list_value(metadata.get(key)))
    for key in ("forbidden_terms", "must_not_include_terms", "must_not_include"):
        forbidden.extend(_list_value(metadata.get(key)))

    directive_required, directive_forbidden = _directive_terms(str(chunk.get("text") or ""))
    required.extend(directive_required)
    forbidden.extend(directive_forbidden)

    return sorted(set(required)), sorted(set(forbidden))


def _term_in_code(term: str, normalized_code: str, compact_code: str) -> bool:
    normalized_term = _normalize_text(term)
    compact_term = _normalize_term(term)
    if not normalized_term and not compact_term:
        return True
    return normalized_term in normalized_code or compact_term in compact_code


def check_knowledge_consistency(
    *,
    generated_code: str,
    knowledge_context: dict[str, Any] | None,
) -> ConsistencyResult:
    """Compare final generated diagram code with explicit knowledge constraints.

    The checker intentionally uses only explicit constraints from chunk metadata
    or directive-like text. Generic knowledge chunks are cited and counted, but
    they do not fail the output by implication.
    """

    chunks = list((knowledge_context or {}).get("chunks") or [])
    citations = [
        chunk.get("citation", {})
        for chunk in chunks
        if isinstance(chunk, dict) and isinstance(chunk.get("citation", {}), dict)
    ]
    if not chunks:
        return {
            "status": "no_context",
            "ok": True,
            "needs_user_input": False,
            "checked_chunks": 0,
            "missing_required_terms": [],
            "forbidden_terms_present": [],
            "coverage_ratio": 1.0,
            "citations": [],
            "note": "No authorized knowledge context was used for this output.",
        }

    normalized_code = _normalize_text(generated_code)
    compact_code = _normalize_term(generated_code)
    required_terms: list[str] = []
    forbidden_terms: list[str] = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        required, forbidden = _chunk_terms(chunk)
        required_terms.extend(required)
        forbidden_terms.extend(forbidden)

    required_terms = sorted(set(required_terms))
    forbidden_terms = sorted(set(forbidden_terms))
    missing = [
        term
        for term in required_terms
        if not _term_in_code(term, normalized_code, compact_code)
    ]
    forbidden_present = [
        term
        for term in forbidden_terms
        if _term_in_code(term, normalized_code, compact_code)
    ]

    covered_required = max(0, len(required_terms) - len(missing))
    coverage_ratio = 1.0 if not required_terms else round(covered_required / len(required_terms), 4)
    ok = not missing and not forbidden_present
    status = "passed" if ok else "needs_user_input"
    if ok and not required_terms and not forbidden_terms:
        status = "checked"
    if ok:
        note = "Generated output does not conflict with explicit knowledge constraints."
    else:
        note = "Generated output conflicts with explicit knowledge constraints and needs user confirmation."

    return {
        "status": status,
        "ok": ok,
        "needs_user_input": not ok,
        "checked_chunks": len(chunks),
        "missing_required_terms": missing,
        "forbidden_terms_present": forbidden_present,
        "coverage_ratio": coverage_ratio,
        "citations": citations,
        "note": note,
    }
