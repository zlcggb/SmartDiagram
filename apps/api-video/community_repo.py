"""学习社区数据访问。"""
from __future__ import annotations

import logging
from typing import Any

from community_profile import author_display_label, serialize_author_from_join
from db import db_cursor

logger = logging.getLogger(__name__)

POST_VISIBLE = ("published", "outdated")
POST_STATUSES = ("published", "withdrawn", "invalid", "outdated")


def _serialize_dt(val: Any) -> str | None:
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


def _serialize_post(row: dict, extra: dict | None = None) -> dict:
    if not row:
        return {}
    out = {
        "id": str(row["id"]),
        "author_id": str(row["author_id"]),
        "video_id": str(row["video_id"]) if row.get("video_id") else None,
        "analysis_id": str(row["analysis_id"]) if row.get("analysis_id") else None,
        "status": row["status"],
        "title": row.get("title"),
        "tldr": row.get("tldr"),
        "cover_url": row.get("cover_url") or row.get("video_cover_url"),
        "duration_sec": row.get("duration_sec"),
        "platform": row.get("platform"),
        "source_type": row.get("source_type"),
        "like_count": int(row.get("like_count") or 0),
        "comment_count": int(row.get("comment_count") or 0),
        "favorite_count": int(row.get("favorite_count") or 0),
        "published_at": row["published_at"].isoformat() if row.get("published_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
    }
    if extra:
        out.update(extra)
    return out


def mark_posts_invalid_for_video(video_id: str) -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE community_posts
            SET status = 'invalid', updated_at = now()
            WHERE video_id = %s AND status != 'invalid'
            """,
            (str(video_id),),
        )


def mark_posts_outdated_for_video(video_id: str, except_analysis_id: str) -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE community_posts
            SET status = 'outdated', updated_at = now()
            WHERE video_id = %s
              AND analysis_id != %s
              AND status IN ('published', 'outdated')
            """,
            (str(video_id), str(except_analysis_id)),
        )


def analysis_visible_in_community(analysis_id: str) -> bool:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM community_posts
            WHERE analysis_id = %s AND status IN ('published', 'outdated')
            LIMIT 1
            """,
            (str(analysis_id),),
        )
        return cur.fetchone() is not None


def video_has_community_playback_access(video_id: str) -> bool:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM community_posts
            WHERE video_id = %s AND status IN ('published', 'outdated')
            LIMIT 1
            """,
            (str(video_id),),
        )
        return cur.fetchone() is not None


