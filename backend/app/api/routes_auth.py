"""Authentication API routes."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.tenant import User
from app.services.audit_service import ensure_principals
from app.services.auth_service import (
    authenticate_local_user,
    bearer_token_from_header,
    issue_auth_session,
    serialize_user,
    user_to_permission_context,
    verify_auth_token,
)

router = APIRouter(tags=["auth"])


@router.post("/auth/login")
async def login(
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
):
    email = str(body.get("email") or "")
    password = str(body.get("password") or "")
    user = authenticate_local_user(email, password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    permission_context = user_to_permission_context(user)
    await ensure_principals(session, permission_context, conversation_id=None)
    db_user = await session.get(User, user.id)
    if db_user:
        db_user.email = user.email
        db_user.display_name = user.display_name
        db_user.role = user.role
    await session.commit()
    return issue_auth_session(user)


@router.get("/auth/me")
async def current_user(request: Request):
    token = bearer_token_from_header(request.headers.get("authorization"))
    user = verify_auth_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return {"user": serialize_user(user)}
