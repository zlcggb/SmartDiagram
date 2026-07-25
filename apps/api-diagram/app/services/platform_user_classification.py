"""Classify platform users into registered vs legacy guest buckets."""

from __future__ import annotations

from typing import Any, Literal

from app.models.tenant import User

# Demo accounts authenticate via .env and may exist in DB without password_hash.
_DEMO_USER_IDS = frozenset({"user-member", "local-admin"})

PLATFORM_PRINCIPAL_KIND_KEY = "platform_principal_kind"
LEGACY_GUEST_SESSION_PREFIX = "legacy-"

PrincipalKind = Literal["registered", "demo", "legacy_guest"]


def legacy_guest_session_id(user_id: str) -> str:
    """Stable guest_sessions.id for a migrated legacy users row."""
    return f"{LEGACY_GUEST_SESSION_PREFIX}{user_id}"


def legacy_user_id_from_session(guest_session_id: str) -> str | None:
    if guest_session_id.startswith(LEGACY_GUEST_SESSION_PREFIX):
        return guest_session_id[len(LEGACY_GUEST_SESSION_PREFIX) :]
    return None


def resolve_principal_kind(user: User) -> PrincipalKind:
    """Derive principal kind from password/demo rules (source of truth for migration)."""
    if user.id in _DEMO_USER_IDS:
        return "demo"
    password_hash = str(user.password_hash or "").strip()
    if password_hash:
        return "registered"
    return "legacy_guest"


def stored_principal_kind(user: User) -> PrincipalKind | None:
    preferences = user.preferences_json if isinstance(user.preferences_json, dict) else {}
    raw = str(preferences.get(PLATFORM_PRINCIPAL_KIND_KEY) or "").strip()
    if raw in {"registered", "demo", "legacy_guest"}:
        return raw  # type: ignore[return-value]
    return None


def is_registered_platform_user(user: User) -> bool:
    """Registered/demo users belong in formal user reports and tenant admin lists."""
    kind = stored_principal_kind(user) or resolve_principal_kind(user)
    return kind in {"registered", "demo"}


def is_legacy_guest_user(user: User) -> bool:
    kind = stored_principal_kind(user) or resolve_principal_kind(user)
    return kind == "legacy_guest"


def legacy_user_to_guest_item(
    user: User,
    *,
    tenant_name: str,
    stats: dict[str, Any],
    guest_session_id: str | None = None,
) -> dict[str, Any]:
    """Map a password-less users row (old anonymous principal) to guest list shape."""
    diagram_calls = int(stats.get("diagram_model_calls") or stats.get("total_runs") or 0)
    ppt_calls = int(stats.get("ppt_model_calls") or 0)
    ai_calls = max(diagram_calls + ppt_calls, int(stats.get("total_runs") or 0))
    return {
        "id": guest_session_id or legacy_guest_session_id(user.id),
        "legacy_user_id": user.id,
        "kind": "guest",
        "source": "legacy_user",
        "status": "legacy",
        "email": user.email,
        "display_name": user.display_name or user.email or user.id,
        "tenant_id": user.tenant_id,
        "tenant_name": tenant_name,
        "created_at": user.created_at.isoformat() if user.created_at else "",
        "expires_at": "",
        "last_active_at": str(stats.get("last_active_at") or ""),
        "stats": {
            "ai_calls": ai_calls,
            "diagram_calls": diagram_calls,
            "ppt_calls": ppt_calls,
            "estimated_total_tokens": int(stats.get("estimated_total_tokens") or 0),
            "estimated_cost": round(float(stats.get("estimated_cost") or 0.0), 6),
        },
    }
