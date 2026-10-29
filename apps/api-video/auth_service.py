"""统一认证与用户仓储服务（对接 SmartDiagram 平台令牌 + 兼容本地 JWT）。"""
from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import logging
import os
import re
import time
from typing import Any
import uuid

import bcrypt
import jwt
import psycopg.errors

from db import AppDbError, db_cursor

logger = logging.getLogger(__name__)

JWT_ALG = "HS256"
JWT_EXPIRE_DAYS = int(os.environ.get("AUTH_JWT_EXPIRE_DAYS", "30"))
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MAX_AVATAR_URL_LEN = 320_000
_AVATAR_DATA_URL_RE = re.compile(
    r"^data:image/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$",
    re.IGNORECASE,
)


class AuthError(ValueError):
    pass


class AccountDisabledError(AuthError):
    pass


def jwt_secret() -> str:
    secret = (
        os.environ.get("AUTH_SESSION_SECRET")
        or os.environ.get("AUTH_JWT_SECRET")
        or "smartdiagram-dev-session-secret-change-me"
    ).strip()
    return secret


def is_auth_configured() -> bool:
    return bool(jwt_secret())


def _to_valid_uuid(raw_id: str) -> str:
    """将任意平台 user_id（如 'local-admin' 或 UUID）确定性映射为合法 UUID 字符串。"""
    clean = (raw_id or "").strip()
    try:
        return str(uuid.UUID(clean))
    except (ValueError, AttributeError):
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"smartdiagram.user:{clean}"))


def _b64_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64_decode(raw: str) -> bytes:
    padding = "=" * ((4 - len(raw) % 4) % 4)
    return base64.urlsafe_b64decode((raw + padding).encode("ascii"))


def _platform_sign(payload_text: str, secret: str) -> str:
    return _b64_encode(
        hmac.new(
            secret.encode("utf-8"),
            payload_text.encode("utf-8"),
            hashlib.sha256,
        ).digest()
    )


def verify_platform_token(token: str) -> dict[str, Any] | None:
    """校验 SmartDiagram 平台签发的 Bearer Token (payload_b64.signature)。"""
    if not token or "." not in token or token.count(".") != 1:
        return None
    payload_text, signature = token.rsplit(".", 1)
    secret = (
        os.environ.get("AUTH_SESSION_SECRET")
        or "smartdiagram-dev-session-secret-change-me"
    ).strip()
    if not hmac.compare_digest(_platform_sign(payload_text, secret), signature):
        return None
    try:
        payload = json.loads(_b64_decode(payload_text).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None

    if int(payload.get("exp") or 0) < int(time.time()):
        return None

    # 平台访客会话 Token (kind == "guest") 视为未登录访客
    if payload.get("kind") == "guest" or payload.get("iss") == "smartdiagram-guest-auth":
        return {"kind": "guest", "guest_id": payload.get("guest_id")}

    user = payload.get("user")
    if not isinstance(user, dict):
        return None

    raw_uid = str(user.get("id") or user.get("user_id") or "").strip()
    if not raw_uid:
        return None

    roles = [str(r).lower() for r in (user.get("roles") or [])]
    primary_role = str(user.get("role") or "").lower()
    is_admin = primary_role in ("admin", "owner", "platform_admin") or any(
        r in ("admin", "owner", "platform_admin") for r in roles
    )
    mapped_role = "admin" if is_admin else "user"
    email = str(user.get("email") or f"{raw_uid}@smartdiagram.local").strip().lower()
    display_name = str(user.get("display_name") or email.split("@")[0]).strip()

    return {
        "kind": "user",
        "id": _to_valid_uuid(raw_uid),
        "raw_id": raw_uid,
        "email": email,
        "display_name": display_name,
        "role": mapped_role,
    }


def ensure_platform_user_synced(platform_user: dict[str, Any]) -> dict[str, Any]:
    """将平台登录用户自动同步到 vidgrab 数据库 users 表（幂等）。"""
    uid = platform_user["id"]
    email = platform_user["email"]
    role = platform_user["role"]
    display_name = platform_user.get("display_name") or email.split("@")[0]

    with db_cursor() as cur:
        # 先按 id 或 email 查找
        cur.execute(
            """
            SELECT id, email, role, status, display_name, avatar_url, created_at, last_login_at
            FROM users
            WHERE id = %s OR LOWER(email) = LOWER(%s)
            ORDER BY (id = %s) DESC
            LIMIT 1
            """,
            (uid, email, uid),
        )
        existing = cur.fetchone()
        if existing:
            if existing.get("status") == "disabled":
                raise AccountDisabledError("账号已被禁用，请联系系统管理员")
            # 若平台侧是 admin，同步提权并更新最近活跃时间
            new_role = "admin" if role == "admin" else (existing.get("role") or "user")
            cur.execute(
                """
                UPDATE users
                SET last_login_at = now(),
                    role = %s,
                    display_name = COALESCE(NULLIF(display_name, ''), %s)
                WHERE id = %s
                RETURNING id, email, role, status, display_name, avatar_url, created_at, last_login_at
                """,
                (new_role, display_name, existing["id"]),
            )
            row = cur.fetchone()
            return _serialize_user_row(row)  # type: ignore[return-value]

        cur.execute(
            """
            INSERT INTO users (id, email, password_hash, role, status, display_name, last_login_at)
            VALUES (%s, %s, %s, %s, 'active', %s, now())
            ON CONFLICT (id) DO UPDATE SET
                last_login_at = now()
            RETURNING id, email, role, status, display_name, avatar_url, created_at, last_login_at
            """,
            (uid, email, "platform_sso", role, display_name),
        )
        row = cur.fetchone()
    return _serialize_user_row(row)  # type: ignore[return-value]


def get_allowed_email_domains() -> list[str]:
    raw = (os.environ.get("AUTH_ALLOWED_EMAIL_DOMAINS") or "").strip()
    if not raw:
        return []
    return [d.strip().lower() for d in raw.split(",") if d.strip()]


def check_email_domain_allowed(email: str) -> None:
    allowed = get_allowed_email_domains()
    if not allowed:
        return
    parts = email.split("@")
    if len(parts) != 2:
        raise AuthError("邮箱格式不正确")
    domain = parts[1].strip().lower()
    if domain not in allowed:
        allowed_str = ", ".join(f"@{d}" for d in allowed)
        raise AuthError(f"仅允许公司企业邮箱（{allowed_str}）注册使用")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: str, email: str, role: str = "user") -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, jwt_secret(), algorithm=JWT_ALG)


