import unittest
from unittest.mock import AsyncMock, patch

from app.services.guest_quota_settings_service import (
    default_guest_quota_values,
    evaluate_guest_budget,
    serialize_guest_quota_settings,
)
from app.models.platform_guest_quota import PlatformGuestQuotaSettings


class GuestQuotaSettingsTests(unittest.IsolatedAsyncioTestCase):
    def test_default_values_from_env_shape(self) -> None:
        defaults = default_guest_quota_values()
        self.assertIn("max_uses_per_guest", defaults)
        self.assertIn("hard_limit_enabled", defaults)

    def test_serialize(self) -> None:
        row = PlatformGuestQuotaSettings(
            max_uses_per_guest=5,
            max_uses_per_ip=20,
            window_seconds=86400,
            daily_token_limit=100,
            monthly_token_limit=1000,
            monthly_cost_limit=1.5,
            hard_limit_enabled=True,
        )
        payload = serialize_guest_quota_settings(row)
        self.assertEqual(payload["max_uses_per_guest"], 5)
        self.assertIn("enforcement", payload)

    async def test_evaluate_guest_budget_allows_when_unlimited(self) -> None:
        session = AsyncMock()
        quota_settings = {
            "max_uses_per_guest": 5,
            "max_uses_per_ip": 20,
            "window_seconds": 86400,
            "daily_token_limit": 0,
            "monthly_token_limit": 0,
            "monthly_cost_limit": 0.0,
            "hard_limit_enabled": False,
        }
        with patch(
            "app.services.guest_quota_settings_service.get_guest_quota_snapshot",
            new=AsyncMock(
                return_value={
                    "limits": quota_settings,
                    "usage": {"daily": {"total_tokens": 0}, "monthly": {"total_tokens": 0, "estimated_cost": 0}},
                    "remaining": {},
                }
            ),
        ):
            result = await evaluate_guest_budget(session, "guest-1", {"estimated_total_tokens": 1000}, quota_settings)
        self.assertTrue(result["allowed"])
        self.assertEqual(result["reason"], "guest_quota_unlimited")


if __name__ == "__main__":
    unittest.main()
