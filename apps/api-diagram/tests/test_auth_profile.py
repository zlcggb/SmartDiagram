import io
import unittest

from PIL import Image

from app.services.auth_service import issue_auth_session, verify_auth_token
from app.services.profile_service import (
    avatar_url_from_preferences,
    normalize_avatar_image,
    validate_display_name,
)


class ProfileServiceTests(unittest.TestCase):
    def test_display_name_is_trimmed_and_validated(self):
        self.assertEqual(validate_display_name("  林 墨  "), "林 墨")

        for invalid in ("", "   ", "a" * 41, "坏\x00名字"):
            with self.subTest(invalid=repr(invalid)):
                with self.assertRaises(ValueError):
                    validate_display_name(invalid)

    def test_avatar_is_square_webp_without_original_metadata(self):
        source = io.BytesIO()
        Image.new("RGB", (720, 360), "#4f8ff7").save(
            source,
            format="PNG",
            pnginfo=None,
        )

        normalized, metadata = normalize_avatar_image(source.getvalue(), "image/png")

        self.assertEqual(metadata["content_type"], "image/webp")
        self.assertEqual(metadata["size_bytes"], len(normalized))
        self.assertEqual(len(metadata["checksum"]), 64)
        with Image.open(io.BytesIO(normalized)) as avatar:
            self.assertEqual(avatar.format, "WEBP")
            self.assertEqual(avatar.size, (512, 512))
            self.assertFalse(avatar.getexif())

    def test_avatar_rejects_svg_and_mime_spoofing(self):
        with self.assertRaises(ValueError):
            normalize_avatar_image(b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml")

        jpeg = io.BytesIO()
        Image.new("RGB", (24, 24), "white").save(jpeg, format="JPEG")
        with self.assertRaises(ValueError):
            normalize_avatar_image(jpeg.getvalue(), "image/png")

    def test_avatar_url_is_versioned_from_preferences(self):
        preferences = {
            "profile": {
                "avatar_storage_key": "tenants/t/users/u/avatar/hash.webp",
                "avatar_checksum": "abcdef1234567890",
                "avatar_content_type": "image/webp",
            }
        }
        self.assertEqual(
            avatar_url_from_preferences("user 1", preferences),
            "/api/auth/avatar/user%201/abcdef1234567890.webp",
        )
        self.assertIsNone(avatar_url_from_preferences("user 1", {}))

    def test_avatar_url_is_not_embedded_in_bearer_token(self):
        auth_user = {
            "id": "user-1",
            "email": "user@example.com",
            "display_name": "林墨",
            "role": "member",
            "tenant_id": "tenant-1",
            "team_id": "team-1",
            "project_id": "project-1",
            "roles": ["member"],
            "scopes": ["diagram:read"],
            "avatar_url": "/api/auth/avatar/user-1/hash.webp",
        }

        issued = issue_auth_session(auth_user)
        token_user = verify_auth_token(issued["access_token"])

        self.assertEqual(issued["user"]["avatar_url"], auth_user["avatar_url"])
        self.assertNotIn("avatar_url", token_user or {})


if __name__ == "__main__":
    unittest.main()
