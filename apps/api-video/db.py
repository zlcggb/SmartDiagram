"""PostgreSQL 连接池、游标上下文与迁移管理器（适配 SmartDiagram 统一 PostgreSQL）。"""
from __future__ import annotations

import logging
import os
import re
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Generator
from urllib.parse import urlparse, urlunparse

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


class AppDbError(RuntimeError):
    """应用数据库访问异常。"""
    pass


def _default_database_url() -> str:
    pw = (os.environ.get("DB_PASSWORD") or "smartdiagram_secret").strip()
    port = (os.environ.get("DB_PORT") or "5432").strip()
    return f"postgresql://postgres:{pw}@127.0.0.1:{port}/vidgrab"


def get_database_url() -> str:
    url = (os.environ.get("VIDEO_DATABASE_URL") or "").strip()
    if url:
        return url
    # 若未显式配置 VIDEO_DATABASE_URL，切勿直接复用指向 ppt_agent 的 DATABASE_URL
    raw_db = (os.environ.get("DATABASE_URL") or "").strip()
    if raw_db and "vidgrab" in raw_db:
        return raw_db
    return _default_database_url()


def _normalize_pg_url(conn_url: str) -> str:
    for prefix in ("postgresql+psycopg://", "postgresql+asyncpg://"):
        if conn_url.startswith(prefix):
            return "postgresql://" + conn_url[len(prefix):]
    return conn_url


def ensure_database_exists() -> None:
    """确保目标数据库（如 vidgrab）在 PostgreSQL 实例中存在（幂等）。"""
    conn_url = _normalize_pg_url(get_database_url())
    parsed = urlparse(conn_url)
    target_db = (parsed.path or "").lstrip("/") or "vidgrab"
    if "?" in target_db:
        target_db = target_db.split("?", 1)[0]
    if not re.match(r"^[a-zA-Z0-9_]+$", target_db):
        return

    admin_parsed = parsed._replace(path="/postgres", query="")
    admin_url = urlunparse(admin_parsed)
    try:
        with psycopg.connect(admin_url, autocommit=True, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target_db,))
                if not cur.fetchone():
                    logger.info("自动创建视频助手数据库: %s", target_db)
                    cur.execute(f'CREATE DATABASE "{target_db}"')
    except Exception as e:
        logger.debug("自动探测/创建数据库跳过 (%s): %s", target_db, e)


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is None:
            ensure_database_exists()
            conn_url = _normalize_pg_url(get_database_url())
            # 移除 Prisma 专用的 ?schema=public 参数以免 psycopg 报错
            if "?schema=" in conn_url:
                conn_url = conn_url.split("?schema=", 1)[0]
            _pool = ConnectionPool(
                conn_url,
                min_size=1,
                max_size=10,
                timeout=10,
                kwargs={"row_factory": dict_row, "autocommit": False},
                open=True,
            )
    return _pool


def close_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.close()
            except Exception as e:
                logger.warning("关闭数据库连接池异常: %s", e)
            _pool = None


def is_db_ready() -> bool:
    try:
        with db_cursor() as cur:
            cur.execute("SELECT 1")
            return bool(cur.fetchone())
    except Exception as e:
        logger.debug("数据库探测未就绪: %s", e)
        return False


def is_app_db_configured() -> bool:
    """是否配置了数据库与认证密钥。"""
    has_secret = bool(
        (os.environ.get("AUTH_SESSION_SECRET") or os.environ.get("AUTH_JWT_SECRET") or "").strip()
    )
    return has_secret and is_db_ready()


@contextmanager
def db_cursor() -> Generator[psycopg.Cursor, None, None]:
    """从连接池借用连接并开启游标，退出上下文时自动提交，异常时回滚。"""
    pool = get_pool()
    try:
        with pool.connection() as conn:
            with conn.cursor() as cur:
                try:
                    yield cur
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
    except psycopg.Error as e:
        raise AppDbError(f"数据库执行错误: {e}") from e


def run_migrations(migrations_dir: str | Path | None = None) -> None:
    """执行 migrations 目录下的所有增量迁移。"""
    ensure_database_exists()
    if migrations_dir is None:
        migrations_dir = Path(__file__).resolve().parent / "migrations"
    else:
        migrations_dir = Path(migrations_dir)

    if not migrations_dir.is_dir():
        logger.warning("未找到迁移目录: %s", migrations_dir)
        return

    sql_files = sorted(migrations_dir.glob("*.sql"))
    if not sql_files:
        return

    with db_cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INT PRIMARY KEY,
              name TEXT NOT NULL,
              applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute("SELECT version FROM schema_migrations")
        applied_versions = {row["version"] for row in cur.fetchall()}

        for sql_file in sql_files:
            match = re.match(r"^(\d+)_", sql_file.name)
            if not match:
                continue
            ver = int(match.group(1))
            if ver in applied_versions:
                continue

            logger.info("正在执行数据库迁移: %s", sql_file.name)
            sql_content = sql_file.read_text(encoding="utf-8")
            cur.execute(sql_content)
            cur.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (%s, %s)",
                (ver, sql_file.name),
            )
            logger.info("数据库迁移成功: %s", sql_file.name)
