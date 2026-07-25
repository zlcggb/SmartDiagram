"""Platform-wide admin routes — cross-tenant user center."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.audit import AgentRun
from app.models.conversation import Conversation
from app.models.diagram import Diagram
from app.models.model_usage import ModelUsageEvent
from app.models.guest import GuestSession, GuestUsageEvent
from app.models.tenant import Tenant, User
from app.services.auth_service import bearer_token_from_header, verify_auth_token
from app.models.common import utc_now
from app.services.platform_admin_service import user_has_platform_admin_role
from app.services.account_profile_service import (
    AccountProfileMutationError,
    ACCOUNT_KINDS,
    ACCOUNT_TIERS,
    account_profile_payload,
    resolve_effective_scopes,
    update_registered_user_account,
)
from app.services.platform_role_service import (
    PlatformRoleMutationError,
    list_platform_roles_for_user,
    set_user_platform_admin,
)
from app.services.platform_user_classification import (
    is_legacy_guest_user,
    is_registered_platform_user,
    legacy_guest_session_id,
    legacy_user_id_from_session,
    legacy_user_to_guest_item,
)
from app.services.user_quota_service import (
    QuotaProfileMutationError,
    batch_upsert_quota_profiles,
    get_user_quota_snapshot,
    list_quota_profiles,
)
from app.services.guest_quota_settings_service import (
    GuestQuotaSettingsMutationError,
    get_guest_quota_settings,
    update_guest_quota_settings,
)


router = APIRouter(prefix="/platform", tags=["platform-admin"])


def _require_platform_admin(request: Request, session: AsyncSession) -> dict[str, Any]:
    token = bearer_token_from_header(request.headers.get("authorization"))
    user = verify_auth_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="authentication_required")
    return user


async def _ensure_platform_admin(request: Request, session: AsyncSession) -> dict[str, Any]:
    user = _require_platform_admin(request, session)
    if not await user_has_platform_admin_role(user, session):
        raise HTTPException(status_code=403, detail="platform_admin_required")
    return user


def _actor_user_id(actor: dict[str, Any]) -> str:
    return str(actor.get("id") or actor.get("user_id") or "")


def _guest_item_from_session(
    guest: GuestSession,
    *,
    usage: dict[str, Any],
    now,
    legacy_user: User | None = None,
    legacy_stats: dict[str, Any] | None = None,
    tenant_name: str = "",
) -> dict[str, Any]:
    if legacy_user and legacy_stats is not None:
        return legacy_user_to_guest_item(
            legacy_user,
            tenant_name=tenant_name or legacy_user.tenant_id,
            stats=legacy_stats,
            guest_session_id=guest.id,
        )

    ai_calls = max(int(guest.ai_calls_used or 0), int(usage.get("diagram_calls", 0)) + int(usage.get("ppt_calls", 0)))
    is_active = guest.status == "active" and guest.expires_at > now
    last_active_at = usage.get("last_usage_at") or (guest.last_seen_at.isoformat() if guest.last_seen_at else "")
    return {
        "id": guest.id,
        "kind": "guest",
        "source": "legacy_user" if guest.status == "legacy" else "session",
        "status": guest.status if guest.status == "legacy" else (guest.status if is_active else "expired"),
        "created_at": guest.created_at.isoformat() if guest.created_at else "",
        "expires_at": guest.expires_at.isoformat() if guest.expires_at else "",
        "last_active_at": last_active_at,
        "stats": {
            "ai_calls": ai_calls,
            "diagram_calls": int(usage.get("diagram_calls", 0)),
            "ppt_calls": int(usage.get("ppt_calls", 0)),
            "estimated_total_tokens": int(usage.get("total_tokens", 0)),
            "estimated_cost": round(float(usage.get("estimated_cost", 0.0)), 6),
        },
    }


async def _load_guest_platform_data(
    session: AsyncSession,
    *,
    user_map: dict[str, User],
    tenant_map: dict[str, Tenant],
    user_stats_map: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    now = utc_now()
    guests = list(
        (await session.execute(select(GuestSession).order_by(GuestSession.last_seen_at.desc()))).scalars().all()
    )

    usage_rows = (
        await session.execute(
            select(
                GuestUsageEvent.guest_id,
                GuestUsageEvent.source,
                func.count(GuestUsageEvent.id).label("call_count"),
                func.coalesce(func.sum(GuestUsageEvent.estimated_total_tokens), 0).label("total_tokens"),
                func.coalesce(func.sum(GuestUsageEvent.estimated_cost), 0.0).label("estimated_cost"),
                func.max(GuestUsageEvent.created_at).label("last_usage_at"),
            ).group_by(GuestUsageEvent.guest_id, GuestUsageEvent.source)
        )
    ).all()

    usage_map: dict[str, dict[str, Any]] = {}
    for row in usage_rows:
        guest_id = row.guest_id or ""
        bucket = usage_map.setdefault(
            guest_id,
            {
                "diagram_calls": 0,
                "ppt_calls": 0,
                "total_tokens": 0,
                "estimated_cost": 0.0,
                "last_usage_at": "",
            },
        )
        call_count = int(row.call_count or 0)
        total_tokens = int(row.total_tokens or 0)
        estimated_cost = round(float(row.estimated_cost or 0.0), 6)
        source = str(row.source or "").lower()
        bucket["total_tokens"] += total_tokens
        bucket["estimated_cost"] = round(bucket["estimated_cost"] + estimated_cost, 6)
        if source == "ppt":
            bucket["ppt_calls"] += call_count
        else:
            bucket["diagram_calls"] += call_count
        last_usage_at = row.last_usage_at.isoformat() if row.last_usage_at else ""
        if last_usage_at and (not bucket["last_usage_at"] or last_usage_at > bucket["last_usage_at"]):
            bucket["last_usage_at"] = last_usage_at

    guest_items: list[dict[str, Any]] = []
    active_count = 0
    legacy_count = 0
    total_ai_calls = 0
    total_tokens = 0
    total_cost = 0.0
    covered_legacy_user_ids: set[str] = set()

    for guest in guests:
        usage = usage_map.get(guest.id, {})
        legacy_user_id = legacy_user_id_from_session(guest.id)
        legacy_user = user_map.get(legacy_user_id) if legacy_user_id else None
        legacy_stats = user_stats_map.get(legacy_user_id) if legacy_user_id else None
        tenant = tenant_map.get(legacy_user.tenant_id) if legacy_user else None

        if legacy_user_id:
            covered_legacy_user_ids.add(legacy_user_id)

        item = _guest_item_from_session(
            guest,
            usage=usage,
            now=now,
            legacy_user=legacy_user,
            legacy_stats=legacy_stats,
            tenant_name=tenant.name if tenant else "",
        )
        if item["status"] == "active":
            active_count += 1
        if item["status"] == "legacy" or item.get("source") == "legacy_user":
            legacy_count += 1
        total_ai_calls += int(item["stats"]["ai_calls"])
        total_tokens += int(item["stats"]["estimated_total_tokens"])
        total_cost += float(item["stats"]["estimated_cost"])
        guest_items.append(item)

    guest_summary = {
        "total": len(guest_items),
        "active": active_count,
        "legacy": legacy_count,
        "ai_calls": total_ai_calls,
        "estimated_total_tokens": total_tokens,
        "estimated_cost": round(total_cost, 6),
    }
    return guest_items, guest_summary, covered_legacy_user_ids


@router.get("/users")
async def list_platform_users(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """List all users across tenants with Diagram + PPT usage aggregates."""

    await _ensure_platform_admin(request, session)

    users = list(
        (await session.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    )
    platform_roles_map: dict[str, list[str]] = {}
    for user in users:
        platform_roles_map[user.id] = await list_platform_roles_for_user(session, user.id)
    tenants = list((await session.execute(select(Tenant))).scalars().all())
    tenant_map = {tenant.id: tenant for tenant in tenants}
    user_map = {user.id: user for user in users}

    run_stats_rows = (
        await session.execute(
            select(
                AgentRun.user_id,
                func.count(AgentRun.id).label("total_runs"),
                func.coalesce(func.sum(AgentRun.cost_estimate), 0.0).label("total_cost"),
                func.max(AgentRun.started_at).label("last_active_at"),
            ).group_by(AgentRun.user_id)
        )
    ).all()
    run_stats_map = {
        row.user_id or "": {
            "total_runs": row.total_runs or 0,
            "total_cost": round(float(row.total_cost or 0.0), 6),
            "last_active_at": row.last_active_at.isoformat() if row.last_active_at else "",
        }
        for row in run_stats_rows
    }

    token_rows = (await session.execute(select(AgentRun.user_id, AgentRun.token_usage_json))).all()
    token_map: dict[str, dict[str, int]] = {}
    for row in token_rows:
        uid = row.user_id or ""
        usage = row.token_usage_json or {}
        bucket = token_map.setdefault(
            uid,
            {"estimated_input_tokens": 0, "estimated_output_tokens": 0, "estimated_total_tokens": 0},
        )
        bucket["estimated_input_tokens"] += int(usage.get("estimated_input_tokens") or 0)
        bucket["estimated_output_tokens"] += int(usage.get("estimated_output_tokens") or 0)
        bucket["estimated_total_tokens"] += int(usage.get("estimated_total_tokens") or 0)

    conv_rows = (
        await session.execute(
            select(Conversation.created_by, func.count(Conversation.id).label("total_conversations")).group_by(
                Conversation.created_by
            )
        )
    ).all()
    conv_map = {row.created_by or "": row.total_conversations or 0 for row in conv_rows}

    diag_rows = (
        await session.execute(
            select(Diagram.owner_user_id, func.count(Diagram.id).label("total_diagrams")).group_by(
                Diagram.owner_user_id
            )
        )
    ).all()
    diag_map = {row.owner_user_id or "": row.total_diagrams or 0 for row in diag_rows}

    usage_rows = (
        await session.execute(
            select(
                ModelUsageEvent.user_id,
                ModelUsageEvent.source,
                func.count(ModelUsageEvent.id).label("call_count"),
                func.coalesce(func.sum(ModelUsageEvent.total_tokens), 0).label("total_tokens"),
                func.coalesce(func.sum(ModelUsageEvent.estimated_cost), 0.0).label("estimated_cost"),
                func.max(ModelUsageEvent.started_at).label("last_model_at"),
            ).group_by(ModelUsageEvent.user_id, ModelUsageEvent.source)
        )
    ).all()
    usage_map: dict[str, dict[str, Any]] = {}
    for row in usage_rows:
        uid = row.user_id or ""
        bucket = usage_map.setdefault(
            uid,
            {
                "ppt_model_calls": 0,
                "ppt_total_tokens": 0,
                "ppt_estimated_cost": 0.0,
                "diagram_model_calls": 0,
                "diagram_total_tokens": 0,
                "model_total_tokens": 0,
                "model_estimated_cost": 0.0,
                "last_model_at": "",
            },
        )
        source = str(row.source or "").lower()
        call_count = int(row.call_count or 0)
        total_tokens = int(row.total_tokens or 0)
        estimated_cost = round(float(row.estimated_cost or 0.0), 6)
        bucket["model_total_tokens"] += total_tokens
        bucket["model_estimated_cost"] = round(bucket["model_estimated_cost"] + estimated_cost, 6)
        if source == "ppt":
            bucket["ppt_model_calls"] += call_count
            bucket["ppt_total_tokens"] += total_tokens
            bucket["ppt_estimated_cost"] = round(bucket["ppt_estimated_cost"] + estimated_cost, 6)
        else:
            bucket["diagram_model_calls"] += call_count
            bucket["diagram_total_tokens"] += total_tokens
        last_model_at = row.last_model_at.isoformat() if row.last_model_at else ""
        if last_model_at and (not bucket["last_model_at"] or last_model_at > bucket["last_model_at"]):
            bucket["last_model_at"] = last_model_at

    user_stats_map: dict[str, dict[str, Any]] = {}
    registered_items: list[dict[str, Any]] = []

    for user in users:
        uid = user.id
        runs = run_stats_map.get(uid, {})
        tokens = token_map.get(uid, {})
        usage = usage_map.get(uid, {})
        tenant = tenant_map.get(user.tenant_id)
        last_active_at = runs.get("last_active_at", "") or usage.get("last_model_at", "")
        stats = {
            "total_runs": runs.get("total_runs", 0),
            "total_conversations": conv_map.get(uid, 0),
            "total_diagrams": diag_map.get(uid, 0),
            "estimated_input_tokens": tokens.get("estimated_input_tokens", 0),
            "estimated_output_tokens": tokens.get("estimated_output_tokens", 0),
            "estimated_total_tokens": max(
                tokens.get("estimated_total_tokens", 0),
                usage.get("model_total_tokens", 0),
            ),
            "estimated_cost": round(
                float(runs.get("total_cost", 0.0)) + float(usage.get("model_estimated_cost", 0.0)),
                6,
            ),
            "ppt_model_calls": usage.get("ppt_model_calls", 0),
            "ppt_total_tokens": usage.get("ppt_total_tokens", 0),
            "ppt_estimated_cost": usage.get("ppt_estimated_cost", 0.0),
            "diagram_model_calls": usage.get("diagram_model_calls", 0),
            "diagram_total_tokens": usage.get("diagram_total_tokens", 0),
            "last_active_at": last_active_at,
        }
        user_stats_map[uid] = stats

        if not is_registered_platform_user(user):
            continue

        quota_snapshot = await get_user_quota_snapshot(session, user)

        registered_items.append(
            {
                "id": uid,
                "email": user.email,
                "display_name": user.display_name,
                "role": user.role,
                "platform_roles": platform_roles_map.get(uid, []),
                **account_profile_payload(user),
                "effective_scope_count": len(resolve_effective_scopes(user)),
                "quota": quota_snapshot,
                "status": user.status,
                "tenant_id": user.tenant_id,
                "tenant_name": tenant.name if tenant else user.tenant_id,
                "created_at": user.created_at.isoformat() if user.created_at else "",
                "stats": stats,
            }
        )

    guest_items, guest_summary, covered_legacy_user_ids = await _load_guest_platform_data(
        session,
        user_map=user_map,
        tenant_map=tenant_map,
        user_stats_map=user_stats_map,
    )

    # Fallback for environments that have not run startup migration yet.
    for user in users:
        if not is_legacy_guest_user(user):
            continue
        if user.id in covered_legacy_user_ids:
            continue
        tenant = tenant_map.get(user.tenant_id)
        guest_items.append(
            legacy_user_to_guest_item(
                user,
                tenant_name=tenant.name if tenant else user.tenant_id,
                stats=user_stats_map.get(user.id, {}),
                guest_session_id=legacy_guest_session_id(user.id),
            )
        )
        guest_summary["total"] = int(guest_summary.get("total", 0)) + 1
        guest_summary["legacy"] = int(guest_summary.get("legacy", 0)) + 1
        stats = user_stats_map.get(user.id, {})
        guest_summary["ai_calls"] = int(guest_summary.get("ai_calls", 0)) + max(
            int(stats.get("diagram_model_calls") or stats.get("total_runs") or 0)
            + int(stats.get("ppt_model_calls") or 0),
            int(stats.get("total_runs") or 0),
        )
        guest_summary["estimated_total_tokens"] = int(guest_summary.get("estimated_total_tokens", 0)) + int(
            stats.get("estimated_total_tokens") or 0
        )
        guest_summary["estimated_cost"] = round(
            float(guest_summary.get("estimated_cost", 0.0)) + float(stats.get("estimated_cost") or 0.0),
            6,
        )

    registered_summary = {
        "total": len(registered_items),
        "tenant_count": len({item["tenant_id"] for item in registered_items if item.get("tenant_id")}),
        "estimated_total_tokens": sum(item["stats"]["estimated_total_tokens"] for item in registered_items),
        "estimated_cost": round(sum(item["stats"]["estimated_cost"] for item in registered_items), 6),
        "ppt_model_calls": sum(item["stats"]["ppt_model_calls"] for item in registered_items),
    }

    return {
        "users": registered_items,
        "count": len(registered_items),
        "tenant_count": registered_summary["tenant_count"],
        "registered_summary": registered_summary,
        "guests": guest_items,
        "guest_summary": guest_summary,
    }


_PLATFORM_ROLE_ERRORS: dict[str, tuple[int, str]] = {
    "user_not_found": (404, "user_not_found"),
    "legacy_guest_not_eligible": (400, "legacy_guest_not_eligible"),
    "last_platform_admin": (409, "last_platform_admin"),
    "cannot_modify_self": (403, "cannot_modify_self"),
}


@router.patch("/users/{user_id}/platform-roles")
async def update_user_platform_roles(
    user_id: str,
    request: Request,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
):
    """Grant or revoke platform_admin for a registered user (platform super-admin only)."""

    actor = await _ensure_platform_admin(request, session)
    enabled = body.get("platform_admin")
    if not isinstance(enabled, bool):
        raise HTTPException(status_code=400, detail="platform_admin_boolean_required")

    try:
        platform_roles = await set_user_platform_admin(
            session,
            user_id,
            enabled=enabled,
            actor_user_id=_actor_user_id(actor),
        )
        await session.commit()
    except PlatformRoleMutationError as exc:
        code = str(exc)
        status, detail = _PLATFORM_ROLE_ERRORS.get(code, (400, code))
        raise HTTPException(status_code=status, detail=detail) from exc

    target = await session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="user_not_found")

    actor_id = _actor_user_id(actor)
    actor_roles = await list_platform_roles_for_user(session, actor_id)

    return {
        "user_id": user_id,
        "email": target.email,
        "display_name": target.display_name,
        "platform_roles": platform_roles,
        "updated_by": actor_id,
        "actor_platform_roles": actor_roles,
    }


_ACCOUNT_PROFILE_ERRORS: dict[str, tuple[int, str]] = {
    "user_not_found": (404, "user_not_found"),
    "legacy_guest_not_eligible": (400, "legacy_guest_not_eligible"),
    "invalid_account_tier": (400, "invalid_account_tier"),
    "invalid_account_kind": (400, "invalid_account_kind"),
    "invalid_tenant_role": (400, "invalid_tenant_role"),
    "cannot_modify_self": (403, "cannot_modify_self"),
}


@router.get("/account-catalog")
async def get_account_catalog(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    await _ensure_platform_admin(request, session)
    return {
        "account_tiers": list(ACCOUNT_TIERS),
        "account_kinds": list(ACCOUNT_KINDS),
        "tenant_roles": ["member", "admin", "owner"],
    }


@router.patch("/users/{user_id}/account")
async def update_user_account_profile(
    user_id: str,
    request: Request,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
):
    """Update account tier/kind and tenant role for a registered user."""

    actor = await _ensure_platform_admin(request, session)

    account_tier = body.get("account_tier")
    account_kind = body.get("account_kind")
    tenant_role = body.get("tenant_role")
    if account_tier is None and account_kind is None and tenant_role is None:
        raise HTTPException(status_code=400, detail="no_account_fields_provided")

    try:
        payload = await update_registered_user_account(
            session,
            user_id,
            account_tier=str(account_tier).lower() if account_tier is not None else None,
            account_kind=str(account_kind).lower() if account_kind is not None else None,
            tenant_role=str(tenant_role).lower() if tenant_role is not None else None,
            actor_user_id=_actor_user_id(actor),
        )
        await session.commit()
    except AccountProfileMutationError as exc:
        code = str(exc)
        status, detail = _ACCOUNT_PROFILE_ERRORS.get(code, (400, code))
        raise HTTPException(status_code=status, detail=detail) from exc

    return payload


_QUOTA_PROFILE_ERRORS: dict[str, tuple[int, str]] = {
    "profiles_required": (400, "profiles_required"),
    "invalid_profile_type": (400, "invalid_profile_type"),
    "invalid_profile_key": (400, "invalid_profile_key"),
}


@router.get("/quota-profiles")
async def get_platform_quota_profiles(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    await _ensure_platform_admin(request, session)
    profiles = await list_quota_profiles(session)
    return {"profiles": profiles, "count": len(profiles)}


@router.put("/quota-profiles")
async def put_platform_quota_profiles(
    request: Request,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
):
    """Batch upsert quota templates for account tiers and tenant roles."""

    await _ensure_platform_admin(request, session)
    profiles = body.get("profiles")
    if not isinstance(profiles, list):
        raise HTTPException(status_code=400, detail="profiles_array_required")

    try:
        saved = await batch_upsert_quota_profiles(session, profiles)
        await session.commit()
    except QuotaProfileMutationError as exc:
        code = str(exc)
        status, detail = _QUOTA_PROFILE_ERRORS.get(code, (400, code))
        raise HTTPException(status_code=status, detail=detail) from exc

    return {"profiles": saved, "count": len(saved)}


@router.get("/guest-quota")
async def get_platform_guest_quota(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    await _ensure_platform_admin(request, session)
    settings_payload = await get_guest_quota_settings(session)
    return settings_payload


@router.put("/guest-quota")
async def put_platform_guest_quota(
    request: Request,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
):
    """Update unified guest quota policy (call count + token/cost caps)."""

    await _ensure_platform_admin(request, session)
    try:
        saved = await update_guest_quota_settings(session, body)
        await session.commit()
    except GuestQuotaSettingsMutationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return saved
