"""Human confirmation policy for high-risk exports."""

from typing import Any

from app.core.config import settings


def confirmation_required_formats() -> set[str]:
    """Return export formats that must be explicitly confirmed by a user."""

    raw = settings.EXPORT_CONFIRMATION_REQUIRED_FORMATS.strip().lower()
    if raw in {"", "none", "false", "off", "0"}:
        return set()
    return {item.strip() for item in raw.split(",") if item.strip()}


def export_requires_confirmation(export_format: str) -> bool:
    """Check whether an export format crosses the human-confirmation boundary."""

    return export_format.lower() in confirmation_required_formats()


def confirmation_was_accepted(body: dict[str, Any]) -> bool:
    """Accept common API field names while avoiding truthy string pitfalls."""

    for key in ("confirmed", "human_confirmed", "confirmation_confirmed"):
        value = body.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "y", "confirmed"}
        if isinstance(value, (int, float)) and value == 1:
            return True
    return False


def confirmation_detail(export_format: str, required_scope: str) -> dict[str, Any]:
    """Build a stable client contract for confirmation-required responses."""

    return {
        "reason": "export_confirmation_required",
        "required_confirmation": True,
        "format": export_format,
        "required_scope": required_scope,
        "message": f"{export_format.upper()} 导出需要人工确认后才能继续。",
        "required_action": "resubmit_with_confirmed_true",
    }


def confirmation_metadata(
    *,
    export_format: str,
    diagram_id: str,
    version_id: str,
    mode: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Return metadata safe for audit and job options."""

    return {
        "format": export_format,
        "diagram_id": diagram_id,
        "diagram_version_id": version_id,
        "mode": mode,
        "confirmation_required": True,
        "confirmation_reason": str(body.get("confirmation_reason") or "").strip(),
    }
