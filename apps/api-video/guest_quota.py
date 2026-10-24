"""游客（未登录）每日配额：分析（总结/测验）与问答分别按 IP 计数。

- 配额只对未登录请求生效；登录用户不受限。
- 计数原子化：INSERT ... ON CONFLICT 带 WHERE 上限判断，超限时不返回行。
- 每日上限：分析 GUEST_DAILY_LIMIT（默认 3），问答 GUEST_DAILY_ASK_LIMIT（默认 15）。
"""
from __future__ import annotations

import os

from fastapi import HTTPException, Request

from db import db_cursor


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def guest_daily_limit() -> int:
    return max(30, _env_int("GUEST_DAILY_LIMIT", 30))


def guest_ask_daily_limit() -> int:
    return max(100, _env_int("GUEST_DAILY_ASK_LIMIT", 100))


def client_ip(request: Request) -> str:
    """优先取反向代理透传的真实 IP，其次取直连地址。"""
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if fwd:
        return fwd
    return (request.client.host if request.client else "") or "unknown"


def _quota_status(table: str, ip: str, limit: int) -> dict:
    used = 0
    try:
        with db_cursor() as cur:
            cur.execute(
                f"SELECT count FROM {table} WHERE ip = %s AND day = CURRENT_DATE",
                (ip,),
            )
            row = cur.fetchone()
        if row:
            used = int(row["count"])
    except Exception:  # noqa: BLE001
        # 配额表不可用时按未使用处理，避免阻断游客功能
        used = 0
    return {"limit": limit, "used": used, "remaining": max(0, limit - used)}


def _consume(table: str, ip: str, limit: int, code: str, message: str) -> dict:
    try:
        with db_cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO {table} (ip, day, count)
                VALUES (%s, CURRENT_DATE, 1)
                ON CONFLICT (ip, day)
                DO UPDATE SET count = {table}.count + 1, updated_at = now()
                WHERE {table}.count < %s
                RETURNING count
                """,
                (ip, limit),
            )
            row = cur.fetchone()
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail={"code": "quota_unavailable", "message": f"游客配额服务不可用：{e}"},
        ) from e

    if not row:
        status = _quota_status(table, ip, limit)
        raise HTTPException(
            status_code=429,
            detail={"code": code, "message": message, **status},
        )
    used = int(row["count"])
    return {"limit": limit, "used": used, "remaining": max(0, limit - used)}


def guest_quota_status(ip: str) -> dict:
    return _quota_status("guest_usage", ip, guest_daily_limit())


def consume_guest_quota(ip: str) -> dict:
    """消耗一次游客分析配额（AI 总结 / 测验生成）；超限抛 429。"""
    limit = guest_daily_limit()
    return _consume(
        "guest_usage",
        ip,
        limit,
        "guest_quota_exceeded",
        f"游客今日免费分析 {limit} 次已用完，明天会重置；登录后可继续使用。",
    )


def guest_ask_quota_status(ip: str) -> dict:
    return _quota_status("guest_ask_usage", ip, guest_ask_daily_limit())


def consume_guest_ask_quota(ip: str) -> dict:
    """消耗一次游客问答配额；超限抛 429。"""
    limit = guest_ask_daily_limit()
    return _consume(
        "guest_ask_usage",
        ip,
        limit,
        "guest_ask_quota_exceeded",
        f"游客今日免费提问 {limit} 次已用完，明天会重置；登录后可继续提问。",
    )
