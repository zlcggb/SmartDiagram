import unittest
from datetime import datetime, timezone

from app.models.tenant import User
from app.services.platform_user_classification import (
    PLATFORM_PRINCIPAL_KIND_KEY,
    is_legacy_guest_user,
    is_registered_platform_user,
    legacy_guest_session_id,
    legacy_user_id_from_session,
    legacy_user_to_guest_item,
    resolve_principal_kind,
)


def _user(**kwargs) -> User:
    defaults = {
        "id": "u1",
        "tenant_id": "tenant-1",
        "email": "ghost@local.smartdiagram",
        "password_hash": None,
        "display_name": "ghost",
        "role": "member",
        "status": "active",
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
    }
    defaults.update(kwargs)
    return User(**defaults)


class PlatformUserClassificationTests(unittest.TestCase):
    def test_registered_user_with_password(self):
        user = _user(password_hash="pbkdf2:sha256:600000$aa$bb", email="real@example.com")
        self.assertEqual(resolve_principal_kind(user), "registered")
        self.assertTrue(is_registered_platform_user(user))
        self.assertFalse(is_legacy_guest_user(user))

    def test_legacy_guest_without_password(self):
        user = _user(email="anonymous@local.smartdiagram", display_name="anonymous")
        self.assertEqual(resolve_principal_kind(user), "legacy_guest")
        self.assertFalse(is_registered_platform_user(user))
        self.assertTrue(is_legacy_guest_user(user))

    def test_demo_user_without_password_counts_as_registered(self):
        user = _user(id="user-member", email="user@smartdiagram.local")
        self.assertEqual(resolve_principal_kind(user), "demo")
        self.assertTrue(is_registered_platform_user(user))

    def test_stored_principal_kind_overrides_missing_password(self):
        user = _user(
            id="ghost",
            preferences_json={PLATFORM_PRINCIPAL_KIND_KEY: "legacy_guest"},
            password_hash="pbkdf2:sha256:600000$aa$bb",
        )
        self.assertTrue(is_legacy_guest_user(user))

    def test_legacy_guest_session_mapping(self):
        self.assertEqual(legacy_guest_session_id("anonymous"), "legacy-anonymous")
        self.assertEqual(legacy_user_id_from_session("legacy-anonymous"), "anonymous")
        self.assertIsNone(legacy_user_id_from_session("fresh-guest-id"))

    def test_legacy_user_to_guest_item(self):
        user = _user(id="anonymous", display_name="anonymous")
        item = legacy_user_to_guest_item(
            user,
            tenant_name="local",
            stats={
                "total_runs": 3,
                "diagram_model_calls": 2,
                "ppt_model_calls": 1,
                "estimated_total_tokens": 1200,
                "estimated_cost": 0.12,
                "last_active_at": "2026-07-01T00:00:00+00:00",
            },
        )
        self.assertEqual(item["source"], "legacy_user")
        self.assertEqual(item["status"], "legacy")
        self.assertEqual(item["id"], "legacy-anonymous")
        self.assertEqual(item["stats"]["ai_calls"], 3)


if __name__ == "__main__":
    unittest.main()
