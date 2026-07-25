"""Platform role persistence — runtime checks use DB; env is bootstrap-only."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.common import new_id, utc_now
from app.models.platform_role import PLATFORM_ROLE_ADMIN, UserPlatformRole
from app.models.tenant import User

ROLE_SOURCE_BOOTSTRAP_ENV = "bootstrap_env"
ROLE_SOURCE_MANUAL = "manual"
ROLE_SOURCE_REGISTRATION = "bootstrap_registration"


def bootstrap_platform_admin_emails() -> set[str]:
    """Emails from env — used only at startup / registration bootstrap."""
    raw = settings.PLATFORM_ADMIN_EMAILS or ""
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


async def find_user_by_email(session: AsyncSession, email: str) -> User | None:
    normalized = str(email or "").strip().lower()
    if not normalized:
        return None
    statement = select(User).where(User.email == normalized, User.status == "active")
    return (await session.execute(statement)).scalars().first()


async def list_platform_roles_for_user(session: AsyncSession, user_id: str) -> list[str]:
    if not user_id:
        return []
    rows = (
        await session.execute(
            select(UserPlatformRole.role).where(UserPlatformRole.user_id == user_id)
        )
    ).all()
    return sorted({str(row.role) for row in rows if row.role})


async def user_has_platform_admin_in_db(
    session: AsyncSession,
    *,
    user_id: str | None = None,
    email: str | None = None,
) -> bool:
    if user_id:
        roles = await list_platform_roles_for_user(session, user_id)
        if PLATFORM_ROLE_ADMIN in roles:
            return True
    if email:
        user = await find_user_by_email(session, email)
        if user:
            roles = await list_platform_roles_for_user(session, user.id)
            return PLATFORM_ROLE_ADMIN in roles
    return False


async def grant_platform_role(
    session: AsyncSession,
    user_id: str,
    role: str,
    *,
    source: str = ROLE_SOURCE_MANUAL,
) -> bool:
    """Grant a platform role; returns True if a new row was created."""
    existing = (
        await session.execute(
            select(UserPlatformRole).where(
                UserPlatformRole.user_id == user_id,
                UserPlatformRole.role == role,
            )
        )
    ).scalars().first()
    if existing:
        return False

    bind = session.get_bind()
    values = {
        "id": new_id(),
        "user_id": user_id,
        "role": role,
        "source": source,
        "created_at": utc_now(),
    }
    if bind is not None and bind.dialect.name == "postgresql":
        statement = (
            pg_insert(UserPlatformRole.__table__)
            .values(**values)
            .on_conflict_do_nothing(constraint="uq_user_platform_role")
        )
        result = await session.execute(statement)
        await session.flush()
        return int(result.rowcount or 0) > 0

    session.add(UserPlatformRole(**values))
    try:
        await session.flush()
        return True
    except IntegrityError:
        return False


async def revoke_platform_role(session: AsyncSession, user_id: str, role: str) -> bool:
    """Revoke a platform role; returns True if a row was removed."""
    row = (
        await session.execute(
            select(UserPlatformRole).where(
                UserPlatformRole.user_id == user_id,
                UserPlatformRole.role == role,
            )
        )
    ).scalars().first()
    if not row:
        return False
    await session.delete(row)
    await session.flush()
    return True


async def count_platform_admins(session: AsyncSession) -> int:
    rows = (
        await session.execute(
            select(UserPlatformRole.user_id).where(UserPlatformRole.role == PLATFORM_ROLE_ADMIN)
        )
    ).all()
    return len({row.user_id for row in rows if row.user_id})


class PlatformRoleMutationError(ValueError):
    """Stable error codes for platform role updates."""


async def set_user_platform_admin(
    session: AsyncSession,
    target_user_id: str,
    *,
    enabled: bool,
    actor_user_id: str,
) -> list[str]:
    """Grant or revoke platform_admin for a registered user."""
    from app.services.platform_user_classification import is_registered_platform_user

    if actor_user_id and actor_user_id == target_user_id:
        raise PlatformRoleMutationError("cannot_modify_self")

    target = await session.get(User, target_user_id)
    if not target or target.status != "active":
        raise PlatformRoleMutationError("user_not_found")
    if not is_registered_platform_user(target):
        raise PlatformRoleMutationError("legacy_guest_not_eligible")

    if enabled:
        await grant_platform_role(
            session,
            target_user_id,
            PLATFORM_ROLE_ADMIN,
            source=ROLE_SOURCE_MANUAL,
        )
    else:
        if await user_has_platform_admin_in_db(session, user_id=target_user_id):
            admin_count = await count_platform_admins(session)
            if admin_count <= 1:
                raise PlatformRoleMutationError("last_platform_admin")
        await revoke_platform_role(session, target_user_id, PLATFORM_ROLE_ADMIN)

    return await list_platform_roles_for_user(session, target_user_id)


async def bootstrap_platform_admins_from_env(session: AsyncSession) -> dict[str, Any]:
    """One-time-safe startup seed: env emails → user_platform_roles rows."""
    summary: dict[str, Any] = {
        "emails_configured": 0,
        "granted": 0,
        "already_had_role": 0,
        "user_not_found": [],
    }
    emails = bootstrap_platform_admin_emails()
    summary["emails_configured"] = len(emails)

    for email in sorted(emails):
        user = await find_user_by_email(session, email)
        if not user:
            summary["user_not_found"].append(email)
            continue
        if await user_has_platform_admin_in_db(session, user_id=user.id):
            summary["already_had_role"] += 1
            continue
        if await grant_platform_role(
            session,
            user.id,
            PLATFORM_ROLE_ADMIN,
            source=ROLE_SOURCE_BOOTSTRAP_ENV,
        ):
            summary["granted"] += 1

    await session.commit()
    return summary


async def maybe_grant_bootstrap_admin_on_registration(
    session: AsyncSession,
    email: str,
    user_id: str,
) -> bool:
    """If a newly registered email is in bootstrap env, grant platform_admin."""
    normalized = email.strip().lower()
    if normalized not in bootstrap_platform_admin_emails():
        return False
    return await grant_platform_role(
        session,
        user_id,
        PLATFORM_ROLE_ADMIN,
        source=ROLE_SOURCE_REGISTRATION,
    )


async def enrich_user_roles_from_db(session: AsyncSession, user: dict[str, Any]) -> dict[str, Any]:
    """Merge DB platform roles into the user payload returned to clients."""
    user_id = str(user.get("id") or user.get("user_id") or "")
    roles = [str(role) for role in user.get("roles", []) if str(role).strip()]
    for role in await list_platform_roles_for_user(session, user_id):
        if role not in roles:
            roles.append(role)
    user["roles"] = roles
    return user
