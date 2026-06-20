"""Shared artifact catalog for diagram and office outputs."""

from typing import Any


DIAGRAM_ENGINE_TYPES = {
    "excalidraw",
    "mermaid",
    "flow",
    "mindmap",
    "charts",
    "drawio",
    "infographic",
}

OFFICE_ARTIFACT_TYPES = {
    "html_email",
    "web_report_html",
}

ARTIFACT_TYPES: dict[str, dict[str, Any]] = {
    "html_email": {
        "family": "office",
        "engine_type": "html_email",
        "task_type": "html_email",
        "agent_node": "office_artifact_agent",
        "output_format": "office_artifact_dsl",
        "validator": "html_email_artifact",
        "default_exports": ["html", "json"],
        "label": "HTML 邮件",
    },
    "web_report_html": {
        "family": "office",
        "engine_type": "web_report_html",
        "task_type": "web_report_html",
        "agent_node": "office_artifact_agent",
        "output_format": "office_artifact_dsl",
        "validator": "web_report_artifact",
        "default_exports": ["html", "json"],
        "label": "网页分析稿",
    },
}


def is_office_artifact(engine_or_type: str | None) -> bool:
    """Return whether an engine/task is one of the first office artifact types."""

    return bool(engine_or_type and engine_or_type in OFFICE_ARTIFACT_TYPES)


def is_diagram_artifact(engine_or_type: str | None) -> bool:
    """Return whether an engine/task is a diagram-oriented artifact."""

    return bool(engine_or_type and engine_or_type in DIAGRAM_ENGINE_TYPES)


def artifact_family_for_engine(engine_type: str | None) -> str:
    """Return the artifact family used for persistence and audit metadata."""

    if is_office_artifact(engine_type):
        return "office"
    if is_diagram_artifact(engine_type):
        return "diagram"
    return "general"


def default_exports_for_engine(engine_type: str | None) -> list[str]:
    """Return recommended export formats for an engine."""

    if engine_type in ARTIFACT_TYPES:
        return list(ARTIFACT_TYPES[engine_type]["default_exports"])
    return ["json", "svg", "png", "pdf", "pptx"]

