"""SQLite 单库：用户账号 + 会员/订阅/Webhook 幂等。"""
from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_users (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES billing_users(user_id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  status TEXT NOT NULL,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_sub_user ON billing_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
"""


class AppDbError(RuntimeError):
    pass


def db_path() -> Path:
    raw = (os.environ.get("APP_DB_PATH") or "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent / "data" / "app.db"


def _open_connection() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    # 该应用按 Docker 单副本部署。WAL 允许读操作在短暂写入期间继续执行，
    # busy_timeout 则避免 webhook 与 API 同时提交时直接报“database is locked”。
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 10000")
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn


def is_app_db_configured() -> bool:
    """SQLite 始终可用（自动建库）；有 AUTH_JWT_SECRET 表示登录已配置。"""
    return bool((os.environ.get("AUTH_JWT_SECRET") or "").strip())


@contextmanager
def db_cursor():
    global _conn
    with _lock:
        if _conn is None:
            _conn = _open_connection()
        cur = _conn.cursor()
        try:
            yield cur
            _conn.commit()
        except Exception:
            _conn.rollback()
            raise
        finally:
            cur.close()
