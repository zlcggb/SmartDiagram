"""Resolve unified platform identity from incoming HTTP requests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException, Request

from app.core.config import settings
from app.services.auth_service import bearer_token_from_header, verify_auth_token
from app.services.guest_session_service import verify_guest_session_token


@dataclass(frozen=True)
class ResolvedIdentity:
    kind: Literal["user", "guest"]
    token: str
    user: dict | None = None
    guest_id: str | None = None


def _allowed_origin(origin: str | None, referer: str | None) -> bool:
    if not settings.API_ORIGIN_CHECK_ENABLED:
        return True
    allowed = {item.rstrip("/") for item in settings.CORS_ORIGINS}
    if origin:
        return origin.rstrip("/") in allowed
    if referer:
        return any(referer.startswith(f"{item}/") or referer == item for item in allowed)
    return False


def enforce_browser_origin(request: Request) -> None:
    if not settings.API_ORIGIN_CHECK_ENABLED:
        return
    if not _allowed_origin(request.headers.get("origin"), request.headers.get("referer")):
        raise HTTPException(status_code=403, detail="origin_not_allowed")


def resolve_request_identity(request: Request) -> ResolvedIdentity | None:
    token = bearer_token_from_header(request.headers.get("authorization"))
    if not token:
        return None

    guest = verify_guest_session_token(token)
    if guest:
        return ResolvedIdentity(kind="guest", token=token, guest_id=guest["guest_id"])

    user = verify_auth_token(token)
    if user:
        return ResolvedIdentity(kind="user", token=token, user=user)

    return None


def require_request_identity(request: Request) -> ResolvedIdentity:
    enforce_browser_origin(request)
    identity = resolve_request_identity(request)
    if not identity:
        raise HTTPException(status_code=401, detail="authentication_required")
    return identity
