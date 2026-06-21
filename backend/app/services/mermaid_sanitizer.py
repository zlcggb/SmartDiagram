"""Mermaid syntax normalization helpers."""

import re


CODE_FENCE_RE = re.compile(r"^```(?:mermaid)?\s*|\s*```$", re.IGNORECASE)
FLOWCHART_HEADER_RE = re.compile(r"^(?:flowchart|graph)\s+", re.IGNORECASE)
EDGE_PIPE_LABEL_RE = re.compile(r"(?P<prefix>[-.=ox<>]+\|)(?P<label>[^|\n]+)(?P<suffix>\|)")
EDGE_LABEL_IN_LINE_RE = re.compile(r"(?P<connector>[-.=ox<>]{2,})\s*\|(?P<label>[^|\n]+)\|\s*")
INLINE_EDGE_TARGET_DECL_RE = re.compile(
    r"(?P<connector>\s+[-.=ox<>]{2,}\s+)"
    r"(?P<target>[A-Za-z0-9_][A-Za-z0-9_-]*(?:\[[^\n\]]+\]|\([^\n)]+\)|\{[^\n}]+\}):::[A-Za-z0-9_-]+)\s*$"
)
NODE_ID_RE = re.compile(r"^([A-Za-z0-9_][A-Za-z0-9_-]*)")
RISKY_EDGE_LABEL_RE = re.compile(r"[()\[\]{}（）;]")


def strip_mermaid_code_fences(content: str) -> str:
    """Remove optional markdown code fences around Mermaid source."""

    unfenced = CODE_FENCE_RE.sub("", content.strip().lstrip("\ufeff")).strip()
    smart_unwrapped = re.sub(r"^[“”\"']+", "", unfenced)
    smart_unwrapped = re.sub(r"[“”\"']+$", "", smart_unwrapped).strip()
    return smart_unwrapped or unfenced


def _is_flowchart(code: str) -> bool:
    for line in code.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("%%"):
            continue
        return bool(FLOWCHART_HEADER_RE.match(stripped))
    return False


def _quote_edge_label(match: re.Match[str]) -> str:
    label = match.group("label").strip()
    if len(label) >= 2 and label.startswith('"') and label.endswith('"'):
        return match.group(0)
    if not RISKY_EDGE_LABEL_RE.search(label):
        return match.group(0)
    escaped = label.replace('"', "#quot;")
    return f'{match.group("prefix")}"{escaped}"{match.group("suffix")}'


def _clean_relation_label(label: str) -> str:
    stripped = label.strip()
    if len(stripped) >= 2 and stripped.startswith('"') and stripped.endswith('"'):
        stripped = stripped[1:-1]
    return stripped.replace('"', "#quot;")


def _stabilize_flowchart_edge_labels(code: str) -> tuple[str, bool]:
    stabilized_lines: list[str] = []
    relation_index = 0
    changed = False
    declared_inline_targets: set[str] = set()

    for line in code.splitlines():
        if line.lstrip().startswith("%%"):
            stabilized_lines.append(line)
            continue
        indent_match = re.match(r"^\s*", line)
        indent = indent_match.group(0) if indent_match else ""
        body = line[len(indent) :]
        inline_target_match = INLINE_EDGE_TARGET_DECL_RE.search(body)
        if inline_target_match:
            target_decl = inline_target_match.group("target")
            target_id_match = NODE_ID_RE.match(target_decl)
            if target_id_match:
                target_id = target_id_match.group(1)
                if target_id not in declared_inline_targets:
                    stabilized_lines.append(f"{indent}{target_decl}")
                    declared_inline_targets.add(target_id)
                source_and_connector = (
                    body[: inline_target_match.start()] + inline_target_match.group("connector")
                )
                stabilized_lines.append(f"{indent}{source_and_connector}{target_id}")
                changed = True
                continue

        match = EDGE_LABEL_IN_LINE_RE.search(body)
        if not match:
            stabilized_lines.append(line)
            continue

        source = body[: match.start()].rstrip()
        target = body[match.end() :].lstrip()
        if not source or not target:
            stabilized_lines.append(line)
            continue

        relation_id = f"Rel_{relation_index}"
        relation_index += 1
        relation_label = _clean_relation_label(match.group("label"))
        connector = match.group("connector")
        stabilized_lines.append(f'{indent}{relation_id}["{relation_label}"]:::relation')
        stabilized_lines.append(f"{indent}{source} {connector} {relation_id}")
        stabilized_lines.append(f"{indent}{relation_id} {connector} {target}")
        changed = True

    if changed and not any(re.match(r"^\s*classDef\s+relation\b", line) for line in stabilized_lines):
        stabilized_lines.append(
            "classDef relation fill:#eef2ff,stroke:#6366f1,stroke-width:1px,color:#312e81;"
        )
    return "\n".join(stabilized_lines).strip(), changed


def normalize_mermaid_code(content: str) -> tuple[str, list[str]]:
    """Normalize generated Mermaid without changing diagram semantics."""

    cleaned = strip_mermaid_code_fences(content)
    cleaned = "\n".join(line.rstrip() for line in cleaned.splitlines()).strip()
    rules: list[str] = []
    if cleaned != content.strip():
        rules.append("mermaid.trimmed_code_fences")
    if not cleaned or not _is_flowchart(cleaned):
        return cleaned, rules

    normalized_lines: list[str] = []
    changed_edge_labels = False
    for line in cleaned.splitlines():
        if line.lstrip().startswith("%%"):
            normalized_lines.append(line)
            continue
        normalized = EDGE_PIPE_LABEL_RE.sub(_quote_edge_label, line)
        if normalized != line:
            changed_edge_labels = True
        normalized_lines.append(normalized)

    normalized_code = "\n".join(normalized_lines).strip()
    normalized_code, stabilized_edge_labels = _stabilize_flowchart_edge_labels(normalized_code)
    if changed_edge_labels:
        rules.append("mermaid.quote_flowchart_edge_labels")
    if stabilized_edge_labels:
        rules.append("mermaid.stabilize_flowchart_edges")
    return normalized_code, rules
