"""本地账号：注册 / 登录 / 当前用户。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from auth_service import (
    AuthError,
    authenticate_user,
    create_access_token,
    get_user_by_id,
    is_auth_configured,
    register_user,
)
from session_auth import require_user

router = APIRouter()


class AuthBody(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return (v or "").strip().lower()


@router.post("/api/auth/register")
def api_register(body: AuthBody):
    if not is_auth_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "auth_unconfigured", "message": "AUTH_JWT_SECRET 未配置"},
        )
    try:
        user = register_user(body.email, body.password)
        token = create_access_token(user["id"], user["email"])
        return {"access_token": token, "user": user}
    except AuthError as e:
        raise HTTPException(status_code=400, detail={"code": "auth_error", "message": str(e)}) from e


@router.post("/api/auth/login")
def api_login(body: AuthBody):
    if not is_auth_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "auth_unconfigured", "message": "AUTH_JWT_SECRET 未配置"},
        )
    try:
        user = authenticate_user(body.email, body.password)
        token = create_access_token(user["id"], user["email"])
        return {"access_token": token, "user": user}
    except AuthError as e:
        raise HTTPException(status_code=401, detail={"code": "auth_error", "message": str(e)}) from e


@router.get("/api/auth/me")
def api_me(user: dict = Depends(require_user)):
    row = get_user_by_id(user["id"])
    if not row:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "用户不存在"})
    return row
