"""Stripe SDK 薄封装。"""
from __future__ import annotations

import os

import stripe

_stripe_configured = False


def is_stripe_configured() -> bool:
    return bool((os.environ.get("STRIPE_SECRET_KEY") or "").strip())


def _ensure_stripe() -> None:
    global _stripe_configured
    key = (os.environ.get("STRIPE_SECRET_KEY") or "").strip()
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY 未配置")
    if not _stripe_configured:
        stripe.api_key = key
        _stripe_configured = True


def get_price_id(plan: str) -> str:
    plan = (plan or "").strip().lower()
    if plan == "monthly":
        env = "STRIPE_PRICE_MONTHLY"
    elif plan == "yearly":
        env = "STRIPE_PRICE_YEARLY"
    else:
        raise ValueError(f"未知套餐：{plan}")
    price_id = (os.environ.get(env) or "").strip()
    if not price_id:
        raise RuntimeError(f"{env} 未配置")
    return price_id


def app_base_url() -> str:
    return (os.environ.get("APP_BASE_URL") or "http://localhost:5173").rstrip("/")


def webhook_secret() -> str | None:
    return (os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip() or None


def create_checkout_session(
    *,
    price_id: str,
    user_id: str,
    email: str,
    customer_id: str | None,
    plan: str,
) -> stripe.checkout.Session:
    _ensure_stripe()
    base = app_base_url()
    params: dict = {
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": f"{base}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/?checkout=canceled",
        "client_reference_id": user_id,
        "metadata": {"user_id": user_id, "plan": plan},
        "subscription_data": {"metadata": {"user_id": user_id, "plan": plan}},
    }
    if customer_id:
        params["customer"] = customer_id
    else:
        params["customer_email"] = email
    return stripe.checkout.Session.create(**params)


def create_portal_session(customer_id: str) -> stripe.billing_portal.Session:
    _ensure_stripe()
    return stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{app_base_url()}/",
    )


def retrieve_subscription(subscription_id: str) -> stripe.Subscription:
    _ensure_stripe()
    return stripe.Subscription.retrieve(subscription_id)


def retrieve_checkout_session(session_id: str) -> stripe.checkout.Session:
    _ensure_stripe()
    return stripe.checkout.Session.retrieve(session_id, expand=["subscription"])


def list_recent_checkout_sessions(*, limit: int = 20) -> list[dict]:
    """最近 Checkout Session（含 subscription 展开）。"""
    _ensure_stripe()
    return [
        s.to_dict()
        for s in stripe.checkout.Session.list(limit=limit, expand=["data.subscription"])
    ]
