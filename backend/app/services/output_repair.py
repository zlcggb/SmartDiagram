"""Deterministic repair helpers for generated diagram outputs."""

import json
import re
from typing import Any, TypedDict

from app.artifacts.catalog import is_office_artifact
from app.services.output_validation import validate_output


CODE_FENCE_RE = re.compile(r"^```(?:json|xml|mermaid)?\s*|\s*```$", re.IGNORECASE)


class RepairResult(TypedDict):
    ok: bool
    repaired: bool
    engine_type: str
    content: str
    applied_rules: list[str]
    validation: dict[str, Any]
    errors: list[str]


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _strip_code_fences(content: str) -> tuple[str, list[str]]:
    stripped = content.strip()
    cleaned = CODE_FENCE_RE.sub("", stripped).strip()
    if cleaned != stripped:
        return cleaned, ["common.strip_code_fences"]
    return content, []


def _load_json_after_common_repairs(content: str) -> tuple[Any | None, str, list[str], list[str]]:
    cleaned, rules = _strip_code_fences(content)
    try:
        return json.loads(cleaned), cleaned, rules, []
    except json.JSONDecodeError as exc:
        return None, cleaned, rules, [f"JSON parse failed after repair: {exc.msg}"]


def _repair_flow(content: str) -> tuple[str, list[str], list[str]]:
    payload, cleaned, rules, errors = _load_json_after_common_repairs(content)
    if errors:
        return cleaned, rules, errors
    if not isinstance(payload, dict):
        return cleaned, rules, ["React Flow repair requires a JSON object"]
    if not isinstance(payload.get("nodes"), list):
        payload["nodes"] = []
        rules.append("flow.add_missing_nodes")
    if not isinstance(payload.get("edges"), list):
        payload["edges"] = []
        rules.append("flow.add_missing_edges")
    return _json_dumps(payload), rules, []


def _repair_excalidraw(content: str) -> tuple[str, list[str], list[str]]:
    payload, cleaned, rules, errors = _load_json_after_common_repairs(content)
    if errors:
        return cleaned, rules, errors
    if isinstance(payload, list):
        return _json_dumps(payload), rules, []
    if isinstance(payload, dict):
        if isinstance(payload.get("elements"), list):
            return _json_dumps(payload), rules, []
        if payload.get("type"):
            rules.append("excalidraw.wrap_single_element")
            return _json_dumps([payload]), rules, []
        payload["elements"] = []
        rules.append("excalidraw.add_empty_elements")
        return _json_dumps(payload), rules, []
    return cleaned, rules, ["Excalidraw repair requires a JSON array or object"]


def _repair_charts(content: str) -> tuple[str, list[str], list[str]]:
    payload, cleaned, rules, errors = _load_json_after_common_repairs(content)
    if errors:
        return cleaned, rules, errors
    if not isinstance(payload, dict):
        return cleaned, rules, ["ECharts repair requires a JSON object"]
    if "series" not in payload:
        payload["series"] = []
        rules.append("charts.add_empty_series")
    return _json_dumps(payload), rules, []


def _repair_json_object(content: str, engine: str) -> tuple[str, list[str], list[str]]:
    payload, cleaned, rules, errors = _load_json_after_common_repairs(content)
    if errors:
        return cleaned, rules, errors
    if isinstance(payload, dict):
        return _json_dumps(payload), rules, []
    rules.append(f"{engine}.wrap_value")
    return _json_dumps({"value": payload}), rules, []


def _safe_artifact_href(value: Any) -> str:
    href = str(value or "").strip()
    lowered = href.lower()
    if (
        lowered.startswith("https://")
        or lowered.startswith("mailto:")
        or (href.startswith("/") and not href.startswith("//"))
        or href.startswith("#")
        or not href
    ):
        return href
    return ""


def _normalize_office_section(section: Any, rules: list[str]) -> dict[str, Any] | None:
    allowed = {
        "hero",
        "text",
        "list",
        "table",
        "cta",
        "quote",
        "insight_grid",
        "metric_grid",
        "bar_chart",
        "timeline",
        "comparison",
    }
    if not isinstance(section, dict):
        rules.append("office.wrap_plain_section")
        return {"type": "text", "body": str(section)}
    section_type = str(section.get("type") or "text").strip().lower()
    if section_type not in allowed:
        rules.append("office.remove_unsupported_section_type")
        section_type = "text"
    normalized = dict(section)
    normalized["type"] = section_type
    if section_type == "cta" and normalized.get("href") != _safe_artifact_href(normalized.get("href")):
        normalized["href"] = _safe_artifact_href(normalized.get("href"))
        rules.append("office.normalize_unsafe_href")
    return normalized


