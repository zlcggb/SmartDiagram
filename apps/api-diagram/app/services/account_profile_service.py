"""Account tier/kind classification and effective scope resolution."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import User
from app.services.scope_catalog import ADMIN_SCOPES, MEMBER_SCOPES
from app.services.platform_user_classification import (
    PLATFORM_PRINCIPAL_KIND_KEY,
    resolve_principal_kind,
)

ACCOUNT_TIER_KEY = "account_tier"
ACCOUNT_KIND_KEY = "account_kind"

ACCOUNT_TIERS = ("free", "standard", "pro", "enterprise")
ACCOUNT_KINDS = ("customer", "internal", "test", "demo")

TIER_SCOPES: dict[str, list[str]] = {
    "free": [
        "diagram:read",
        "diagram:write",
        "tool:diagram",
        "export:basic",
        "preference:read",
    ],
    "standard": list(MEMBER_SCOPES),
    "pro": sorted(
        set(MEMBER_SCOPES)
        | {
            "knowledge:write",
            "export:pdf",
            "export:pptx",
            "template:write",
            "preference:write",
        }
    ),
    "enterprise": sorted(set(ADMIN_SCOPES)),
}

KIND_SCOPE_EXTRAS: dict[str, list[str]] = {
    "customer": [],
    "internal": ["audit:read", "approval:read", "approval:write"],
    "test": ["audit:read"],
    "demo": ["template:read", "preference:read"],
}

TENANT_ADMIN_ROLES = {"admin", "owner"}


class AccountProfileMutationError(ValueError):
    """Stable account profile update errors."""


def _preferences(user: User) -> dict[str, Any]:
    return dict(user.preferences_json or {}) if isinstance(user.preferences_json, dict) else {}


def default_account_kind_for_user(user: User) -> str:
    kind = resolve_principal_kind(user)
    if kind == "demo":
        return "demo"
    if kind == "legacy_guest":
        return "test"
    return "customer"


def get_account_tier(user: User) -> str:
    raw = str(_preferences(user).get(ACCOUNT_TIER_KEY) or "").strip().lower()
    return raw if raw in ACCOUNT_TIERS else "standard"


def get_account_kind(user: User) -> str:
    raw = str(_preferences(user).get(ACCOUNT_KIND_KEY) or "").strip().lower()
    if raw in ACCOUNT_KINDS:
        return raw
    return default_account_kind_for_user(user)


def account_profile_payload(user: User) -> dict[str, str]:
    return {
        "account_tier": get_account_tier(user),
        "account_kind": get_account_kind(user),
        "principal_kind": str(_preferences(user).get(PLATFORM_PRINCIPAL_KIND_KEY) or resolve_principal_kind(user)),
    }


def resolve_effective_scopes(user: User) -> list[str]:
    """Merge tier ceiling, account kind extras, and tenant admin role."""
    tier = get_account_tier(user)
    kind = get_account_kind(user)
    scopes = set(TIER_SCOPES.get(tier, MEMBER_SCOPES))
    scopes.update(KIND_SCOPE_EXTRAS.get(kind, []))
    if str(user.role or "").strip().lower() in TENANT_ADMIN_ROLES:
        scopes.update(ADMIN_SCOPES)
    return sorted(scopes)


def set_account_profile_preferences(
    preferences: dict[str, Any],
    *,
    account_tier: str | None = None,
    account_kind: str | None = None,
) -> dict[str, Any]:
    updated = dict(preferences or {})
    if account_tier is not None:
        normalized = str(account_tier).strip().lower()
        if normalized not in ACCOUNT_TIERS:
            raise AccountProfileMutationError("invalid_account_tier")
        updated[ACCOUNT_TIER_KEY] = normalized
    if account_kind is not None:
        normalized = str(account_kind).strip().lower()
        if normalized not in ACCOUNT_KINDS:
            raise AccountProfileMutationError("invalid_account_kind")
        updated[ACCOUNT_KIND_KEY] = normalized
    return updated


async def stamp_account_profiles(session: AsyncSession) -> dict[str, int]:
    """Ensure every user has tier/kind defaults in preferences_json."""
    from sqlalchemy import select

    users = list((await session.execute(select(User))).scalars().all())
    updated = 0
    for user in users:
        preferences = _preferences(user)
        changed = False
        if ACCOUNT_TIER_KEY not in preferences:
            preferences[ACCOUNT_TIER_KEY] = "standard"
            changed = True
        if ACCOUNT_KIND_KEY not in preferences:
            preferences[ACCOUNT_KIND_KEY] = default_account_kind_for_user(user)
            changed = True
        if changed:
            user.preferences_json = preferences
            updated += 1
    if updated:
        await session.flush()
    return {"users_scanned": len(users), "profiles_stamped": updated}


async def update_registered_user_account(
    session: AsyncSession,
    user_id: str,
    *,
    account_tier: str | None = None,
    account_kind: str | None = None,
    tenant_role: str | None = None,
    actor_user_id: str = "",
) -> dict[str, Any]:
    from app.services.platform_user_classification import is_registered_platform_user

    if actor_user_id and actor_user_id == user_id:
        raise AccountProfileMutationError("cannot_modify_self")

    user = await session.get(User, user_id)
    if not user or user.status != "active":
        raise AccountProfileMutationError("user_not_found")
    if not is_registered_platform_user(user):
        raise AccountProfileMutationError("legacy_guest_not_eligible")

    if tenant_role is not None:
        normalized_role = str(tenant_role).strip().lower()
        if normalized_role not in {"member", "admin", "owner"}:
            raise AccountProfileMutationError("invalid_tenant_role")
        user.role = normalized_role

    user.preferences_json = set_account_profile_preferences(
        _preferences(user),
        account_tier=account_tier,
        account_kind=account_kind,
    )
    await session.flush()

    profile = account_profile_payload(user)
    return {
        "user_id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
        **profile,
        "effective_scopes": resolve_effective_scopes(user),
    }
