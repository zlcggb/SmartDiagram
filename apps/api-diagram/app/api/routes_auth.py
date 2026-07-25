"""Authentication API routes."""

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.rate_limit import check_auth_rate_limit
from app.core.config import settings
from app.core.db import get_session
from app.models.common import utc_now
from app.models.tenant import User
from app.services.account_profile_service import account_profile_payload, resolve_effective_scopes
from app.services.audit_service import ensure_principals
from app.services.platform_role_service import enrich_user_roles_from_db
from app.services.auth_service import (
    authenticate_db_user,
    authenticate_local_user,
    bearer_token_from_header,
    create_altcha_challenge,
    issue_auth_session,
    register_db_user,
    serialize_public_user,
    serialize_user,
    user_to_permission_context,
    verify_auth_token,
    verify_captcha,
)
from app.services.object_storage import get_object_storage
from app.services.profile_service import (
    MAX_AVATAR_UPLOAD_BYTES,
    avatar_storage_key,
    avatar_url_from_preferences,
    normalize_avatar_image,
    preferences_with_profile,
    profile_preferences,
    validate_display_name,
)
from app.services.guest_quota_service import get_guest_ai_quota_status
from app.services.guest_quota_settings_service import get_guest_quota_settings
from app.services.guest_session_service import (
    create_guest_session,
    serialize_public_guest,
    touch_guest_session,
    verify_guest_session_token,
)
from app.services.identity_service import enforce_browser_origin
from app.services.budget_service import get_budget_metrics_snapshot

router = APIRouter(tags=["auth"])


_PROFILE_ERROR_MESSAGES = {
    "display_name_required": "昵称不能为空",
    "display_name_too_long": "昵称最多 40 个字符",
    "display_name_contains_control_characters": "昵称包含不支持的字符",
    "avatar_type_not_supported": "头像仅支持 JPEG、PNG 或 WebP",
    "avatar_empty": "头像文件为空",
    "avatar_too_large": "头像文件不能超过 5 MB",
    "avatar_content_type_mismatch": "头像文件格式与声明类型不一致",
    "avatar_dimensions_invalid": "头像尺寸无效或像素过大",
    "avatar_invalid_image": "无法识别这个图片文件",
}


def _profile_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code == "avatar_too_large":
        status_code = 413
    elif code in {"avatar_type_not_supported", "avatar_content_type_mismatch"}:
        status_code = 415
    else:
        status_code = 400
    return HTTPException(status_code=status_code, detail=_PROFILE_ERROR_MESSAGES.get(code, code))


def _auth_payload_from_db(db_user: User, context: dict[str, Any]) -> dict[str, Any]:
    role = db_user.role or str(context.get("role") or "member")
    profile = account_profile_payload(db_user)
    return {
        "id": db_user.id,
        "user_id": db_user.id,
        "email": db_user.email,
        "display_name": db_user.display_name,
        "role": role,
        "tenant_id": db_user.tenant_id,
        "team_id": str(context.get("team_id") or f"{db_user.id}-team"),
        "project_id": str(context.get("project_id") or f"{db_user.id}-project"),
        "roles": [str(item) for item in context.get("roles", [])] or [role],
        "scopes": resolve_effective_scopes(db_user),
        "avatar_url": avatar_url_from_preferences(db_user.id, db_user.preferences_json),
        **profile,
    }