def get_post_by_id(post_id: str, viewer_id: str | None = None) -> dict | None:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT p.*, u.email AS author_email, u.display_name AS author_display_name,
                   u.avatar_url AS author_avatar_url,
                   v.cover_url AS video_cover_url, v.duration_sec
            FROM community_posts p
            JOIN users u ON u.id = p.author_id
            LEFT JOIN videos v ON v.id = p.video_id
            WHERE p.id = %s
            """,
            (str(post_id),),
        )
        row = cur.fetchone()
    if not row:
        return None
    return _serialize_post(row, _post_extra_author(row, viewer_id))


def get_post_by_video_id(video_id: str) -> dict | None:
    with db_cursor() as cur:
        cur.execute("SELECT * FROM community_posts WHERE video_id = %s", (str(video_id),))
        row = cur.fetchone()
    return _serialize_post(row) if row else None


def _author_label(row: dict) -> str:
    return author_display_label(row)


def _post_extra_author(row: dict, viewer_id: str | None, extra: dict | None = None) -> dict:
    label = _author_label(row)
    out = {
        "author_label": label,
        "author_display_name": row.get("author_display_name") or label,
        "author_email": row.get("author_email"),
        "author_avatar_url": row.get("author_avatar_url"),
        "author": serialize_author_from_join(row, viewer_id),
    }
    if extra:
        out.update(extra)
    return out


def list_posts_feed(
    *,
    sort: str = "new",
    page: int = 1,
    page_size: int = 20,
    viewer_id: str | None = None,
) -> dict:
    offset = (page - 1) * page_size
    order = "p.published_at DESC"
    if sort == "hot":
        order = "p.like_count DESC, p.comment_count DESC, p.published_at DESC"
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)::int AS total FROM community_posts p
            WHERE p.status IN ('published', 'outdated')
            """
        )
        total = int(cur.fetchone()["total"] or 0)
        cur.execute(
            f"""
            SELECT p.*, u.email AS author_email, u.display_name AS author_display_name,
                   u.avatar_url AS author_avatar_url,
                   v.cover_url AS video_cover_url, v.duration_sec
            FROM community_posts p
            JOIN users u ON u.id = p.author_id
            LEFT JOIN videos v ON v.id = p.video_id
            WHERE p.status IN ('published', 'outdated')
            ORDER BY {order}
            LIMIT %s OFFSET %s
            """,
            (page_size, offset),
        )
        rows = cur.fetchall()
    items = []
    liked = set()
    fav = set()
    if viewer_id and rows:
        ids = [str(r["id"]) for r in rows]
        with db_cursor() as cur:
            cur.execute(
                """
                SELECT post_id FROM community_likes
                WHERE user_id = %s::uuid AND post_id = ANY(%s::uuid[])
                """,
                (str(viewer_id), ids),
            )
            liked = {str(r["post_id"]) for r in cur.fetchall()}
            cur.execute(
                """
                SELECT post_id FROM community_favorites
                WHERE user_id = %s::uuid AND post_id = ANY(%s::uuid[])
                """,
                (str(viewer_id), ids),
            )
            fav = {str(r["post_id"]) for r in cur.fetchall()}
    for r in rows:
        pid = str(r["id"])
        items.append(
            _serialize_post(
                r,
                _post_extra_author(
                    r,
                    viewer_id,
                    {
                        "liked": pid in liked,
                        "favorited": pid in fav,
                        "viewer_liked": pid in liked,
                        "viewer_favorited": pid in fav,
                    },
                ),
            )
        )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def list_posts_by_author(
    author_id: str,
    page: int = 1,
    page_size: int = 20,
    *,
    public_only: bool = False,
    viewer_id: str | None = None,
) -> dict:
    offset = (page - 1) * page_size
    if public_only:
        status_where = "status IN ('published', 'outdated')"
        status_where_p = "p.status IN ('published', 'outdated')"
    else:
        status_where = "status != 'invalid'"
        status_where_p = "p.status != 'invalid'"
    with db_cursor() as cur:
        cur.execute(
            f"""
            SELECT COUNT(*)::int AS total FROM community_posts
            WHERE author_id = %s::uuid AND {status_where}
            """,
            (str(author_id),),
        )
        total = int(cur.fetchone()["total"] or 0)
        cur.execute(
            f"""
            SELECT p.*, u.email AS author_email, u.display_name AS author_display_name,
                   u.avatar_url AS author_avatar_url,
                   v.cover_url AS video_cover_url, v.duration_sec
            FROM community_posts p
            JOIN users u ON u.id = p.author_id
            LEFT JOIN videos v ON v.id = p.video_id
            WHERE p.author_id = %s::uuid AND {status_where_p}
            ORDER BY p.updated_at DESC
            LIMIT %s OFFSET %s
            """,
            (str(author_id), page_size, offset),
        )
        rows = cur.fetchall()
    items = []
    for r in rows:
        items.append(_serialize_post(r, _post_extra_author(r, viewer_id)))
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def list_favorites_for_user(user_id: str, page: int = 1, page_size: int = 20) -> dict:
    offset = (page - 1) * page_size
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)::int AS total
            FROM community_favorites f
            JOIN community_posts p ON p.id = f.post_id
            WHERE f.user_id = %s::uuid AND p.status IN ('published', 'outdated')
            """,
            (str(user_id),),
        )
        total = int(cur.fetchone()["total"] or 0)
        cur.execute(
            """
            SELECT p.*, u.email AS author_email, u.display_name AS author_display_name,
                   u.avatar_url AS author_avatar_url,
                   v.cover_url AS video_cover_url, v.duration_sec,
                   f.created_at AS favorited_at
            FROM community_favorites f
            JOIN community_posts p ON p.id = f.post_id
            JOIN users u ON u.id = p.author_id
            LEFT JOIN videos v ON v.id = p.video_id
            WHERE f.user_id = %s::uuid AND p.status IN ('published', 'outdated')
            ORDER BY f.created_at DESC
            LIMIT %s OFFSET %s
            """,
            (str(user_id), page_size, offset),
        )
        rows = cur.fetchall()
    items = []
    for r in rows:
        items.append(
            _serialize_post(
                r,
                _post_extra_author(
                    r,
                    user_id,
                    {
                        "viewer_favorited": True,
                        "favorited_at": r["favorited_at"].isoformat() if r.get("favorited_at") else None,
                    },
                ),
            )
        )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def publish_post(
    *,
    author_id: str,
    analysis_id: str,
) -> dict:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT a.id, a.status, a.user_id, a.video_id, a.result,
                   v.source_type, v.platform, v.title, v.source_url, v.cover_url
            FROM analyses a
            JOIN videos v ON v.id = a.video_id
            WHERE a.id = %s
            """,
            (str(analysis_id),),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError("not_found")
        if str(row["user_id"]) != str(author_id):
            raise ValueError("forbidden")
        if row["status"] != "done":
            raise ValueError("not_done")
        result = row.get("result") or {}
        title = row.get("title") or result.get("title") or "未命名视频"
        tldr = result.get("tldr")
        cover_url = row.get("cover_url")
        cur.execute(
            """
            INSERT INTO community_posts (
              author_id, video_id, analysis_id, status, title, tldr,
              platform, source_type, cover_url, published_at, updated_at
            )
            VALUES (%s::uuid, %s::uuid, %s, 'published', %s, %s, %s, %s, %s, now(), now())
            ON CONFLICT (video_id) DO UPDATE SET
              analysis_id = EXCLUDED.analysis_id,
              status = 'published',
              title = EXCLUDED.title,
              tldr = EXCLUDED.tldr,
              platform = EXCLUDED.platform,
              source_type = EXCLUDED.source_type,
              cover_url = COALESCE(EXCLUDED.cover_url, community_posts.cover_url),
              published_at = CASE
                WHEN community_posts.status = 'withdrawn' THEN now()
                ELSE community_posts.published_at
              END,
              updated_at = now()
            RETURNING *
            """,
            (
                str(author_id),
                str(row["video_id"]),
                str(analysis_id),
                title,
                tldr,
                row.get("platform"),
                row.get("source_type"),
                cover_url,
            ),
        )
        post_row = cur.fetchone()
    return _serialize_post(post_row)


