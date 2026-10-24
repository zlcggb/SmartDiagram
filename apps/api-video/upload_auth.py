"""上传 / 敏感 API 鉴权（公网部署时启用）。

未设置 UPLOAD_API_KEY（或 API_AUTH_TOKEN）时不校验，便于本机开发。
公网时在环境变量配置密钥，客户端带：
  - Header: X-API-Key: <key>
  - 或 Authorization: Bearer <key>
"""
import os

from fastapi import Header, HTTPException

_ENV_KEYS = ("UPLOAD_API_KEY", "API_AUTH_TOKEN")


def _required_token() -> str | None:
    for name in _ENV_KEYS:
        val = (os.environ.get(name) or "").strip()
        if val:
            return val
    return None


def require_upload_auth(
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    authorization: str | None = Header(None),
) -> None:
    expected = _required_token()
    if not expected:
        return

    token = (x_api_key or "").strip()
    if authorization:
        low = authorization.strip()
        if low.lower().startswith("bearer "):
            token = low[7:].strip()

    if token != expected:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "unauthorized",
                "message": "未授权：请配置有效的 API Key（X-API-Key 或 Bearer Token）。",
            },
        )
