"""学习社区后端单元与路由契约测试（TDD）。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

API_VIDEO_DIR = Path(__file__).resolve().parent.parent
if str(API_VIDEO_DIR) not in sys.path:
    sys.path.insert(0, str(API_VIDEO_DIR))


class TestCommunityTDD(unittest.TestCase):
    def test_migration_sql_files_exist(self):
        mig_dir = API_VIDEO_DIR / "migrations"
        self.assertTrue((mig_dir / "004_community.sql").is_file())
        self.assertTrue((mig_dir / "005_community_comment_reports.sql").is_file())
        self.assertTrue((mig_dir / "006_user_avatar_url.sql").is_file())
        self.assertTrue((mig_dir / "007_video_cover_url.sql").is_file())

        sql_004 = (mig_dir / "004_community.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS community_posts", sql_004)
        self.assertIn("CREATE TABLE IF NOT EXISTS community_likes", sql_004)
        self.assertIn("CREATE TABLE IF NOT EXISTS community_favorites", sql_004)
        self.assertIn("CREATE TABLE IF NOT EXISTS community_comments", sql_004)
        self.assertIn("CREATE TABLE IF NOT EXISTS community_blockwords", sql_004)

    def test_comment_moderation_rules(self):
        import community_moderation

        with patch.object(
            community_moderation,
            "_load_blockwords",
            return_value=[("违规词", "contains"), ("精确禁词", "exact")],
        ):
            self.assertEqual(
                community_moderation.validate_comment_body("  总结非常清晰，导图很有帮助！  "),
                "总结非常清晰，导图很有帮助！",
            )
            with self.assertRaises(community_moderation.CommentRejected):
                community_moderation.validate_comment_body("a")
            with self.assertRaises(community_moderation.CommentRejected):
                community_moderation.validate_comment_body("<script>alert(1)</script>好文章")
            with self.assertRaises(community_moderation.CommentRejected):
                community_moderation.validate_comment_body("123456!!!")
            with self.assertRaises(community_moderation.CommentRejected):
                community_moderation.validate_comment_body("大家加微信聊一下")
            with self.assertRaises(community_moderation.CommentRejected):
                community_moderation.validate_comment_body("这里包含违规词内容")
            with self.assertRaises(community_moderation.CommentRejected):
                community_moderation.validate_comment_body("精确禁词")

    def test_profile_email_masking_and_author_serialization(self):
        from community_profile import _activity_level, author_display_label, mask_email, serialize_author

        owner_id = "11111111-1111-1111-1111-111111111111"
        other_id = "22222222-2222-2222-2222-222222222222"

        self.assertEqual(
            mask_email("zora@smartdiagram.com", viewer_id=owner_id, owner_id=owner_id),
            "zora@smartdiagram.com",
        )
        self.assertEqual(
            mask_email("zora@smartdiagram.com", viewer_id=other_id, owner_id=owner_id, is_admin=True),
            "zora@smartdiagram.com",
        )
        self.assertEqual(
            mask_email("zora@smartdiagram.com", viewer_id=other_id, owner_id=owner_id, is_admin=False),
            "z***@smartdiagram.com",
        )

        self.assertEqual(
            author_display_label({"author_display_name": "张工", "author_email": "zhang@corp.com"}),
            "张工",
        )
        self.assertEqual(
            author_display_label({"author_display_name": "", "author_email": "zhang@corp.com"}),
            "zhang",
        )

        author = serialize_author(
            user_id=owner_id,
            email="zora@smartdiagram.com",
            display_name="Zora",
            avatar_url="https://example.com/a.png",
            viewer_id=other_id,
            is_admin=False,
        )
        self.assertEqual(author["id"], owner_id)
        self.assertEqual(author["label"], "Zora")
        self.assertEqual(author["email"], "z***@smartdiagram.com")
        self.assertEqual(author["avatar_url"], "https://example.com/a.png")

        self.assertEqual(_activity_level(0), 0)
        self.assertEqual(_activity_level(1), 1)
        self.assertEqual(_activity_level(3), 2)
        self.assertEqual(_activity_level(5), 3)
        self.assertEqual(_activity_level(8), 4)

    def test_one_click_publish_request_default_confirm(self):
        from community_routes import PublishRequest

        req = PublishRequest(analysis_id="analysis_12345678")
        self.assertTrue(req.confirm)

    def test_get_analysis_for_community_post_preserves_post_status_vs_analysis_status(self):
        from contextlib import contextmanager
        import community_repo
        from community_routes import _summary_payload_from_row

        class FakeCursor:
            def execute(self, sql, params):
                self.sql = sql
                self.params = params

            def fetchone(self):
                return {
                    "post_status": "published",
                    "analysis_id": "a_123",
                    "id": "a_123",
                    "status": "done",
                    "result": {"title": "测试研报", "tldr": "核心摘要"},
                    "video_id": "v_123",
                    "video_title": "测试视频",
                    "source_type": "url",
                    "source_url": "https://www.bilibili.com/video/BV1test",
                    "duration_sec": 300,
                }

        fake_cur = FakeCursor()

        @contextmanager
        def fake_db_cursor():
            yield fake_cur

        with patch.object(community_repo, "db_cursor", fake_db_cursor):
            row = community_repo.get_analysis_for_community_post("b40c0a94-c37f-4738-a0ef-36bc1ab00193")
            self.assertIsNotNone(row)
            self.assertIn("p.status AS post_status", fake_cur.sql)
            self.assertEqual(row["post_status"], "published")
            self.assertEqual(row["status"], "done")
            payload = _summary_payload_from_row(row)
            self.assertEqual(payload["status"], "done")
            self.assertEqual(payload["task_id"], "a_123")
            self.assertEqual(payload["webpage_url"], "https://www.bilibili.com/video/BV1test")

    def test_community_routes_mounted_in_main_app(self):
        from main import app

        paths = set(app.openapi().get("paths", {}).keys())
        expected = {
            "/api/community/posts",
            "/api/community/posts/mine",
            "/api/community/favorites",
            "/api/community/posts/by-analysis/{analysis_id}",
            "/api/community/posts/{post_id}",
            "/api/community/posts/{post_id}/summary",
            "/api/community/posts/{post_id}/playback",
            "/api/community/posts/{post_id}/sync",
            "/api/community/posts/{post_id}/like",
            "/api/community/posts/{post_id}/favorite",
            "/api/community/posts/{post_id}/comments",
            "/api/community/comments/{comment_id}/report",
            "/api/community/users/me",
            "/api/community/users/{user_id}",
            "/api/community/users/{user_id}/posts",
            "/api/community/users/{user_id}/activity",
            "/api/admin/community/posts",
            "/api/admin/community/posts/{post_id}/withdraw",
            "/api/admin/community/comments/{comment_id}/hide",
            "/api/admin/community/comment-reports",
            "/api/admin/community/comment-reports/{report_id}",
            "/api/auth/profile",
            "/api/videos/cover",
        }
        self.assertTrue(expected.issubset(paths), f"Missing routes: {expected - paths}")


if __name__ == "__main__":
    unittest.main()
