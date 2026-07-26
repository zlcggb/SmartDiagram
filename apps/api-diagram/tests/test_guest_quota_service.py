import unittest
from unittest.mock import AsyncMock, patch

from app.services.guest_quota_service import (
    calculate_next_available_at_ms,
    get_guest_ai_quota_status,
)


class GuestQuotaServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_next_available_time_uses_the_slowest_exhausted_limit(self) -> None:
        result = calculate_next_available_at_ms(
            exhausted=True,
            guest_remaining=0,
            ip_remaining=0,
            guest_oldest_at=100.25,
            ip_oldest_at=102.5,
            window_seconds=60,
        )
        self.assertEqual(result, 162_500)

    def test_next_available_time_is_absent_before_exhaustion(self) -> None:
        result = calculate_next_available_at_ms(
            exhausted=False,
            guest_remaining=1,
            ip_remaining=10,
            guest_oldest_at=100.25,
            ip_oldest_at=100.25,
            window_seconds=60,
        )
        self.assertIsNone(result)

    async def test_quota_status_exposes_next_available_time_from_redis_windows(self) -> None:
        with patch(
            "app.services.guest_quota_service._sliding_window_status",
            new=AsyncMock(side_effect=[(5, 100.25), (20, 102.5)]),
        ):
            status = await get_guest_ai_quota_status(
                "guest-1",
                "127.0.0.1",
                quota_settings={
                    "max_uses_per_guest": 5,
                    "max_uses_per_ip": 20,
                    "window_seconds": 60,
                    "hard_limit_enabled": True,
                },
            )

        self.assertTrue(status["exhausted"])
        self.assertEqual(status["next_available_at_ms"], 162_500)


if __name__ == "__main__":
    unittest.main()