async def _authenticated_db_user(
    request: Request,
    session: AsyncSession,
) -> tuple[dict[str, Any], User]:
    token = bearer_token_from_header(request.headers.get("authorization"))
    token_user = verify_auth_token(token)
    if not token_user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    user_id = str(token_user.get("id") or token_user.get("user_id") or "")
    db_user = await session.get(User, user_id) if user_id else None
    if not db_user or db_user.status != "active":
        raise HTTPException(status_code=401, detail="User account is unavailable")
    if str(token_user.get("tenant_id") or "") != db_user.tenant_id:
        raise HTTPException(status_code=403, detail="Tenant identity mismatch")
    return token_user, db_user


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
            profile = profile_preferences(db_user.preferences_json)
            db_user.email = user.email
            if not profile.get("customized"):
                db_user.display_name = user.display_name
            db_user.role = user.role
            preferences = dict(db_user.preferences_json or {})
            preferences["platform_principal_kind"] = "demo"
            preferences.setdefault("account_tier", "standard")
            preferences.setdefault("account_kind", "demo")
            db_user.preferences_json = preferences
            db_user.updated_at = utc_now()
        await session.commit()
        if db_user:
            payload = _auth_payload_from_db(db_user, serialize_user(user))
            payload = await enrich_user_roles_from_db(session, payload)
            return issue_auth_session(payload)
        demo_payload = await enrich_user_roles_from_db(session, serialize_user(user))
        return issue_auth_session(demo_payload)

    # 2. Try database-registered users
    db_user_dict = await authenticate_db_user(email, password, session)
    if db_user_dict:
        permission_context = user_to_permission_context(db_user_dict)
        await ensure_principals(session, permission_context, conversation_id=None)
        db_user_dict = await enrich_user_roles_from_db(session, db_user_dict)
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

    user_dict = await enrich_user_roles_from_db(session, user_dict)
    # Auto-login after registration
    return issue_auth_session(user_dict)


