"""会员支付：Checkout / Webhook / 状态 / Customer Portal。"""
from __future__ import annotations

import logging
import os
import time

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator

import membership_db as mdb
import stripe_client as sc
from db import AppDbError
from session_auth import require_user

logger = logging.getLogger(__name__)

router = APIRouter()
mdb.init_db()


def is_billing_enabled() -> bool:
    val = (os.environ.get("BILLING_ENABLED") or "false").strip().lower()
    return val in ("1", "true", "yes", "on")


_AUTO_SYNC_COOLDOWN = 30.0
_auto_sync_at: dict[str, float] = {}


class CheckoutRequest(BaseModel):
    plan: str

    @field_validator("plan")
    @classmethod
    def _plan(cls, v: str) -> str:
        p = (v or "").strip().lower()
        if p not in ("monthly", "yearly"):
            raise ValueError("plan 须为 monthly 或 yearly")
        return p


class SyncCheckoutRequest(BaseModel):
    session_id: str

    @field_validator("session_id")
    @classmethod
    def _session_id(cls, v: str) -> str:
        sid = (v or "").strip()
        if not sid.startswith("cs_"):
            raise ValueError("无效的 Checkout session_id")
        return sid


def _billing_unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": "billing_unconfigured", "message": "支付功能未配置，请检查 Stripe 环境变量"},
    )


def _billing_db_error(exc: AppDbError) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": "billing_db", "message": str(exc)},
    )


def _user_id_from_metadata(meta: dict | None) -> str | None:
    if not meta:
        return None
    return meta.get("user_id") or meta.get("supabase_user_id")


def _user_id_from_session(session: dict) -> str | None:
    return session.get("client_reference_id") or _user_id_from_metadata(
        session.get("metadata")
    )


def _plan_from_subscription(sub: dict | stripe.Subscription) -> str:
    if isinstance(sub, stripe.Subscription):
        sub = sub.to_dict()
    meta = sub.get("metadata") or {}
    if meta.get("plan") in ("monthly", "yearly"):
        return meta["plan"]
    monthly = (os.environ.get("STRIPE_PRICE_MONTHLY") or "").strip()
    yearly = (os.environ.get("STRIPE_PRICE_YEARLY") or "").strip()
    items = (sub.get("items") or {}).get("data") or []
    if items:
        price = items[0].get("price") or {}
        price_id = price.get("id") or ""
        if price_id and price_id == yearly:
            return "yearly"
        if price_id and price_id == monthly:
            return "monthly"
    return "monthly"


def _sync_subscription_object(
    sub: dict | stripe.Subscription,
    *,
    user_id: str | None = None,
    plan_hint: str | None = None,
) -> None:
    if isinstance(sub, stripe.Subscription):
        sub = sub.to_dict()
    uid = user_id or _user_id_from_metadata(sub.get("metadata"))
    if not uid:
        logger.warning("subscription %s 缺少 user_id", sub.get("id"))
        return
    plan = plan_hint or _plan_from_subscription(sub)
    mdb.upsert_subscription(
        stripe_subscription_id=sub["id"],
        user_id=uid,
        plan=plan,
        status=sub.get("status") or "unknown",
        current_period_end=sub.get("current_period_end"),
        cancel_at_period_end=bool(sub.get("cancel_at_period_end")),
    )


def _extract_stripe_id(value) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get("id")
    return getattr(value, "id", None)


def _handle_checkout_completed(session: dict) -> None:
    if session.get("mode") != "subscription":
        return
    if session.get("payment_status") not in ("paid", "no_payment_required"):
        logger.info("checkout %s payment_status=%s，跳过", session.get("id"), session.get("payment_status"))
        return
    uid = _user_id_from_session(session)
    if not uid:
        logger.warning("checkout %s 无 user_id", session.get("id"))
        return
    email = (
        (session.get("customer_details") or {}).get("email")
        or session.get("customer_email")
        or ""
    )
    customer_id = _extract_stripe_id(session.get("customer"))
    mdb.upsert_user(uid, email or "unknown@user.local", customer_id)

    sub_raw = session.get("subscription")
    plan_hint = (session.get("metadata") or {}).get("plan")
    if isinstance(sub_raw, dict):
        _sync_subscription_object(sub_raw, user_id=uid, plan_hint=plan_hint)
        return
    sub_id = _extract_stripe_id(sub_raw)
    if not sub_id:
        return
    sub = sc.retrieve_subscription(sub_id)
    _sync_subscription_object(sub, user_id=uid, plan_hint=plan_hint)


def _sync_paid_checkouts_for_user(user_id: str) -> bool:
    synced = False
    for sess in sc.list_recent_checkout_sessions(limit=25):
        ref = _user_id_from_session(sess)
        if ref != user_id:
            continue
        if sess.get("status") != "complete":
            continue
        if sess.get("payment_status") not in ("paid", "no_payment_required"):
            continue
        _handle_checkout_completed(sess)
        synced = True
    return synced


def _maybe_auto_sync_from_stripe(user_id: str) -> None:
    if not sc.is_stripe_configured():
        return
    now = time.monotonic()
    last = _auto_sync_at.get(user_id, 0.0)
    if now - last < _AUTO_SYNC_COOLDOWN:
        return
    _auto_sync_at[user_id] = now
    try:
        if _sync_paid_checkouts_for_user(user_id):
            logger.info("auto-sync stripe checkout -> sqlite for %s", user_id)
    except stripe.StripeError:
        logger.exception("auto-sync stripe failed for %s", user_id)
    except AppDbError:
        logger.exception("auto-sync db write failed for %s", user_id)


