"""会员订阅 PostgreSQL 存储（用户、订阅、Webhook 幂等）。"""
from __future__ import annotations

from datetime import datetime, timezone

from db import AppDbError, db_cursor

_PRO_STATUSES = frozenset({"active", "trialing"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    # 迁移由 db.run_migrations() 统一负责
    pass


def try_record_webhook_event(event_id: str, event_type: str) -> bool:
    """插入幂等记录；已存在返回 False。"""
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO billing_webhook_events (event_id, event_type, processed_at)
            VALUES (%s, %s, now())
            ON CONFLICT (event_id) DO NOTHING
            """,
            (event_id, event_type),
        )
        return cur.rowcount > 0


def has_webhook_event(event_id: str) -> bool:
    with db_cursor() as cur:
        cur.execute(
            "SELECT 1 FROM billing_webhook_events WHERE event_id = %s LIMIT 1",
            (event_id,),
        )
        return cur.fetchone() is not None


def mark_webhook_event(event_id: str, event_type: str) -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO billing_webhook_events (event_id, event_type, processed_at)
            VALUES (%s, %s, now())
            ON CONFLICT (event_id) DO NOTHING
            """,
            (event_id, event_type),
        )


def upsert_user(
    user_id: str,
    email: str,
    stripe_customer_id: str | None = None,
) -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO billing_users (user_id, email, stripe_customer_id, created_at, updated_at)
            VALUES (%s, %s, %s, now(), now())
            ON CONFLICT (user_id) DO UPDATE SET
              email = EXCLUDED.email,
              stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, billing_users.stripe_customer_id),
              updated_at = now()
            """,
            (user_id, email, stripe_customer_id),
        )


def get_user(user_id: str) -> dict | None:
    with db_cursor() as cur:
        cur.execute("SELECT * FROM billing_users WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    if not row:
        return None
    res = dict(row)
    res["user_id"] = str(res["user_id"])
    return res


def upsert_subscription(
    *,
    stripe_subscription_id: str,
    user_id: str,
    plan: str,
    status: str,
    current_period_end: int | None,
    cancel_at_period_end: bool,
) -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO billing_subscriptions (
              stripe_subscription_id, user_id, plan, status,
              current_period_end, cancel_at_period_end, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (stripe_subscription_id) DO UPDATE SET
              user_id = EXCLUDED.user_id,
              plan = EXCLUDED.plan,
              status = EXCLUDED.status,
              current_period_end = EXCLUDED.current_period_end,
              cancel_at_period_end = EXCLUDED.cancel_at_period_end,
              updated_at = now()
            """,
            (
                stripe_subscription_id,
                user_id,
                plan,
                status,
                current_period_end,
                1 if cancel_at_period_end else 0,
            ),
        )


def get_latest_subscription(user_id: str) -> dict | None:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT * FROM billing_subscriptions
            WHERE user_id = %s
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    data = dict(row)
    data["user_id"] = str(data["user_id"])
    data["cancel_at_period_end"] = bool(data.get("cancel_at_period_end"))
    return data


def is_pro_status(status: str | None) -> bool:
    return (status or "") in _PRO_STATUSES


def membership_status_payload(user_id: str) -> dict:
    sub = get_latest_subscription(user_id)
    if not sub:
        return {
            "is_pro": False,
            "plan": None,
            "status": None,
            "current_period_end": None,
            "cancel_at_period_end": False,
        }
    return {
        "is_pro": is_pro_status(sub["status"]),
        "plan": sub["plan"],
        "status": sub["status"],
        "current_period_end": sub["current_period_end"],
        "cancel_at_period_end": bool(sub["cancel_at_period_end"]),
    }
