"""Request-scoped permission context helpers.

This is the MVP foundation for enterprise authorization. It does not enforce
access yet; it normalizes tenant/user/project/team/role/scope data so later RAG,
tool, export, and persistence layers can make consistent decisions.
"""

from typing import Any

from app.state.agent_runtime import PermissionContext


DEFAULT_SCOPES = [
    "diagram:read",
    "diagram:write",
    "artifact:read",
    "artifact:write",
    "tool:diagram",
    "tool:office",
    "export:basic",
    "knowledge:read",
    "knowledge:write",
    "template:read",
    "template:write",
    "preference:read",
    "preference:write",
    "approval:read",
    "approval:write",
]

EXPORT_FORMAT_SCOPES = {
    "json": "export:basic",
    "svg": "export:basic",
    "png": "export:basic",
    "pdf": "export:pdf",
    "pptx": "export:pptx",
    "html": "export:basic",
    "markdown": "export:basic",
    "eml": "export:email",
}


def _first_value(body: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = body.get(key)
        if value not in (None, ""):
            return value
    return None


def _string_list(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


def build_permission_context(body: dict[str, Any]) -> PermissionContext:
    """Build a normalized permission context from API request payload.

    Local development defaults to a single permissive tenant/user so existing
    clients do not need to send auth fields yet.
    """

    tenant_id = str(_first_value(body, "tenant_id", "tenantId") or "local")
    user_id = str(_first_value(body, "user_id", "userId") or "anonymous")
    team_id = _first_value(body, "team_id", "teamId")
    project_id = _first_value(body, "project_id", "projectId")
    roles = _string_list(_first_value(body, "roles", "role")) or ["owner"]
    scopes = _string_list(_first_value(body, "scopes", "scope")) or DEFAULT_SCOPES
    allowed_knowledge_scopes = _string_list(
        _first_value(body, "allowed_knowledge_scopes", "allowedKnowledgeScopes")
    ) or scopes
    allowed_tool_scopes = _string_list(
        _first_value(body, "allowed_tool_scopes", "allowedToolScopes")
    ) or scopes

    context: PermissionContext = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "roles": roles,
        "scopes": scopes,
        "allowed_knowledge_scopes": allowed_knowledge_scopes,
        "allowed_tool_scopes": allowed_tool_scopes,
    }
    if team_id is not None:
        context["team_id"] = str(team_id)
    if project_id is not None:
        context["project_id"] = str(project_id)
    return context


def required_export_scope(export_format: str) -> str:
    """Return the scope required for an export format."""

    return EXPORT_FORMAT_SCOPES.get(export_format.lower(), "export:basic")


def can_export(permission_context: PermissionContext, export_format: str) -> bool:
    """Check whether a permission context allows the requested export."""

    required_scope = required_export_scope(export_format)
    scopes = permission_context.get("scopes", [])
    return required_scope in scopes


def can_read_knowledge(permission_context: PermissionContext) -> bool:
    """Check whether a user can retrieve enterprise knowledge chunks."""

    scopes = permission_context.get("scopes", [])
    return "knowledge:read" in scopes


def can_write_knowledge(permission_context: PermissionContext) -> bool:
    """Check whether a user can ingest enterprise knowledge documents."""

    scopes = permission_context.get("scopes", [])
    return "knowledge:write" in scopes


def can_read_audit(permission_context: PermissionContext) -> bool:
    """Check whether a user can read audit and observability data."""

    scopes = permission_context.get("scopes", [])
    return "audit:read" in scopes


def can_read_template(permission_context: PermissionContext) -> bool:
    """Check whether a user can read governed diagram templates."""

    scopes = permission_context.get("scopes", [])
    return "template:read" in scopes or "knowledge:read" in scopes


def can_write_template(permission_context: PermissionContext) -> bool:
    """Check whether a user can create or update governed diagram templates."""

    scopes = permission_context.get("scopes", [])
    return "template:write" in scopes or "knowledge:write" in scopes


def can_read_preferences(permission_context: PermissionContext) -> bool:
    """Check whether a user can read long-term diagram preferences."""

    scopes = permission_context.get("scopes", [])
    return "preference:read" in scopes


def can_write_preferences(permission_context: PermissionContext) -> bool:
    """Check whether a user can update long-term diagram preferences."""

    scopes = permission_context.get("scopes", [])
    return "preference:write" in scopes
