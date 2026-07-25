import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock

from app.models.tenant import User
from app.services.account_profile_service import (
    AccountProfileMutationError,
    get_account_kind,
    get_account_tier,
    resolve_effective_scopes,
    update_registered_user_account,
)


def _user(**kwargs) -> User:
    defaults = {
        "id": "u1",
        "tenant_id": "tenant-1",
        "email": "user@example.com",
        "password_hash": "hash",
        "display_name": "user",
        "role": "member",
        "status": "active",
        "preferences_json": {
            "platform_principal_kind": "registered",
            "account_tier": "free",
            "account_kind": "customer",
        },
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
    }
    defaults.update(kwargs)
    return User(**defaults)


class AccountProfileServiceTests(unittest.TestCase):
    def test_free_tier_limits_scopes(self) -> None:
        user = _user()
        scopes = resolve_effective_scopes(user)
        self.assertIn("diagram:write", scopes)
        self.assertNotIn("knowledge:write", scopes)
        self.assertNotIn("export:pdf", scopes)

    def test_admin_role_expands_scopes(self) -> None:
        user = _user(role="admin", preferences_json={"account_tier": "free", "account_kind": "customer"})
        scopes = resolve_effective_scopes(user)
        self.assertIn("audit:read", scopes)

    def test_internal_kind_adds_audit(self) -> None:
        user = _user(
            preferences_json={
                "account_tier": "standard",
                "account_kind": "internal",
            }
        )
        scopes = resolve_effective_scopes(user)
        self.assertIn("audit:read", scopes)

    def test_demo_kind_default(self) -> None:
        user = _user(
            id="user-member",
            preferences_json={"platform_principal_kind": "demo"},
        )
        self.assertEqual(get_account_kind(user), "demo")
        self.assertEqual(get_account_tier(user), "standard")


class UpdateRegisteredUserAccountTests(unittest.IsolatedAsyncioTestCase):
    async def test_cannot_modify_self(self) -> None:
        session = AsyncMock()
        with self.assertRaises(AccountProfileMutationError) as ctx:
            await update_registered_user_account(
                session,
                "u1",
                account_tier="pro",
                actor_user_id="u1",
            )
        self.assertEqual(str(ctx.exception), "cannot_modify_self")


if __name__ == "__main__":
    unittest.main()
