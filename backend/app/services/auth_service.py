"""Local authentication helpers for the SmartDiagram dev console."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.state.agent_runtime import PermissionContext


MEMBER_SCOPES = [
    "project:read",
    "diagram:read",
    "diagram:write",
    "artifact:read",
    "artifact:write",
    "tool:diagram",
    "tool:office",
    "knowledge:read",
    "template:read",
    "preference:read",
    "export:basic",
]

ADMIN_SCOPES = [
    "project:read",
    "project:write",
    "diagram:read",
    "diagram:write",
    "artifact:read",
    "artifact:write",
    "tool:diagram",
    "tool:office",
    "knowledge:read",
    "knowledge:write",
    "template:read",
    "template:write",
    "preference:read",
    "preference:write",
    "export:basic",
    "export:pdf",
    "export:pptx",
    "approval:read",
    "approval:write",
    "audit:read",
]


@dataclass(frozen=True)
class LocalAuthUser:
    id: str
    email: str
    password: str
    display_name: str
    role: str
    roles: list[str]
    scopes: list[str]
    tenant_id: str = "local"
    team_id: str = "local-team"
    project_id: str = "local-project"


def _configured_users() -> list[LocalAuthUser]:
    return [
        LocalAuthUser(
            id="user-member",
            email=settings.AUTH_DEMO_USER_EMAIL,
            password=settings.AUTH_DEMO_USER_PASSWORD,
            display_name="普通用户",
            role="member",
            roles=["member"],
            scopes=MEMBER_SCOPES,
            # 独立租户，与管理员完全隔离
            tenant_id="user-tenant",
            team_id="user-team",
            project_id="user-project",
        ),
        LocalAuthUser(
            id="local-admin",
            email=settings.AUTH_DEMO_ADMIN_EMAIL,
            password=settings.AUTH_DEMO_ADMIN_PASSWORD,
            display_name="管理员",
            role="admin",
            roles=["admin"],
            scopes=ADMIN_SCOPES,
            # 保持 "local"，现有历史数据自然归属管理员
            tenant_id="local",
            team_id="local-team",
            project_id="local-project",
        ),
    ]


# ─── Password Hashing (PBKDF2-HMAC-SHA256) ───

_PBKDF2_ITERATIONS = 600_000
_SALT_LENGTH = 32


def hash_password(password: str) -> str:
    """Hash a password with PBKDF2-HMAC-SHA256 and random salt."""
    salt = os.urandom(_SALT_LENGTH)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2:sha256:{_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a PBKDF2 hash string."""
    try:
        parts = password_hash.split("$")
        if len(parts) != 3:
            return False
        header, salt_hex, dk_hex = parts
        if not header.startswith("pbkdf2:sha256:"):
            return False
        iterations = int(header.split(":")[-1])
        salt = bytes.fromhex(salt_hex)
        expected_dk = bytes.fromhex(dk_hex)
        actual_dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(actual_dk, expected_dk)
    except (ValueError, IndexError):
        return False


# ─── Cloudflare Turnstile Verification ───

def verify_turnstile_token(token: str) -> bool:
    """Verify a Cloudflare Turnstile token via their siteverify API."""
    import httpx
    from app.core.logger import logger

    if not token:
        logger.warning("Turnstile: empty token")
        return False
    secret = settings.TURNSTILE_SECRET_KEY
    if not secret:
        logger.warning("Turnstile: no secret key configured")
        return False
    try:
        # Use httpx with no_proxy to bypass any system/SOCKS proxy
        with httpx.Client(timeout=10, proxy=None) as client:
            resp = client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={"secret": secret, "response": token},
            )
            result = resp.json()
        if result.get("success"):
            return True
        logger.warning(f"Turnstile verification failed: {result}")
        return False
    except Exception as exc:
        logger.error(f"Turnstile request error: {exc}")
        return False


# ─── Token Encoding ───

def _b64_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64_decode(raw: str) -> bytes:
    padding = "=" * ((4 - len(raw) % 4) % 4)
    return base64.urlsafe_b64decode((raw + padding).encode("ascii"))


def _sign(payload: str) -> str:
    return _b64_encode(
        hmac.new(
            settings.AUTH_SESSION_SECRET.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).digest()
    )


def user_to_permission_context(user: LocalAuthUser | dict[str, Any]) -> PermissionContext:
    if isinstance(user, LocalAuthUser):
        source: dict[str, Any] = {
            "tenant_id": user.tenant_id,
            "user_id": user.id,
            "team_id": user.team_id,
            "project_id": user.project_id,
            "roles": user.roles,
            "scopes": user.scopes,
        }
    else:
        source = user
    return {
        "tenant_id": str(source.get("tenant_id") or "local"),
        "user_id": str(source.get("user_id") or source.get("id") or "anonymous"),
        "team_id": str(source.get("team_id") or "local-team"),
        "project_id": str(source.get("project_id") or "local-project"),
        "roles": [str(role) for role in source.get("roles", [])],
        "scopes": [str(scope) for scope in source.get("scopes", [])],
        "allowed_knowledge_scopes": [str(scope) for scope in source.get("scopes", [])],
        "allowed_tool_scopes": [str(scope) for scope in source.get("scopes", [])],
    }


