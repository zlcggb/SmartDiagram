"""Authentication API routes."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.models.tenant import User
from app.services.audit_service import ensure_principals
from app.services.auth_service import (
    authenticate_db_user,
    authenticate_local_user,
    bearer_token_from_header,
    create_altcha_challenge,
    issue_auth_session,
    register_db_user,
    serialize_user,
    user_to_permission_context,
    verify_auth_token,
    verify_captcha,
)
from app.services.rate_limit import check_auth_rate_limit

router = APIRouter(tags=["auth"])


@router.post("/auth/login")
async def login(
    request: Request,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
):
    # Rate limit
    ip = request.client.host if request.client else "unknown"
    rl = await check_auth_rate_limit(ip)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")

    email = str(body.get("email") or "")
    password = str(body.get("password") or "")
    turnstile_token = str(body.get("turnstile_token") or "")
    captcha_payload = str(body.get("captcha_payload") or "")

    # Verify CAPTCHA (Turnstile or ALTCHA — whichever the frontend used)
    if not verify_captcha(turnstile_token=turnstile_token, altcha_payload=captcha_payload):
        raise HTTPException(status_code=400, detail="CAPTCHA verification failed")

    # 1. Try .env demo users first
    user = authenticate_local_user(email, password)
    if user:
        permission_context = user_to_permission_context(user)
        await ensure_principals(session, permission_context, conversation_id=None)
        db_user = await session.get(User, user.id)
        if db_user:
            db_user.email = user.email
            db_user.display_name = user.display_name
            db_user.role = user.role
        await session.commit()
        return issue_auth_session(user)

    # 2. Try database-registered users
    db_user_dict = await authenticate_db_user(email, password, session)
    if db_user_dict:
        permission_context = user_to_permission_context(db_user_dict)
        await ensure_principals(session, permission_context, conversation_id=None)
        await session.commit()
        return issue_auth_session(db_user_dict)

    raise HTTPException(status_code=401, detail="Invalid email or password")


@router.post("/auth/register")
async def register(
    request: Request,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
):
    if not settings.AUTH_REGISTRATION_ENABLED:
        raise HTTPException(status_code=403, detail="Registration is disabled")

    # Rate limit
    ip = request.client.host if request.client else "unknown"
    rl = await check_auth_rate_limit(ip)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")

    email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "")
    turnstile_token = str(body.get("turnstile_token") or "")
    captcha_payload = str(body.get("captcha_payload") or "")

    # Validate inputs
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    # Verify CAPTCHA (Turnstile or ALTCHA)
    if not verify_captcha(turnstile_token=turnstile_token, altcha_payload=captcha_payload):
        raise HTTPException(status_code=400, detail="CAPTCHA verification failed")

    # Register user
    try:
        user_dict = await register_db_user(email, password, session)
    except ValueError as e:
        if str(e) == "EMAIL_EXISTS":
            raise HTTPException(status_code=409, detail="Email already registered")
        raise HTTPException(status_code=400, detail=str(e))

    # Ensure principal rows for FK integrity
    permission_context = user_to_permission_context(user_dict)
    await ensure_principals(session, permission_context, conversation_id=None)
    await session.commit()

    # Auto-login after registration
    return issue_auth_session(user_dict)


@router.get("/auth/me")
async def current_user(request: Request):
    token = bearer_token_from_header(request.headers.get("authorization"))
    user = verify_auth_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return {"user": serialize_user(user)}


@router.get("/auth/captcha-challenge")
async def captcha_challenge():
    """Return a fresh ALTCHA PoW challenge."""
    return create_altcha_challenge()


@router.get("/auth/captcha-config")
async def captcha_config():
    """Return public auth config — frontend auto-selects provider."""
    return {
        "provider": "altcha",
        "challenge_url": "/api/auth/captcha-challenge",
        "turnstile_site_key": "",
        "enabled": settings.AUTH_REGISTRATION_ENABLED,
        "show_demo_presets": settings.AUTH_SHOW_DEMO_PRESETS,
    }
