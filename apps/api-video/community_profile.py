"""社区用户公开资料、邮箱脱敏与活跃度。"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from db import db_cursor

POST_VISIBLE = ("published", "outdated")


def mask_email(email: str, *, viewer_id: str | None, owner_id: str, is_admin: bool = False) -> str:
    e = (email or "").strip()
    if not e:
        return ""
    if is_admin or (viewer_id and str(viewer_id) == str(owner_id)):
        return e
    local, sep, domain = e.partition("@")
    if not sep or not domain:
        return "u***"
    if not local:
        return f"***@{domain}"
    return f"{local[0]}***@{domain}"


def author_display_label(row: dict) -> str:
    dn = (row.get("author_display_name") or row.get("display_name") or "").strip()
    if dn:
        return dn
    email = (row.get("author_email") or row.get("email") or "").strip()
    if not email:
        return "同事"
    local = email.split("@")[0]
    return local if len(local) <= 16 else local[:14] + "…"


def serialize_author(
    *,
    user_id: str,
    email: str,
    display_name: str | None,
    avatar_url: str | None,
    viewer_id: str | None,
    is_admin: bool = False,
) -> dict:
    label_row = {"author_email": email, "author_display_name": display_name}
    return {
        "id": str(user_id),
        "display_name": (display_name or "").strip() or None,
        "avatar_url": (avatar_url or "").strip() or None,
        "label": author_display_label(label_row),
        "email": mask_email(email, viewer_id=viewer_id, owner_id=str(user_id), is_admin=is_admin),
    }


def serialize_author_from_join(row: dict, viewer_id: str | None, *, is_admin: bool = False) -> dict:
    uid = str(row.get("author_id") or row.get("user_id") or "")
    return serialize_author(
        user_id=uid,
        email=row.get("author_email") or row.get("email") or "",
        display_name=row.get("author_display_name") or row.get("display_name"),
        avatar_url=row.get("author_avatar_url") or row.get("avatar_url"),
        viewer_id=viewer_id,
        is_admin=is_admin,
    )


def get_user_row(user_id: str) -> dict | None:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT id, email, role, status, display_name, avatar_url, created_at, last_login_at
            FROM users WHERE id = %s::uuid
            """,
            (str(user_id),),
        )
        return cur.fetchone()


def get_public_profile(user_id: str, viewer_id: str, *, is_admin: bool = False) -> dict | None:
    row = get_user_row(user_id)
    if not row or row.get("status") == "disabled":
        return None
    uid = str(row["id"])
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)::int AS c FROM community_posts
            WHERE author_id = %s::uuid AND status IN ('published', 'outdated')
            """,
            (uid,),
        )
        public_posts = int(cur.fetchone()["c"] or 0)
        cur.execute(
            """
            SELECT COUNT(*)::int AS c FROM community_comments
            WHERE user_id = %s::uuid AND status = 'visible'
            """,
            (uid,),
        )
        comments = int(cur.fetchone()["c"] or 0)
    created = row["created_at"]
    member_since = created.isoformat()[:10] if hasattr(created, "isoformat") else str(created)[:10]
    author = serialize_author(
        user_id=uid,
        email=row["email"],
        display_name=row.get("display_name"),
        avatar_url=row.get("avatar_url"),
        viewer_id=viewer_id,
        is_admin=is_admin,
    )
    return {
        **author,
        "member_since": member_since,
        "public_post_count": public_posts,
        "comment_count": comments,
        "is_self": str(viewer_id) == uid,
    }


def _activity_level(count: int) -> int:
    if count <= 0:
        return 0
    if count == 1:
        return 1
    if count <= 3:
        return 2
    if count <= 6:
        return 3
    return 4


def get_user_activity(user_id: str, weeks: int = 52) -> dict:
    weeks = max(1, min(52, weeks))
    days_back = weeks * 7 - 1
    start = date.today() - timedelta(days=days_back)
    uid = str(user_id)
    with db_cursor() as cur:
        cur.execute(
            """
            WITH ev AS (
              SELECT published_at::date AS d FROM community_posts
              WHERE author_id = %s::uuid AND status IN ('published', 'outdated')
                AND published_at IS NOT NULL AND published_at::date >= %s
              UNION ALL
              SELECT updated_at::date FROM community_posts
              WHERE author_id = %s::uuid AND status IN ('published', 'outdated')
                AND updated_at IS NOT NULL AND updated_at::date >= %s
              UNION ALL
              SELECT created_at::date FROM community_comments
              WHERE user_id = %s::uuid AND status = 'visible'
                AND created_at::date >= %s
            )
            SELECT d, COUNT(*)::int AS cnt FROM ev GROUP BY d
            """,
            (uid, start, uid, start, uid, start),
        )
        rows = cur.fetchall()
    by_date: dict[str, int] = {}
    for r in rows:
        d = r["d"]
        key = d.isoformat() if hasattr(d, "isoformat") else str(d)[:10]
        by_date[key] = int(r["cnt"] or 0)
    days_out: list[dict[str, Any]] = []
    for i in range(days_back + 1):
        d = start + timedelta(days=i)
        key = d.isoformat()
        cnt = by_date.get(key, 0)
        days_out.append({"date": key, "count": cnt, "level": _activity_level(cnt)})
    return {
        "weeks": weeks,
        "days": days_out,
        "start_date": start.isoformat(),
        "end_date": date.today().isoformat(),
    }