def _repair_office_artifact(content: str, engine: str) -> tuple[str, list[str], list[str]]:
    payload, cleaned, rules, errors = _load_json_after_common_repairs(content)
    if errors:
        return cleaned, rules, errors
    if not isinstance(payload, dict):
        return cleaned, rules, ["Office artifact repair requires a JSON object"]

    if payload.get("artifact_type") != engine:
        payload["artifact_type"] = engine
        rules.append("office.set_artifact_type")

    sections = payload.get("sections")
    if not isinstance(sections, list) or not sections:
        body = payload.get("body") or payload.get("summary") or payload.get("title") or "Draft"
        payload["sections"] = [{"type": "text", "body": str(body)}]
        rules.append("office.add_sections_from_body")
    else:
        normalized_sections = [
            normalized
            for section in sections
            if (normalized := _normalize_office_section(section, rules)) is not None
        ]
        if not normalized_sections:
            normalized_sections = [{"type": "text", "body": payload.get("title") or "Draft"}]
            rules.append("office.add_fallback_section")
        payload["sections"] = normalized_sections[:18]

    if engine == "html_email":
        email = payload.get("email") if isinstance(payload.get("email"), dict) else {}
        if not str(email.get("subject") or "").strip():
            email["subject"] = str(payload.get("title") or "Untitled email")[:160]
            rules.append("office.email_subject_default")
        payload["email"] = email
    if not str(payload.get("title") or "").strip():
        payload["title"] = str((payload.get("email") or {}).get("subject") if isinstance(payload.get("email"), dict) else "") or "Office artifact"
        rules.append("office.title_default")

    return _json_dumps(payload), sorted(set(rules)), []


def _repair_mermaid(content: str) -> tuple[str, list[str], list[str]]:
    cleaned, rules = _strip_code_fences(content)
    if not cleaned.strip():
        return cleaned, rules, ["Mermaid repair cannot infer missing diagram content"]
    return cleaned.strip(), rules, []


def _repair_mindmap(content: str) -> tuple[str, list[str], list[str]]:
    cleaned, rules = _strip_code_fences(content)
    cleaned = cleaned.strip()
    if not cleaned:
        return cleaned, rules, ["Mindmap repair cannot infer missing content"]
    if not cleaned.startswith("#"):
        cleaned = f"# Diagram\n\n{cleaned}"
        rules.append("mindmap.add_root_heading")
    return cleaned, rules, []


def _repair_drawio(content: str) -> tuple[str, list[str], list[str]]:
    cleaned, rules = _strip_code_fences(content)
    if "<mxfile" not in cleaned:
        return cleaned, rules, ["Draw.io repair cannot infer missing mxfile root"]
    if "</mxfile>" not in cleaned:
        cleaned = f"{cleaned.rstrip()}</mxfile>"
        rules.append("drawio.add_missing_closing_mxfile")
    return cleaned, rules, []


def repair_output(engine_type: str | None, content: str) -> RepairResult:
    """Try deterministic repair and validate the repaired output."""

    engine = engine_type or "general"
    original_validation = validate_output(engine, content)
    if original_validation["ok"]:
        return {
            "ok": True,
            "repaired": False,
            "engine_type": engine,
            "content": content,
            "applied_rules": [],
            "validation": original_validation,
            "errors": [],
        }

    try:
        if engine == "flow":
            repaired_content, rules, errors = _repair_flow(content)
        elif engine == "excalidraw":
            repaired_content, rules, errors = _repair_excalidraw(content)
        elif engine == "charts":
            repaired_content, rules, errors = _repair_charts(content)
        elif engine == "mermaid":
            repaired_content, rules, errors = _repair_mermaid(content)
        elif engine == "mindmap":
            repaired_content, rules, errors = _repair_mindmap(content)
        elif engine == "drawio":
            repaired_content, rules, errors = _repair_drawio(content)
        elif engine == "infographic":
            repaired_content, rules, errors = _repair_json_object(content, engine)
        elif is_office_artifact(engine):
            repaired_content, rules, errors = _repair_office_artifact(content, engine)
        else:
            repaired_content, rules, errors = content, [], ["No repair strategy for engine"]
    except Exception as exc:
        repaired_content, rules, errors = content, [], [str(exc)]

    validation = validate_output(engine, repaired_content)
    repaired = repaired_content != content and validation["ok"]
    return {
        "ok": bool(validation["ok"]),
        "repaired": repaired,
        "engine_type": engine,
        "content": repaired_content if repaired else content,
        "applied_rules": rules,
        "validation": validation,
        "errors": errors + ([] if validation["ok"] else validation["errors"]),
    }