def withdraw_post(post_id: str, author_id: str, is_admin: bool = False) -> bool:
    with db_cursor() as cur:
        if is_admin:
            cur.execute(
                """
                UPDATE community_posts SET status = 'withdrawn', updated_at = now()
                WHERE id = %s AND status != 'invalid'
                RETURNING id
                """,
                (str(post_id),),
            )
        else:
            cur.execute(
                """
                UPDATE community_posts SET status = 'withdrawn', updated_at = now()
                WHERE id = %s AND author_id = %s::uuid AND status != 'invalid'
                RETURNING id
                """,
                (str(post_id), str(author_id)),
            )
        return cur.fetchone() is not None


def sync_post_to_latest_analysis(post_id: str, author_id: str) -> dict | None:
    with db_cursor() as cur:
        cur.execute(
            "SELECT * FROM community_posts WHERE id = %s AND author_id = %s::uuid",
            (str(post_id), str(author_id)),
        )
        post = cur.fetchone()
        if not post:
            return None
        cur.execute(
            """
            SELECT a.id, a.result, v.title, v.platform
            FROM analyses a
            JOIN videos v ON v.id = a.video_id
            WHERE a.video_id = %s AND a.status = 'done'
            ORDER BY a.finished_at DESC NULLS LAST, a.created_at DESC
            LIMIT 1
            """,
            (str(post["video_id"]),),
        )
        latest = cur.fetchone()
        if not latest:
            return None
        result = latest.get("result") or {}
        title = latest.get("title") or result.get("title") or post.get("title")
        tldr = result.get("tldr")
        cur.execute(
            """
            UPDATE community_posts
            SET analysis_id = %s, status = 'published', title = %s, tldr = %s,
                platform = COALESCE(%s, platform), updated_at = now()
            WHERE id = %s
            RETURNING *
            """,
            (str(latest["id"]), title, tldr, latest.get("platform"), str(post_id)),
        )
        updated = cur.fetchone()
    return _serialize_post(updated) if updated else None


