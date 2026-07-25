import os
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

os.environ["PLATFORM_ADMIN_EMAILS"] = "seed@example.com"

from app.models.tenant import User
from app.services.platform_role_service import (
    PLATFORM_ROLE_ADMIN,
    PlatformRoleMutationError,
    set_user_platform_admin,
)


def _user(**kwargs) -> User:
    defaults = {
        "id": "user-target",
        "tenant_id": "tenant-1",
        "email": "target@example.com",
        "password_hash": "pbkdf2:sha256:1$aa$bb",
        "display_name": "target",
        "role": "member",
        "status": "active",
        "preferences_json": {"platform_principal_kind": "registered"},
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
    }
    defaults.update(kwargs)
    return User(**defaults)


class SetUserPlatformAdminTests(unittest.IsolatedAsyncioTestCase):
    async def test_revoke_last_platform_admin_rejected(self) -> None:
        session = AsyncMock()
        session.get = AsyncMock(return_value=_user())

        with patch(
            "app.services.platform_role_service.user_has_platform_admin_in_db",
            new=AsyncMock(return_value=True),
        ), patch(
            "app.services.platform_role_service.count_platform_admins",
            new=AsyncMock(return_value=1),
        ):
            with self.assertRaises(PlatformRoleMutationError) as ctx:
                await set_user_platform_admin(
                    session, "user-target", enabled=False, actor_user_id="actor-1"
                )
            self.assertEqual(str(ctx.exception), "last_platform_admin")

    async def test_legacy_guest_rejected(self) -> None:
        session = AsyncMock()
        session.get = AsyncMock(
            return_value=_user(
                password_hash=None,
                preferences_json={"platform_principal_kind": "legacy_guest"},
            )
        )

        with patch(
            "app.services.platform_user_classification.is_registered_platform_user",
            return_value=False,
        ):
            with self.assertRaises(PlatformRoleMutationError) as ctx:
                await set_user_platform_admin(
                    session, "ghost", enabled=True, actor_user_id="actor-1"
                )
            self.assertEqual(str(ctx.exception), "legacy_guest_not_eligible")

    async def test_cannot_modify_self(self) -> None:
        session = AsyncMock()
        with self.assertRaises(PlatformRoleMutationError) as ctx:
            await set_user_platform_admin(
                session, "user-target", enabled=True, actor_user_id="user-target"
            )
        self.assertEqual(str(ctx.exception), "cannot_modify_self")


if __name__ == "__main__":
    unittest.main()