def serialize_user(user: LocalAuthUser | dict[str, Any]) -> dict[str, Any]:
    if isinstance(user, LocalAuthUser):
        return {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "role": user.role,
            "tenant_id": user.tenant_id,
            "team_id": user.team_id,
            "project_id": user.project_id,
            "roles": user.roles,
            "scopes": user.scopes,
        }
    return {
        "id": str(user.get("user_id") or user.get("id") or ""),
        "email": str(user.get("email") or ""),
        "display_name": str(user.get("display_name") or ""),
        "role": str(user.get("role") or ""),
        "tenant_id": str(user.get("tenant_id") or ""),
        "team_id": str(user.get("team_id") or ""),
        "project_id": str(user.get("project_id") or ""),
        "roles": [str(role) for role in user.get("roles", [])],
        "scopes": [str(scope) for scope in user.get("scopes", [])],
    }


# ─── Authentication ───

def authenticate_local_user(email: str, password: str) -> LocalAuthUser | None:
    """Authenticate against .env demo users only (no DB)."""
    if not settings.AUTH_LOCAL_LOGIN_ENABLED:
        return None
    normalized_email = email.strip().lower()
    for user in _configured_users():
        if user.email.strip().lower() != normalized_email:
            continue
        if hmac.compare_digest(user.password, password):
            return user
    return None


async def authenticate_db_user(email: str, password: str, session) -> dict[str, Any] | None:
    """Authenticate against database-registered users."""
    from sqlalchemy import select
    from app.models.tenant import User

    normalized_email = email.strip().lower()
    stmt = select(User).where(User.email == normalized_email, User.status == "active")
    result = await session.execute(stmt)
    db_user = result.scalars().first()
    if not db_user or not db_user.password_hash:
        return None
    if not verify_password(password, db_user.password_hash):
        return None

    return {
        "id": db_user.id,
        "user_id": db_user.id,
        "email": db_user.email,
        "display_name": db_user.display_name,
        "role": db_user.role,
        "tenant_id": db_user.tenant_id,
        "team_id": f"{db_user.id}-team",
        "project_id": f"{db_user.id}-project",
        "roles": [db_user.role],
        "scopes": ADMIN_SCOPES if db_user.role == "admin" else MEMBER_SCOPES,
    }


# ─── Registration ───

async def register_db_user(email: str, password: str, session) -> dict[str, Any]:
    """Register a new user in the database with hashed password."""
    from sqlalchemy import select
    from app.models.tenant import Tenant, User, Team
    from app.models.project import Project
    from app.models.common import new_id

    normalized_email = email.strip().lower()

    # Check duplicate
    stmt = select(User).where(User.email == normalized_email)
    result = await session.execute(stmt)
    if result.scalars().first():
        raise ValueError("EMAIL_EXISTS")

    # Create tenant, user, team, project
    user_id = new_id()
    tenant_id = f"tenant-{user_id[:12]}"
    team_id = f"{user_id}-team"
    project_id = f"{user_id}-project"

    # Extract display name from email
    display_name = normalized_email.split("@")[0]

    session.add(Tenant(id=tenant_id, name=f"{display_name}'s workspace", slug=tenant_id))
    session.add(User(
        id=user_id,
        tenant_id=tenant_id,
        email=normalized_email,
        password_hash=hash_password(password),
        display_name=display_name,
        role="member",
    ))
    session.add(Team(id=team_id, tenant_id=tenant_id, name="Default Team", created_by=user_id))
    session.add(Project(id=project_id, tenant_id=tenant_id, team_id=team_id, name="Default Project", created_by=user_id))
    await session.flush()

    return {
        "id": user_id,
        "user_id": user_id,
        "email": normalized_email,
        "display_name": display_name,
        "role": "member",
        "tenant_id": tenant_id,
        "team_id": team_id,
        "project_id": project_id,
        "roles": ["member"],
        "scopes": MEMBER_SCOPES,
    }


# ─── Session Management ───

def issue_auth_session(user: LocalAuthUser | dict[str, Any]) -> dict[str, Any]:
    now = int(time.time())
    expires_at = now + settings.AUTH_SESSION_TTL_SECONDS
    payload = {
        "iss": "smartdiagram-local-auth",
        "iat": now,
        "exp": expires_at,
        "user": serialize_user(user),
    }
    payload_text = _b64_encode(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )
    token = f"{payload_text}.{_sign(payload_text)}"
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_at": expires_at,
        "user": serialize_user(user),
    }


def verify_auth_token(token: str) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    payload_text, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(_sign(payload_text), signature):
        return None
    try:
        payload = json.loads(_b64_decode(payload_text).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    user = payload.get("user")
    return user if isinstance(user, dict) else None


def bearer_token_from_header(authorization: str | None) -> str:
    if not authorization:
        return ""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return token.strip()

