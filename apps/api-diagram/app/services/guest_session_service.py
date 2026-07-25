"""Unified platform guest sessions (Diagram + PPT)."""

from __future__ import annotations

import hashlib
import json
import time
from datetime import timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.common import new_id, utc_now
from app.models.guest import GuestSession
from app.models.tenant import Tenant
from app.services.auth_service import _b64_decode, _b64_encode, _sign
from app.services.guest_quota_service import (
    get_guest_ai_quota_status,
    hash_client_ip,
    hash_user_agent,
)

GUEST_TENANT_ID = "guest-pool"
GUEST_SCOPES = [
    "diagram:read",
    "diagram:write",
    "tool:diagram",
    "export:basic",
]


def guest_owner_key(guest_id: str) -> str:
    """Stable owner key for PPT guest project isolation."""
    return hashlib.sha256(f"guest:{guest_id}".encode("utf-8")).hexdigest()


def issue_guest_session_token(guest_id: str) -> dict[str, Any]:
    now = int(time.time())
    expires_at = now + settings.GUEST_SESSION_TTL_SECONDS
    payload = {
        "iss": "smartdiagram-guest-auth",
        "kind": "guest",
        "guest_id": guest_id,
        "iat": now,
        "exp": expires_at,
    }
    payload_text = _b64_encode(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )
    token = f"{payload_text}.{_sign(payload_text)}"
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_at": expires_at,
        "kind": "guest",
        "guest_id": guest_id,
    }


def verify_guest_session_token(token: str) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    payload_text, signature = token.rsplit(".", 1)
    if not hmac_compare(_sign(payload_text), signature):
        return None
    try:
        payload = json.loads(_b64_decode(payload_text).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None
    if payload.get("kind") != "guest":
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    guest_id = str(payload.get("guest_id") or "").strip()
    if not guest_id:
        return None
    return {"guest_id": guest_id, "exp": int(payload.get("exp") or 0)}


def hmac_compare(left: str, right: str) -> bool:
    import hmac

    return hmac.compare_digest(left, right)


async def ensure_guest_pool_tenant(session: AsyncSession) -> None:
    existing = await session.get(Tenant, GUEST_TENANT_ID)
    if existing:
        return
    session.add(
        Tenant(
            id=GUEST_TENANT_ID,
            name="Guest Pool",
            slug=GUEST_TENANT_ID,
            status="system",
        )
    )
    await session.flush()


async def create_guest_session(
    session: AsyncSession,
    *,
    ip: str,
    user_agent: str,
) -> dict[str, Any]:
    await ensure_guest_pool_tenant(session)
    guest_id = new_id()
    now = utc_now()
    expires_at = now + timedelta(seconds=settings.GUEST_SESSION_TTL_SECONDS)
    record = GuestSession(
        id=guest_id,
        ip_hash=hash_client_ip(ip),
        user_agent_hash=hash_user_agent(user_agent),
        expires_at=expires_at,
        last_seen_at=now,
    )
    session.add(record)
    await session.flush()
    token_payload = issue_guest_session_token(guest_id)
    quota = await get_guest_ai_quota_status(guest_id, ip)
    return {**token_payload, "quota": quota}


async def touch_guest_session(session: AsyncSession, guest_id: str) -> GuestSession | None:
    record = await session.get(GuestSession, guest_id)
    if not record or record.status != "active":
        return None
    if record.expires_at <= utc_now():
        record.status = "expired"
        await session.flush()
        return None
    record.last_seen_at = utc_now()
    await session.flush()
    return record


def guest_to_permission_context(guest_id: str) -> dict[str, Any]:
    return {
        "tenant_id": GUEST_TENANT_ID,
        "user_id": "",
        "guest_id": guest_id,
        "principal_kind": "guest",
        "roles": ["guest"],
        "scopes": list(GUEST_SCOPES),
        "allowed_knowledge_scopes": [],
        "allowed_tool_scopes": list(GUEST_SCOPES),
    }


def serialize_public_guest(guest_id: str, quota: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": guest_id,
        "kind": "guest",
        "display_name": "访客",
        "role": "guest",
        "roles": ["guest"],
        "scopes": list(GUEST_SCOPES),
        "tenant_id": GUEST_TENANT_ID,
        "quota": quota,
    }