@router.get("/auth/me")
async def current_user(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    token = bearer_token_from_header(request.headers.get("authorization"))
    guest = verify_guest_session_token(token)
    if guest:
        client_ip = request.client.host if request.client else "unknown"
        record = await touch_guest_session(session, str(guest["guest_id"]))
        if not record:
            raise HTTPException(status_code=401, detail="Guest session expired")
        await session.commit()
        quota = await get_guest_ai_quota_status(str(guest["guest_id"]), client_ip)
        return {
            "kind": "guest",
            "guest": serialize_public_guest(str(guest["guest_id"]), quota),
        }

    token_user, db_user = await _authenticated_db_user(request, session)
    public_user = _auth_payload_from_db(db_user, token_user)
    public_user = await enrich_user_roles_from_db(session, public_user)
    return {
        "kind": "user",
        "user": serialize_public_user(public_user),
    }


@router.post("/auth/guest/session")
async def issue_guest_session(
    request: Request,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
):
    if not settings.GUEST_SESSION_ENABLED:
        raise HTTPException(status_code=403, detail="guest_sessions_disabled")

    enforce_browser_origin(request)
    ip = request.client.host if request.client else "unknown"
    rl = await check_auth_rate_limit(ip)
    if not rl["allowed"]:
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")

    turnstile_token = str(body.get("turnstile_token") or "")
    captcha_payload = str(body.get("captcha_payload") or "")
    if settings.GUEST_CAPTCHA_REQUIRED and not verify_captcha(
        turnstile_token=turnstile_token,
        altcha_payload=captcha_payload,
    ):
        raise HTTPException(status_code=400, detail="CAPTCHA verification failed")

    user_agent = str(request.headers.get("user-agent") or "")
    payload = await create_guest_session(session, ip=ip, user_agent=user_agent)
    await session.commit()
    return payload


@router.get("/auth/guest/quota")
async def guest_quota(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    token = bearer_token_from_header(request.headers.get("authorization"))
    guest = verify_guest_session_token(token)
    if not guest:
        raise HTTPException(status_code=401, detail="Invalid or expired guest session")
    client_ip = request.client.host if request.client else "unknown"
    record = await touch_guest_session(session, str(guest["guest_id"]))
    if not record:
        raise HTTPException(status_code=401, detail="Guest session expired")
    quota_settings = await get_guest_quota_settings(session)
    await session.commit()
    quota = await get_guest_ai_quota_status(
        str(guest["guest_id"]),
        client_ip,
        quota_settings=quota_settings,
    )
    return {"guest_id": guest["guest_id"], "quota": quota, "policy": quota_settings}

@router.get("/billing/me")
async def current_user_billing(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    token_user, db_user = await _authenticated_db_user(request, session)
    permission_context = user_to_permission_context(serialize_user(token_user))
    # Allow fetching limits as we assume User = Tenant in B2C
    budget = await get_budget_metrics_snapshot(
        session,
        permission_context,
        include_tenant_limits=True
    )
    return {"budget": budget}


@router.patch("/auth/me/profile")
async def update_profile(
    request: Request,
    display_name: str | None = Form(default=None),
    avatar: UploadFile | None = File(default=None),
    remove_avatar: bool = Form(default=False),
    session: AsyncSession = Depends(get_session),
):
    """Update the signed-in user's name and/or avatar, then renew the session."""

    token_user, db_user = await _authenticated_db_user(request, session)
    if avatar is not None and remove_avatar:
        raise HTTPException(status_code=400, detail="不能同时上传并移除头像")
    if display_name is None and avatar is None and not remove_avatar:
        raise HTTPException(status_code=400, detail="没有需要保存的个人资料")

    if display_name is not None:
        try:
            db_user.display_name = validate_display_name(display_name)
        except ValueError as error:
            raise _profile_error(error) from error

    preferences = dict(db_user.preferences_json or {})
    profile = profile_preferences(preferences)
    old_storage_key = str(profile.get("avatar_storage_key") or "")
    new_storage_key = ""
    storage = get_object_storage()

    if avatar is not None:
        uploaded = await avatar.read(MAX_AVATAR_UPLOAD_BYTES + 1)
        try:
            normalized, image_metadata = await asyncio.to_thread(
                normalize_avatar_image,
                uploaded,
                avatar.content_type or "",
            )
        except ValueError as error:
            raise _profile_error(error) from error

        new_storage_key = avatar_storage_key(
            db_user.tenant_id,
            db_user.id,
            str(image_metadata["checksum"]),
        )
        try:
            await asyncio.to_thread(
                storage.put_object,
                new_storage_key,
                normalized,
                "image/webp",
            )
        except Exception as error:
            raise HTTPException(status_code=503, detail="头像保存失败，请稍后重试") from error

        profile.update(
            {
                "avatar_storage_key": new_storage_key,
                "avatar_checksum": image_metadata["checksum"],
                "avatar_content_type": "image/webp",
                "avatar_size_bytes": image_metadata["size_bytes"],
            }
        )
    elif remove_avatar:
        for key in (
            "avatar_storage_key",
            "avatar_checksum",
            "avatar_content_type",
            "avatar_size_bytes",
        ):
            profile.pop(key, None)

    profile["customized"] = True
    db_user.preferences_json = preferences_with_profile(preferences, profile)
    db_user.updated_at = utc_now()

    try:
        await session.commit()
    except Exception as error:
        await session.rollback()
        if new_storage_key:
            try:
                await asyncio.to_thread(storage.delete_object, new_storage_key)
            except Exception:
                pass
        raise HTTPException(status_code=503, detail="个人资料保存失败，请稍后重试") from error

    if old_storage_key and old_storage_key != new_storage_key and (avatar is not None or remove_avatar):
        try:
            await asyncio.to_thread(storage.delete_object, old_storage_key)
        except Exception:
            pass

    payload = _auth_payload_from_db(db_user, token_user)
    payload = await enrich_user_roles_from_db(session, payload)
    return issue_auth_session(payload)


@router.get("/auth/avatar/{user_id}/{version}.webp")
async def user_avatar(
    user_id: str,
    version: str,
    session: AsyncSession = Depends(get_session),
):
    """Serve an immutable, metadata-free public avatar by its content checksum."""

    db_user = await session.get(User, user_id)
    if not db_user or db_user.status != "active":
        raise HTTPException(status_code=404, detail="Avatar not found")
    profile = profile_preferences(db_user.preferences_json)
    checksum = str(profile.get("avatar_checksum") or "")
    storage_key = str(profile.get("avatar_storage_key") or "")
    if not checksum or not storage_key or version != checksum:
        raise HTTPException(status_code=404, detail="Avatar not found")
    try:
        content = await asyncio.to_thread(get_object_storage().get_object, storage_key)
    except Exception as error:
        raise HTTPException(status_code=404, detail="Avatar not found") from error
    return Response(
        content=content,
        media_type="image/webp",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "ETag": f'"{checksum}"',
        },
    )


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
