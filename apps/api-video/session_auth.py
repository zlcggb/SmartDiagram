"""Bearer Token 与 RBAC 权限控制依赖（原生支持 SmartDiagram 平台统一认证与访客会话）。"""
from __future__ import annotations

from fastapi import Header, HTTPException

from auth_service import (
    AccountDisabledError,
    AuthError,
    decode_access_token,
    ensure_platform_user_synced,
    get_user_by_id,
    is_auth_configured,
    verify_platform_token,
)


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    low = authorization.strip()
    if low.lower().startswith("bearer "):
        return low[7:].strip()
    return low or None


def optional_user(authorization: str | None = Header(None)) -> dict | None:
    """提取当前登录用户；若为访客 Token、未携带 Token 或 Token 无效时返回 None。"""
    if not is_auth_configured():
        return None
    token = _extract_bearer(authorization)
    if not token:
        return None

    platform_info = verify_platform_token(token)
    if platform_info:
        if platform_info.get("kind") == "guest":
            return None
        try:
            return ensure_platform_user_synced(platform_info)
        except Exception:
            return None

    try:
        token_payload = decode_access_token(token)
        user = get_user_by_id(token_payload["id"])
        if not user or user.get("status") == "disabled":
            return None
        return user
    except AuthError:
        return None


def require_user(authorization: str | None = Header(None)) -> dict:
    """要求用户必须登录，且账号状态正常。"""
    if not is_auth_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "auth_unconfigured", "message": "系统鉴权未配置"},
        )
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(
            status_code=401,
            detail={"code": "unauthorized", "message": "请先在平台登录后再进行此操作"},
        )

    platform_info = verify_platform_token(token)
    if platform_info:
        if platform_info.get("kind") == "guest":
            raise HTTPException(
                status_code=401,
                detail={"code": "unauthorized", "message": "访客模式不支持此操作，请先登录平台账号"},
            )
        try:
            return ensure_platform_user_synced(platform_info)
        except AccountDisabledError as e:
            raise HTTPException(
                status_code=403,
                detail={"code": "account_disabled", "message": str(e)},
            ) from e
        except Exception as e:
            raise HTTPException(
                status_code=401,
                detail={"code": "unauthorized", "message": f"用户同步失败: {e}"},
            ) from e

    try:
        token_payload = decode_access_token(token)
        user = get_user_by_id(token_payload["id"])
        if not user:
            raise AuthError("用户不存在或已注销")
        if user.get("status") == "disabled":
            raise HTTPException(
                status_code=403,
                detail={"code": "account_disabled", "message": "账号已被禁用，请联系系统管理员"},
            )
        return user
    except HTTPException:
        raise
    except AccountDisabledError as e:
        raise HTTPException(
            status_code=403,
            detail={"code": "account_disabled", "message": str(e)},
        ) from e
    except AuthError as e:
        raise HTTPException(
            status_code=401,
            detail={"code": "unauthorized", "message": str(e)},
        ) from e


def require_admin(authorization: str | None = Header(None)) -> dict:
    """要求管理员权限。"""
    user = require_user(authorization)
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail={"code": "forbidden", "message": "权限不足：该操作需要管理员权限"},
        )
    return user
