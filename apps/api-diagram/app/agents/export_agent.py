"""Export Agent for permission-aware export planning."""

from app.state.state import AgentState
from app.artifacts.catalog import default_exports_for_engine, is_office_artifact
from app.services.permission_service import EXPORT_FORMAT_SCOPES, can_export


SUPPORTED_FORMATS = ["json", "svg", "png", "pdf", "pptx"]
FAST_FORMATS = {"json", "svg", "html", "markdown"}
BACKGROUND_FORMATS = {"png", "pdf", "pptx"}


def _recommended_mode(export_format: str) -> str:
    if export_format in FAST_FORMATS:
        return "sync"
    if export_format in BACKGROUND_FORMATS:
        return "queued"
    return "sync"


def build_export_plan(state: AgentState) -> dict:
    """Build an export plan from engine type and permission context."""

    permission_context = state.get("permission_context", {}) or {}
    engine = state.get("engine_type") or state.get("current_engine") or ""
    task = state.get("task_type") or state.get("current_task") or ""
    allowed_formats: list[dict] = []
    denied_formats: list[dict] = []
    supported_formats = default_exports_for_engine(engine) if is_office_artifact(engine) else SUPPORTED_FORMATS

    for export_format in supported_formats:
        requirement = EXPORT_FORMAT_SCOPES.get(export_format, "export:basic")
        entry = {
            "format": export_format,
            "required_scope": requirement,
            "recommended_mode": _recommended_mode(export_format),
        }
        if can_export(permission_context, export_format):
            allowed_formats.append(entry)
        else:
            denied_formats.append(entry)

    preferred_target = "html" if is_office_artifact(engine) else "svg"
    preferred_format = preferred_target if any(item["format"] == preferred_target for item in allowed_formats) else (
        allowed_formats[0]["format"] if allowed_formats else ""
    )
    return {
        "status": "ready" if allowed_formats else "blocked",
        "engine_type": engine,
        "task_type": task,
        "allowed_formats": allowed_formats,
        "denied_formats": denied_formats,
        "preferred_format": preferred_format,
        "api": {
            "create_export": "/api/diagrams/{diagram_id}/versions/{version_id}/exports",
            "poll_job": "/api/export-jobs/{job_id}",
            "download_url": "/api/export-assets/{asset_id}/download-url",
        },
        "note": (
            "Export API can create versioned assets after the diagram version is persisted."
            if allowed_formats
            else "No export formats are currently allowed by the request scopes."
        ),
    }


async def export_agent_node(state: AgentState) -> dict:
    """Prepare export plan context for downstream UI/API workflows."""

    memory_context = dict(state.get("memory_context", {}) or {})
    export_plan = build_export_plan(state)
    memory_context["export"] = export_plan
    audit_event = (
        {
            "type": "export.plan.created",
            "actor_user_id": (state.get("permission_context", {}) or {}).get("user_id"),
            "tenant_id": (state.get("permission_context", {}) or {}).get("tenant_id"),
            "project_id": (state.get("permission_context", {}) or {}).get("project_id"),
            "message": "Export Agent prepared allowed export formats and modes.",
            "metadata": {
                "status": export_plan["status"],
                "engine_type": export_plan["engine_type"],
                "allowed_formats": [item["format"] for item in export_plan["allowed_formats"]],
                "denied_formats": [item["format"] for item in export_plan["denied_formats"]],
                "preferred_format": export_plan["preferred_format"],
            },
        }
    )
    tool_call = (
        {
            "tool_name": "export.plan",
            "status": "succeeded" if export_plan["allowed_formats"] else "skipped",
            "input_summary": f"engine={export_plan['engine_type']}",
            "output_summary": f"allowed_formats={len(export_plan['allowed_formats'])}",
        }
    )
    return {
        "memory_context": memory_context,
        "audit_events": [audit_event],
        "tool_calls": [tool_call],
    }
