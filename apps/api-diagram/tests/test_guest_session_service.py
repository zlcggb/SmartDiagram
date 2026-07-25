import os
import unittest

os.environ["AUTH_SESSION_SECRET"] = "test-secret-for-guest-session"

from app.services.guest_session_service import (
    guest_owner_key,
    issue_guest_session_token,
    verify_guest_session_token,
)


class GuestSessionServiceTests(unittest.TestCase):
    def test_issue_and_verify_guest_token(self):
        issued = issue_guest_session_token("guest-test-1")
        self.assertTrue(issued["access_token"])
        verified = verify_guest_session_token(issued["access_token"])
        self.assertIsNotNone(verified)
        self.assertEqual(verified["guest_id"], "guest-test-1")

    def test_user_token_is_not_guest_token(self):
        from app.services.auth_service import issue_auth_session

        user_session = issue_auth_session(
            {
                "id": "user-1",
                "email": "user@example.com",
                "display_name": "User",
                "role": "member",
                "tenant_id": "tenant-1",
                "team_id": "team-1",
                "project_id": "project-1",
                "roles": ["member"],
                "scopes": ["diagram:read"],
            }
        )
        self.assertIsNone(verify_guest_session_token(user_session["access_token"]))

    def test_guest_owner_key_is_stable(self):
        self.assertEqual(guest_owner_key("abc"), guest_owner_key("abc"))
        self.assertNotEqual(guest_owner_key("abc"), guest_owner_key("def"))


if __name__ == "__main__":
    unittest.main()