def decode_access_token(token: str) -> dict:
    # 1. 优先尝试解析 SmartDiagram 平台统一 Token
    platform_info = verify_platform_token(token)
    if platform_info:
        if platform_info.get("kind") == "guest":
            raise AuthError("访客会话")
        return platform_info

    # 2. 兼容原独立 JWT Token
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=[JWT_ALG])
    except jwt.PyJWTError as e:
        raise AuthError("登录已失效，请重新登录") from e
    uid = payload.get("sub")
    email = payload.get("email")
    if not uid:
        raise AuthError("无效令牌")
    return {
        "kind": "jwt",
        "id": _to_valid_uuid(str(uid)),
        "email": email or "",
        "role": payload.get("role") or "user",
    }


def _serialize_user_row(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "email": row["email"],
        "role": row.get("role") or "user",
        "status": row.get("status") or "active",
        "display_name": row.get("display_name"),
        "avatar_url": row.get("avatar_url"),
        "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
        "last_login_at": (
            row["last_login_at"].isoformat()
            if row.get("last_login_at") and hasattr(row["last_login_at"], "isoformat")
            else (str(row["last_login_at"]) if row.get("last_login_at") else None)
        ),
    }


def get_user_by_id(user_id: str) -> dict | None:
    uid = _to_valid_uuid(user_id)
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT id, email, role, status, display_name, avatar_url, created_at, last_login_at
            FROM users WHERE id = %s
            """,
            (uid,),
        )
        row = cur.fetchone()
    return _serialize_user_row(row)


def _validate_avatar_url(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    if len(s) > _MAX_AVATAR_URL_LEN:
        raise AuthError("头像数据过大，请压缩后重试（建议正方形小图）")
    low = s.lower()
    if low.startswith("https://") or low.startswith("http://"):
        if any(c in s for c in ("\n", "\r", "\0", " ")):
            raise AuthError("头像链接格式无效")
        return s
    if _AVATAR_DATA_URL_RE.match(s):
        return re.sub(r"\s+", "", s)
    raise AuthError("头像须为 http(s) 图片链接或上传生成的图片数据")


def update_user_profile(
    user_id: str,
    *,
    display_name: str | None = None,
    avatar_url: str | None = None,
    patch_display_name: bool = False,
    patch_avatar_url: bool = False,
) -> dict:
    """更新当前用户的昵称与头像（供顶栏与社区展示）。"""
    uid = _to_valid_uuid(user_id)
    sets: list[str] = []
    params: list[Any] = []
    if patch_display_name:
        dn = (display_name or "").strip() if display_name is not None else ""
        if len(dn) > 64:
            raise AuthError("昵称最多 64 个字符")
        sets.append("display_name = %s")
        params.append(dn or None)
    if patch_avatar_url:
        av = _validate_avatar_url(avatar_url)
        sets.append("avatar_url = %s")
        params.append(av)
    if not sets:
        row = get_user_by_id(uid)
        if not row:
            raise AuthError("用户不存在")
        return row
    sets.append("updated_at = now()")
    params.append(uid)
    with db_cursor() as cur:
        cur.execute(
            f"""
            UPDATE users SET {", ".join(sets)}
            WHERE id = %s
            RETURNING id, email, role, status, display_name, avatar_url, created_at, last_login_at
            """,
            tuple(params),
        )
        row = cur.fetchone()
    if not row:
        raise AuthError("用户不存在")
    out = _serialize_user_row(row)
    assert out is not None
    return out


def get_user_by_email(email: str) -> dict | None:
    email = email.strip().lower()
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT id, email, password_hash, role, status, display_name, avatar_url, created_at, last_login_at
            FROM users WHERE LOWER(email) = LOWER(%s)
            """,
            (email,),
        )
        row = cur.fetchone()
    if not row:
        return None
    res = _serialize_user_row(row)
    if res:
        res["password_hash"] = row["password_hash"]
    return res