def get_analysis_for_community_post(post_id: str) -> dict | None:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT p.status AS post_status, p.analysis_id, a.*, v.source_type, v.source_url,
                   v.title AS video_title, v.platform, v.duration_sec, v.storage_status,
                   COALESCE(p.cover_url, v.cover_url) AS cover_url
            FROM community_posts p
            JOIN analyses a ON a.id = p.analysis_id
            JOIN videos v ON v.id = p.video_id
            WHERE p.id = %s
            """,
            (str(post_id),),
        )
        row = cur.fetchone()
    if not row:
        return None
    post_status = row["post_status"]
    if post_status not in POST_VISIBLE and post_status != "withdrawn":
        if post_status == "invalid":
            return {"invalid": True, "status": "invalid", "post_status": "invalid"}
        return None
    if post_status == "withdrawn":
        return {"withdrawn": True, "status": "withdrawn", "post_status": post_status}
    return dict(row)


def toggle_like(post_id: str, user_id: str) -> dict:
    with db_cursor() as cur:
        cur.execute(
            "SELECT status FROM community_posts WHERE id = %s",
            (str(post_id),),
        )
        post = cur.fetchone()
        if not post or post["status"] not in POST_VISIBLE:
            raise ValueError("not_available")
        cur.execute(
            "SELECT 1 FROM community_likes WHERE post_id = %s AND user_id = %s::uuid",
            (str(post_id), str(user_id)),
        )
        if cur.fetchone():
            cur.execute(
                "DELETE FROM community_likes WHERE post_id = %s AND user_id = %s::uuid",
                (str(post_id), str(user_id)),
            )
            liked = False
        else:
            cur.execute(
                "INSERT INTO community_likes (post_id, user_id) VALUES (%s, %s::uuid)",
                (str(post_id), str(user_id)),
            )
            liked = True
        cur.execute(
            """
            UPDATE community_posts SET like_count = (
              SELECT COUNT(*)::int FROM community_likes WHERE post_id = %s
            ), updated_at = now()
            WHERE id = %s
            RETURNING like_count
            """,
            (str(post_id), str(post_id)),
        )
        cnt = int(cur.fetchone()["like_count"] or 0)
    return {"liked": liked, "like_count": cnt}


def toggle_favorite(post_id: str, user_id: str) -> dict:
    with db_cursor() as cur:
        cur.execute(
            "SELECT status FROM community_posts WHERE id = %s",
            (str(post_id),),
        )
        post = cur.fetchone()
        if not post or post["status"] not in POST_VISIBLE:
            raise ValueError("not_available")
        cur.execute(
            "SELECT 1 FROM community_favorites WHERE post_id = %s AND user_id = %s::uuid",
            (str(post_id), str(user_id)),
        )
        if cur.fetchone():
            cur.execute(
                "DELETE FROM community_favorites WHERE post_id = %s AND user_id = %s::uuid",
                (str(post_id), str(user_id)),
            )
            fav = False
        else:
            cur.execute(
                "INSERT INTO community_favorites (post_id, user_id) VALUES (%s, %s::uuid)",
                (str(post_id), str(user_id)),
            )
            fav = True
        cur.execute(
            """
            UPDATE community_posts SET favorite_count = (
              SELECT COUNT(*)::int FROM community_favorites WHERE post_id = %s
            ), updated_at = now()
            WHERE id = %s
            RETURNING favorite_count
            """,
            (str(post_id), str(post_id)),
        )
        cnt = int(cur.fetchone()["favorite_count"] or 0)
    return {"favorited": fav, "favorite_count": cnt}


def list_comments(post_id: str, limit: int = 100, viewer_id: str | None = None) -> list[dict]:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT c.*, u.email, u.display_name, u.avatar_url
            FROM community_comments c
            JOIN users u ON u.id = c.user_id
            WHERE c.post_id = %s AND c.status = 'visible'
            ORDER BY c.created_at ASC
            LIMIT %s
            """,
            (str(post_id), limit),
        )
        rows = cur.fetchall()
    out = []
    for r in rows:
        row_author = {
            "user_id": r["user_id"],
            "email": r.get("email"),
            "display_name": r.get("display_name"),
            "avatar_url": r.get("avatar_url"),
        }
        out.append(
            {
                "id": str(r["id"]),
                "post_id": str(r["post_id"]),
                "user_id": str(r["user_id"]),
                "author_id": str(r["user_id"]),
                "body": r["body"],
                "status": r.get("status") or "visible",
                "author_label": _author_label(
                    {"author_email": r.get("email"), "author_display_name": r.get("display_name")}
                ),
                "author_email": r.get("email"),
                "author_display_name": r.get("display_name"),
                "author_avatar_url": r.get("avatar_url"),
                "author": serialize_author_from_join(row_author, viewer_id),
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
            }
        )
    return out


