"""Platform-wide super-admin helpers (cross-tenant)."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.platform_role_service import (
    PLATFORM_ROLE_ADMIN,
    user_has_platform_admin_in_db,
)


async def user_has_platform_admin_role(
    user: dict[str, Any] | None,
    session: AsyncSession,
) -> bool:
    if not user:
        return False
    roles = {str(role).strip() for role in user.get("roles", []) if str(role).strip()}
    if PLATFORM_ROLE_ADMIN in roles:
        return True
    return await user_has_platform_admin_in_db(
        session,
        user_id=str(user.get("id") or user.get("user_id") or ""),
        email=str(user.get("email") or ""),
    )
