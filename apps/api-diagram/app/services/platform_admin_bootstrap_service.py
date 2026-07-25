"""Startup hook: seed platform admins from env into the database."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logger import logger
from app.services.platform_role_service import bootstrap_platform_admins_from_env

_MIGRATION_LOCK_KEY = "smartdiagram_platform_admin_bootstrap"


async def run_platform_admin_bootstrap(session: AsyncSession) -> dict[str, Any]:
    bind = session.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
            {"lock_key": _MIGRATION_LOCK_KEY},
        )
    return await bootstrap_platform_admins_from_env(session)


async def run_platform_admin_bootstrap_safe() -> dict[str, Any] | None:
    from app.core.config import settings
    from app.core.db import async_session

    if not settings.DATABASE_URL:
        return None

    try:
        async with async_session() as session:
            summary = await run_platform_admin_bootstrap(session)
            logger.info(
                "Platform admin bootstrap completed: "
                f"granted={summary.get('granted')} "
                f"already_had_role={summary.get('already_had_role')} "
                f"user_not_found={summary.get('user_not_found')}"
            )
            return summary
    except Exception as exc:
        logger.warning(f"Platform admin bootstrap skipped: {exc}")
        return None