def get_comment_by_id(comment_id: str) -> dict | None:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT c.*, p.status AS post_status
            FROM community_comments c
            JOIN community_posts p ON p.id = c.post_id
            WHERE c.id = %s
            """,
            (str(comment_id),),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "post_id": str(row["post_id"]),
        "user_id": str(row["user_id"]),
        "body": row["body"],
        "status": row["status"],
        "post_status": row["post_status"],
    }


def create_comment_report(
    comment_id: str,
    reporter_id: str,
    reason: str | None = None,
) -> dict:
    reason_text = (reason or "").strip()[:500] or None
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO community_comment_reports (comment_id, reporter_id, reason)
            VALUES (%s, %s::uuid, %s)
            ON CONFLICT (comment_id, reporter_id) DO UPDATE SET
              reason = COALESCE(EXCLUDED.reason, community_comment_reports.reason),
              status = CASE
                WHEN community_comment_reports.status = 'dismissed' THEN 'open'
                ELSE community_comment_reports.status
              END,
              created_at = CASE
                WHEN community_comment_reports.status = 'dismissed' THEN now()
                ELSE community_comment_reports.created_at
              END
            RETURNING *
            """,
            (str(comment_id), str(reporter_id), reason_text),
        )
        row = cur.fetchone()
    res = dict(row)
    res["id"] = int(res["id"])
    res["comment_id"] = str(res["comment_id"])
    res["reporter_id"] = str(res["reporter_id"])
    res["created_at"] = _serialize_dt(res.get("created_at"))
    return res


def count_recent_reports_by_user(user_id: str, within_seconds: int = 300) -> int:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)::int AS cnt
            FROM community_comment_reports
            WHERE reporter_id = %s::uuid
              AND created_at > now() - (%s || ' seconds')::interval
            """,
            (str(user_id), str(within_seconds)),
        )
        row = cur.fetchone()
    return int(row["cnt"] or 0) if row else 0


def list_comment_reports_admin(
    *,
    status: str | None = "open",
    page: int = 1,
    page_size: int = 30,
) -> dict:
    offset = (page - 1) * page_size
    cond = ""
    params: list[Any] = []
    if status:
        cond = "WHERE r.status = %s"
        params.append(status)
    with db_cursor() as cur:
        cur.execute(
            f"SELECT COUNT(*)::int AS total FROM community_comment_reports r {cond}",
            tuple(params),
        )
        total = int(cur.fetchone()["total"] or 0)
        cur.execute(
            f"""
            SELECT r.*, c.body AS comment_body, c.post_id,
                   u.email AS reporter_email, u2.email AS comment_author_email
            FROM community_comment_reports r
            JOIN community_comments c ON c.id = r.comment_id
            JOIN users u ON u.id = r.reporter_id
            JOIN users u2 ON u2.id = c.user_id
            {cond}
            ORDER BY r.created_at DESC
            LIMIT %s OFFSET %s
            """,
            (*params, page_size, offset),
        )
        rows = cur.fetchall()
    items = []
    for r in rows:
        items.append(
            {
                "id": int(r["id"]),
                "comment_id": str(r["comment_id"]),
                "post_id": str(r["post_id"]),
                "reporter_email": r.get("reporter_email"),
                "comment_author_email": r.get("comment_author_email"),
                "comment_body": r.get("comment_body"),
                "reason": r.get("reason"),
                "status": r.get("status"),
                "admin_note": r.get("admin_note"),
                "created_at": _serialize_dt(r.get("created_at")),
            }
        )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def resolve_comment_report(
    report_id: int,
    action: str,
    admin_note: str | None = None,
) -> bool:
    note = (admin_note or "").strip()[:1000] or None
    with db_cursor() as cur:
        cur.execute(
            "SELECT comment_id, status FROM community_comment_reports WHERE id = %s",
            (report_id,),
        )
        rep = cur.fetchone()
        if not rep or rep["status"] != "open":
            return False
        if action == "hide":
            cur.execute(
                """
                UPDATE community_comments SET status = 'hidden'
                WHERE id = %s
                RETURNING post_id
                """,
                (str(rep["comment_id"]),),
            )
            crow = cur.fetchone()
            if crow:
                pid = str(crow["post_id"])
                cur.execute(
                    """
                    UPDATE community_posts SET comment_count = (
                      SELECT COUNT(*)::int FROM community_comments
                      WHERE post_id = %s AND status = 'visible'
                    )
                    WHERE id = %s
                    """,
                    (pid, pid),
                )
            new_status = "reviewed"
        elif action == "dismiss":
            new_status = "dismissed"
        else:
            return False
        cur.execute(
            """
            UPDATE community_comment_reports
            SET status = %s, admin_note = COALESCE(%s, admin_note), reviewed_at = now()
            WHERE id = %s
            """,
            (new_status, note, report_id),
        )
    return True


def count_open_comment_reports() -> int:
    try:
        with db_cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)::int AS cnt FROM community_comment_reports
                WHERE status = 'open'
                """
            )
            row = cur.fetchone()
        return int(row["cnt"] or 0) if row else 0
    except Exception:
        return 0


