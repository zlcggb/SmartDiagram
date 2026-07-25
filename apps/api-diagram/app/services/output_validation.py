"""Deterministic output validation for generated diagram payloads.

The MVP keeps validation non-blocking: callers can surface warnings/errors to
users while still rendering the model output. Later phases can promote selected
errors to hard stops with repair loops.
"""

import json
import re
from typing import Any, TypedDict

from app.artifacts.catalog import is_office_artifact
from app.services.html_artifact_renderer import render_html_artifact
from app.services.html_policy import validate_rendered_html_policy


class ValidationResult(TypedDict):
    ok: bool
    engine_type: str
    errors: list[str]
    warnings: list[str]
    repairable: bool


def _result(
    engine_type: str,
    errors: list[str] | None = None,
    warnings: list[str] | None = None,
) -> ValidationResult:
    error_list = errors or []
    warning_list = warnings or []
    return {
        "ok": not error_list,
        "engine_type": engine_type,
        "errors": error_list,
        "warnings": warning_list,
        "repairable": bool(error_list),
    }


def _parse_json(content: str) -> tuple[Any | None, str | None]:
    try:
        return json.loads(content), None
    except json.JSONDecodeError as exc:
        return None, f"JSON parse failed: {exc.msg} at line {exc.lineno} column {exc.colno}"


def _contains_executable_js(value: Any) -> bool:
    if isinstance(value, str):
        return bool(re.search(r"\bfunction\s*\(|=>", value))
    if isinstance(value, dict):
        return any(_contains_executable_js(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_executable_js(item) for item in value)
    return False


def _validate_charts(content: str) -> ValidationResult:
    payload, error = _parse_json(content)
    if error:
        return _result("charts", [error])
    if not isinstance(payload, dict):
        return _result("charts", ["ECharts output must be a JSON object"])
    if _contains_executable_js(payload):
        return _result("charts", ["ECharts JSON must not contain JavaScript functions"])
    warnings: list[str] = []
    if "series" not in payload:
        warnings.append("ECharts option has no series field")
    return _result("charts", warnings=warnings)


def _validate_flow(content: str) -> ValidationResult:
    payload, error = _parse_json(content)
    if error:
        return _result("flow", [error])
    if not isinstance(payload, dict):
        return _result("flow", ["React Flow output must be a JSON object"])
    errors: list[str] = []
    if not isinstance(payload.get("nodes"), list):
        errors.append("React Flow output must include a nodes array")
    if not isinstance(payload.get("edges"), list):
        errors.append("React Flow output must include an edges array")
    return _result("flow", errors)


def _validate_excalidraw(content: str) -> ValidationResult:
    payload, error = _parse_json(content)
    if error:
        return _result("excalidraw", [error])
    if isinstance(payload, list):
        return _result("excalidraw")
    if isinstance(payload, dict) and isinstance(payload.get("elements"), list):
        return _result("excalidraw")
    return _result("excalidraw", ["Excalidraw output must be an element array or an object with elements"])


def _validate_mermaid(content: str) -> ValidationResult:
    stripped = content.strip()
    if not stripped:
        return _result("mermaid", ["Mermaid output is empty"])
    warnings: list[str] = []
    if stripped.startswith("```"):
        warnings.append("Mermaid output still contains markdown code fences")
    return _result("mermaid", warnings=warnings)


def _validate_drawio(content: str) -> ValidationResult:
    if "<mxfile" not in content:
        return _result("drawio", ["Draw.io output must contain an mxfile root"])
    if "</mxfile>" not in content:
        return _result("drawio", ["Draw.io output is missing closing mxfile tag"])
    return _result("drawio")


def _validate_mindmap(content: str) -> ValidationResult:
    stripped = content.strip()
    if not stripped:
        return _result("mindmap", ["Mindmap output is empty"])
    warnings: list[str] = []
    if not stripped.startswith("#"):
        warnings.append("Mindmap output usually starts with a markdown heading")
    return _result("mindmap", warnings=warnings)


def _validate_json_object_engine(engine_type: str, content: str) -> ValidationResult:
    payload, error = _parse_json(content)
    if error:
        return _result(engine_type, [error])
    if not isinstance(payload, dict):
        return _result(engine_type, [f"{engine_type} output must be a JSON object"])
    return _result(engine_type)


def _unsafe_links(value: Any, path: str = "$") -> list[str]:
    unsafe: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            next_path = f"{path}.{key}"
            if key in {"href", "url", "link"} and isinstance(item, str) and item.strip():
                lowered = item.strip().lower()
                if not (
                    lowered.startswith("https://")
                    or lowered.startswith("mailto:")
                    or (item.startswith("/") and not item.startswith("//"))
                    or item.startswith("#")
                ):
                    unsafe.append(f"{next_path} uses unsupported URL scheme")
            unsafe.extend(_unsafe_links(item, next_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            unsafe.extend(_unsafe_links(item, f"{path}[{index}]"))
    return unsafe


def _validate_office_artifact(engine_type: str, content: str) -> ValidationResult:
    payload, error = _parse_json(content)
    if error:
        return _result(engine_type, [error])
    if not isinstance(payload, dict):
        return _result(engine_type, [f"{engine_type} output must be a JSON object"])

    errors: list[str] = []
    warnings: list[str] = []
    artifact_type = str(payload.get("artifact_type") or "").strip()
    if artifact_type != engine_type:
        errors.append(f"artifact_type must be {engine_type}")
    sections = payload.get("sections")
    if not isinstance(sections, list) or len(sections) == 0:
        errors.append("Office artifact output must include a non-empty sections array")
    if engine_type == "html_email":
        email = payload.get("email")
        subject = email.get("subject") if isinstance(email, dict) else ""
        if not str(subject or "").strip():
            errors.append("HTML email output must include email.subject")
    if _contains_executable_js(payload):
        errors.append("Office artifact JSON must not contain JavaScript functions")
    errors.extend(_unsafe_links(payload))

    if not errors:
        try:
            rendered = render_html_artifact(payload)
            policy = validate_rendered_html_policy(rendered["html"])
            errors.extend(policy["errors"])
            warnings.extend(policy["warnings"])
        except Exception as exc:
            errors.append(f"Office artifact render failed: {exc}")
    return _result(engine_type, errors, warnings)


def validate_output(engine_type: str | None, content: str) -> ValidationResult:
    """Validate generated diagram code for the selected rendering engine."""

    engine = engine_type or "general"
    if engine == "charts":
        return _validate_charts(content)
    if engine == "flow":
        return _validate_flow(content)
    if engine == "excalidraw":
        return _validate_excalidraw(content)
    if engine == "mermaid":
        return _validate_mermaid(content)
    if engine == "drawio":
        return _validate_drawio(content)
    if engine == "mindmap":
        return _validate_mindmap(content)
    if engine == "infographic":
        return _validate_json_object_engine(engine, content)
    if is_office_artifact(engine):
        return _validate_office_artifact(engine, content)
    return _result(engine)
