import unittest
from unittest.mock import patch

from app.services.platform_role_service import bootstrap_platform_admin_emails


class PlatformAdminBootstrapConfigTests(unittest.TestCase):
    def test_bootstrap_platform_admin_emails(self):
        with patch(
            "app.services.platform_role_service.settings.PLATFORM_ADMIN_EMAILS",
            "admin@example.com, owner@example.com",
        ):
            emails = bootstrap_platform_admin_emails()
        self.assertEqual(emails, {"admin@example.com", "owner@example.com"})


if __name__ == "__main__":
    unittest.main()