def add_comment(post_id: str, user_id: str, body: str) -> dict:
    with db_cursor() as cur:
        cur.execute(
            "SELECT status FROM community_posts WHERE id = %s",
            (str(post_id),),
        )
        post = cur.fetchone()
        if not post or post["status"] not in POST_VISIBLE:
            raise ValueError("not_available")
        cur.execute(
            """
            INSERT INTO community_comments (post_id, user_id, body)
            VALUES (%s, %s::uuid, %s)
            RETURNING *
            """,
            (str(post_id), str(user_id), body),
        )
        row = cur.fetchone()
        cur.execute(
            """
            UPDATE community_posts SET comment_count = (
              SELECT COUNT(*)::int FROM community_comments
              WHERE post_id = %s AND status = 'visible'
            ), updated_at = now()
            WHERE id = %s
            """,
            (str(post_id), str(post_id)),
        )
        cur.execute(
            """
            SELECT c.*, u.email, u.display_name, u.avatar_url
            FROM community_comments c
            JOIN users u ON u.id = c.user_id
            WHERE c.id = %s
            """,
            (str(row["id"]),),
        )
        full = cur.fetchone()
    row_author = {
        "user_id": full["user_id"],
        "email": full.get("email"),
        "display_name": full.get("display_name"),
        "avatar_url": full.get("avatar_url"),
    }
    return {
        "id": str(full["id"]),
        "post_id": str(full["post_id"]),
        "user_id": str(full["user_id"]),
        "author_id": str(full["user_id"]),
        "body": full["body"],
        "status": full.get("status") or "visible",
        "author_label": _author_label(
            {"author_email": full.get("email"), "author_display_name": full.get("display_name")}
        ),
        "author_email": full.get("email"),
        "author_display_name": full.get("display_name"),
        "author_avatar_url": full.get("avatar_url"),
        "author": serialize_author_from_join(row_author, str(user_id)),
        "created_at": full["created_at"].isoformat() if full.get("created_at") else None,
    }


def hide_comment(comment_id: str) -> bool:
    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE community_comments SET status = 'hidden'
            WHERE id = %s
            RETURNING post_id
            """,
            (str(comment_id),),
        )
        row = cur.fetchone()
        if not row:
            return False
        pid = str(row["post_id"])
        cur.execute(
            """
            UPDATE community_posts SET comment_count = (
              SELECT COUNT(*)::int FROM community_comments
              WHERE post_id = %s AND status = 'visible'
            )
            WHERE id = %s
            """,
            (pid, pid),
        )
    return True


def list_posts_admin(page: int = 1, page_size: int = 30, status: str | None = None) -> dict:
    offset = (page - 1) * page_size
    cond = ""
    params: list[Any] = []
    if status:
        cond = "WHERE p.status = %s"
        params.append(status)
    with db_cursor() as cur:
        cur.execute(f"SELECT COUNT(*)::int AS total FROM community_posts p {cond}", tuple(params))
        total = int(cur.fetchone()["total"] or 0)
        cur.execute(
            f"""
            SELECT p.*, u.email AS author_email
            FROM community_posts p
            JOIN users u ON u.id = p.author_id
            {cond}
            ORDER BY p.updated_at DESC
            LIMIT %s OFFSET %s
            """,
            (*params, page_size, offset),
        )
        rows = cur.fetchall()
    items = []
    for r in rows:
        items.append(_serialize_post(r, {"author_email": r.get("author_email")}))
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def viewer_flags(post_id: str, user_id: str) -> dict:
    with db_cursor() as cur:
        cur.execute(
            "SELECT 1 FROM community_likes WHERE post_id = %s AND user_id = %s::uuid",
            (str(post_id), str(user_id)),
        )
        liked = cur.fetchone() is not None
        cur.execute(
            "SELECT 1 FROM community_favorites WHERE post_id = %s AND user_id = %s::uuid",
            (str(post_id), str(user_id)),
        )
        fav = cur.fetchone() is not None
    return {
        "liked": liked,
        "favorited": fav,
        "viewer_liked": liked,
        "viewer_favorited": fav,
    }
