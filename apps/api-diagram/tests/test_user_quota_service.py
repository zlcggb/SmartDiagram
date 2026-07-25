import unittest

from app.services.user_quota_service import merge_quota_limits


class MergeQuotaLimitsTests(unittest.TestCase):
    def test_tier_only_applies(self) -> None:
        merged = merge_quota_limits(
            {
                "daily_token_limit": 100_000,
                "monthly_token_limit": 1_000_000,
                "monthly_cost_limit": 5.0,
                "hard_limit_enabled": True,
            },
            None,
        )
        self.assertEqual(merged["daily_token_limit"], 100_000)
        self.assertTrue(merged["hard_limit_enabled"])

    def test_role_tightens_tier(self) -> None:
        merged = merge_quota_limits(
            {
                "daily_token_limit": 500_000,
                "monthly_token_limit": 5_000_000,
                "monthly_cost_limit": 10.0,
                "hard_limit_enabled": True,
            },
            {
                "daily_token_limit": 200_000,
                "monthly_token_limit": 0,
                "monthly_cost_limit": 0.0,
                "hard_limit_enabled": True,
            },
        )
        self.assertEqual(merged["daily_token_limit"], 200_000)
        self.assertEqual(merged["monthly_token_limit"], 5_000_000)

    def test_all_zero_means_unlimited(self) -> None:
        merged = merge_quota_limits(
            {
                "daily_token_limit": 0,
                "monthly_token_limit": 0,
                "monthly_cost_limit": 0.0,
                "hard_limit_enabled": False,
            },
            {
                "daily_token_limit": 0,
                "monthly_token_limit": 0,
                "monthly_cost_limit": 0.0,
                "hard_limit_enabled": False,
            },
        )
        self.assertFalse(merged["hard_limit_enabled"])


if __name__ == "__main__":
    unittest.main()
