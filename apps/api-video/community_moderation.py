"""社区评论内容校验与关键词过滤。"""
from __future__ import annotations

import re

from db import db_cursor

_HTML_RE = re.compile(r"<[^>]+>", re.I)
_COMMENT_MIN = 2
_COMMENT_MAX = 500

_BUILTIN_BLOCK = frozenset(
    w.lower()
    for w in (
        "加微信",
        "私聊转账",
        "赌博",
        "色情",
        "法轮功",
    )
)


class CommentRejected(Exception):
    def __init__(self, message: str, code: str = "comment_rejected"):
        super().__init__(message)
        self.code = code
        self.message = message


def _load_blockwords() -> list[tuple[str, str]]:
    try:
        with db_cursor() as cur:
            cur.execute("SELECT word, match_mode FROM community_blockwords")
            rows = cur.fetchall()
        return [(r["word"].lower(), r["match_mode"]) for r in rows if r.get("word")]
    except Exception:
        return []


def validate_comment_body(raw: str) -> str:
    text = (raw or "").strip()
    if len(text) < _COMMENT_MIN:
        raise CommentRejected(f"评论至少 {_COMMENT_MIN} 个字")
    if len(text) > _COMMENT_MAX:
        raise CommentRejected(f"评论不能超过 {_COMMENT_MAX} 字")
    if _HTML_RE.search(text):
        raise CommentRejected("评论不支持 HTML 标签")
    if re.fullmatch(r"[\s\W\d_]+", text):
        raise CommentRejected("请输入有意义的评论内容")
    lowered = text.lower()
    for w in _BUILTIN_BLOCK:
        if w in lowered:
            raise CommentRejected("评论包含不允许的内容，请修改后重试")
    for word, mode in _load_blockwords():
        if mode == "exact" and lowered == word:
            raise CommentRejected("评论包含不允许的内容，请修改后重试")
        if mode == "contains" and word in lowered:
            raise CommentRejected("评论包含不允许的内容，请修改后重试")
    return text


def count_recent_comments_by_user(user_id: str, within_seconds: int = 60) -> int:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)::int AS cnt
            FROM community_comments
            WHERE user_id = %s::uuid
              AND created_at > now() - (%s || ' seconds')::interval
            """,
            (str(user_id), str(within_seconds)),
        )
        row = cur.fetchone()
    return int(row["cnt"] or 0) if row else 0
