"""Startup migration: classify legacy ghost users and backfill guest_sessions."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logger import logger
from app.models.common import utc_now
from app.models.guest import GuestSession
from app.models.tenant import User
from app.services.guest_session_service import ensure_guest_pool_tenant
from app.services.platform_user_classification import (
    PLATFORM_PRINCIPAL_KIND_KEY,
    legacy_guest_session_id,
    resolve_principal_kind,
)

_MIGRATION_LOCK_KEY = "smartdiagram_guest_identity_migration"


async def _ensure_legacy_guest_session(session: AsyncSession, user: User) -> bool:
    session_id = legacy_guest_session_id(user.id)
    existing = await session.get(GuestSession, session_id)
    if existing:
        if existing.status != "legacy":
            existing.status = "legacy"
        return False

    now = utc_now()
    created_at = user.created_at or now
    session.add(
        GuestSession(
            id=session_id,
            status="legacy",
            created_at=created_at,
            expires_at=created_at,
            last_seen_at=user.updated_at or created_at,
        )
    )
    await session.flush()
    return True


async def run_guest_identity_startup_migration(session: AsyncSession) -> dict[str, Any]:
    """Idempotent migration run on every deploy/startup (local + cloud).

    1. Ensure guest pool tenant exists.
    2. Stamp users.preferences_json.platform_principal_kind from password rules.
    3. Backfill guest_sessions rows for legacy ghost users (legacy-{user_id}).
    """
    bind = session.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
            {"lock_key": _MIGRATION_LOCK_KEY},
        )

    await ensure_guest_pool_tenant(session)

    from app.services.account_profile_service import stamp_account_profiles

    account_summary = await stamp_account_profiles(session)

    users = list((await session.execute(select(User))).scalars().all())
    summary: dict[str, Any] = {
        "users_scanned": len(users),
        "kinds_updated": 0,
        "guest_sessions_created": 0,
        "registered": 0,
        "demo": 0,
        "legacy_guest": 0,
        "account_profiles_stamped": account_summary.get("profiles_stamped", 0),
    }

    for user in users:
        kind = resolve_principal_kind(user)
        summary[kind] = int(summary.get(kind, 0)) + 1

        preferences = dict(user.preferences_json or {})
        if preferences.get(PLATFORM_PRINCIPAL_KIND_KEY) != kind:
            preferences[PLATFORM_PRINCIPAL_KIND_KEY] = kind
            user.preferences_json = preferences
            summary["kinds_updated"] += 1

        if kind == "legacy_guest":
            if await _ensure_legacy_guest_session(session, user):
                summary["guest_sessions_created"] += 1

    await session.commit()
    return summary


async def run_guest_identity_startup_migration_safe() -> dict[str, Any] | None:
    """Run migration outside request scope; never crash app startup."""
    from app.core.config import settings
    from app.core.db import async_session

    if not settings.DATABASE_URL:
        return None

    try:
        async with async_session() as session:
            summary = await run_guest_identity_startup_migration(session)
            logger.info(
                "Guest identity startup migration completed: "
                f"scanned={summary.get('users_scanned')} "
                f"kinds_updated={summary.get('kinds_updated')} "
                f"guest_sessions_created={summary.get('guest_sessions_created')} "
                f"legacy_guest={summary.get('legacy_guest')}"
            )
            return summary
    except Exception as exc:
        logger.warning(f"Guest identity startup migration skipped: {exc}")
        return None