@router.post("/api/billing/checkout")
def billing_checkout(
    req: CheckoutRequest,
    user: dict = Depends(require_user),
):
    if not sc.is_stripe_configured():
        raise _billing_unavailable()
    try:
        price_id = sc.get_price_id(req.plan)
    except (RuntimeError, ValueError) as e:
        raise HTTPException(
            status_code=503,
            detail={"code": "billing_unconfigured", "message": str(e)},
        ) from e

    uid = user["id"]
    email = user.get("email") or ""
    try:
        row = mdb.get_user(uid)
        customer_id = row["stripe_customer_id"] if row else None
        mdb.upsert_user(uid, email, customer_id)
    except AppDbError as e:
        raise _billing_db_error(e) from e

    try:
        session = sc.create_checkout_session(
            price_id=price_id,
            user_id=uid,
            email=email,
            customer_id=customer_id,
            plan=req.plan,
        )
    except stripe.StripeError as e:
        logger.exception("create checkout failed")
        raise HTTPException(
            status_code=502,
            detail={"code": "stripe_error", "message": str(e.user_message or e)},
        ) from e

    return {"url": session.url, "session_id": session.id}


@router.get("/api/billing/status")
def billing_status(user: dict = Depends(require_user)):
    uid = user["id"]
    try:
        payload = mdb.membership_status_payload(uid)
        if not payload.get("is_pro"):
            _maybe_auto_sync_from_stripe(uid)
            payload = mdb.membership_status_payload(uid)
        return payload
    except AppDbError as e:
        raise _billing_db_error(e) from e


@router.post("/api/billing/sync-me")
def billing_sync_me(user: dict = Depends(require_user)):
    if not sc.is_stripe_configured():
        raise _billing_unavailable()
    uid = user["id"]
    try:
        _auto_sync_at.pop(uid, None)
        _sync_paid_checkouts_for_user(uid)
        return mdb.membership_status_payload(uid)
    except AppDbError as e:
        raise _billing_db_error(e) from e
    except stripe.StripeError as e:
        raise HTTPException(
            status_code=502,
            detail={"code": "stripe_error", "message": str(e.user_message or e)},
        ) from e


@router.post("/api/billing/sync-checkout")
def billing_sync_checkout(
    req: SyncCheckoutRequest,
    user: dict = Depends(require_user),
):
    if not sc.is_stripe_configured():
        raise _billing_unavailable()
    try:
        session = sc.retrieve_checkout_session(req.session_id)
    except stripe.StripeError as e:
        raise HTTPException(
            status_code=502,
            detail={"code": "stripe_error", "message": str(e.user_message or e)},
        ) from e

    sess = session.to_dict()
    uid = _user_id_from_session(sess)
    if uid != user["id"]:
        raise HTTPException(
            status_code=403,
            detail={"code": "session_mismatch", "message": "该付款会话不属于当前登录账号"},
        )
    if sess.get("status") != "complete":
        raise HTTPException(
            status_code=400,
            detail={"code": "session_incomplete", "message": "付款尚未完成"},
        )

    try:
        _handle_checkout_completed(sess)
        return mdb.membership_status_payload(user["id"])
    except AppDbError as e:
        raise _billing_db_error(e) from e


@router.post("/api/billing/portal")
def billing_portal(user: dict = Depends(require_user)):
    if not sc.is_stripe_configured():
        raise _billing_unavailable()
    try:
        row = mdb.get_user(user["id"])
    except AppDbError as e:
        raise _billing_db_error(e) from e
    if not row or not row.get("stripe_customer_id"):
        raise HTTPException(
            status_code=400,
            detail={"code": "no_customer", "message": "尚未订阅，请先开通 Pro"},
        )
    try:
        portal = sc.create_portal_session(row["stripe_customer_id"])
    except stripe.StripeError as e:
        raise HTTPException(
            status_code=502,
            detail={"code": "stripe_error", "message": str(e.user_message or e)},
        ) from e
    return {"url": portal.url}


@router.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    secret = sc.webhook_secret()
    if not secret:
        raise HTTPException(status_code=503, detail="STRIPE_WEBHOOK_SECRET 未配置")

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, secret)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {e}") from e
    except stripe.SignatureVerificationError as e:
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}") from e

    etype = event["type"]
    event_id = event["id"]
    obj = event["data"]["object"]

    if mdb.has_webhook_event(event_id):
        return {"ok": True, "duplicate": True}

    try:
        if etype == "checkout.session.completed":
            _handle_checkout_completed(obj)
        elif etype in (
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
        ):
            _sync_subscription_object(obj)
        elif etype == "invoice.payment_failed":
            sub_id = _extract_stripe_id(obj.get("subscription"))
            if sub_id:
                sub = sc.retrieve_subscription(sub_id)
                _sync_subscription_object(sub)
        mdb.mark_webhook_event(event_id, etype)
    except AppDbError:
        logger.exception("webhook db failed for %s", etype)
        raise
    except Exception:
        logger.exception("webhook handler failed for %s", etype)
        raise

    return {"ok": True}