def register_user(
    email: str,
    password: str,
    role: str = "user",
    display_name: str | None = None,
    enforce_domain_check: bool = True,
) -> dict:
    email = email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise AuthError("邮箱格式不正确")
    if enforce_domain_check:
        check_email_domain_allowed(email)
    if len(password) < 6:
        raise AuthError("密码至少 6 位")

    if role not in ("user", "admin"):
        role = "user"

    name = display_name.strip() if display_name else email.split("@")[0]

    try:
        with db_cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (email, password_hash, role, status, display_name)
                VALUES (%s, %s, %s, 'active', %s)
                RETURNING id, email, role, status, display_name, avatar_url, created_at
                """,
                (email, hash_password(password), role, name),
            )
            row = cur.fetchone()
    except (psycopg.errors.UniqueViolation, AppDbError) as e:
        if "unique" in str(e).lower() or isinstance(e, psycopg.errors.UniqueViolation):
            raise AuthError("该邮箱已注册") from e
        raise AppDbError(f"注册失败：{e}") from e
    return _serialize_user_row(row)  # type: ignore[return-value]


def authenticate_user(email: str, password: str) -> dict:
    row = get_user_by_email(email)
    if not row or not verify_password(password, row["password_hash"]):
        raise AuthError("邮箱或密码错误")

    if row.get("status") == "disabled":
        raise AccountDisabledError("账号已被禁用，请联系系统管理员")

    with db_cursor() as cur:
        cur.execute(
            "UPDATE users SET last_login_at = now() WHERE id = %s",
            (row["id"],),
        )

    return {
        "id": row["id"],
        "email": row["email"],
        "role": row.get("role") or "user",
        "status": row.get("status") or "active",
        "display_name": row.get("display_name"),
        "avatar_url": row.get("avatar_url"),
    }


def bootstrap_initial_admin() -> dict | None:
    """服务启动时根据环境变量自动创建或提权超级管理员。"""
    email = (
        os.environ.get("INITIAL_ADMIN_EMAIL")
        or os.environ.get("AUTH_DEMO_ADMIN_EMAIL")
        or ""
    ).strip().lower()
    password = (
        os.environ.get("INITIAL_ADMIN_PASSWORD")
        or os.environ.get("AUTH_DEMO_ADMIN_PASSWORD")
        or ""
    ).strip()
    if not email or not password:
        return None
    try:
        user = get_user_by_email(email)
        if not user:
            logger.info("系统初始化：创建超级管理员账号: %s", email)
            created = register_user(
                email=email,
                password=password,
                role="admin",
                display_name="管理员",
                enforce_domain_check=False,
            )
            return created
        elif user.get("role") != "admin":
            logger.info("系统初始化：将已有账号提权为超级管理员: %s", email)
            with db_cursor() as cur:
                cur.execute(
                    "UPDATE users SET role = 'admin', status = 'active', updated_at = now() WHERE id = %s",
                    (user["id"],),
                )
            user["role"] = "admin"
            user["status"] = "active"
            return user
        return user
    except Exception as e:
        logger.error("超级管理员初始化异常: %s", e)
        return None
