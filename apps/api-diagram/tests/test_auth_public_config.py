import asyncio

from app.api.routes_auth import captcha_config
from app.core.config import settings


def test_captcha_config_hides_demo_accounts_when_local_login_is_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "AUTH_LOCAL_LOGIN_ENABLED", False)
    monkeypatch.setattr(settings, "AUTH_SHOW_DEMO_PRESETS", True)

    payload = asyncio.run(captcha_config())

    assert payload["show_demo_presets"] is False
    assert "demo_presets" not in payload


def test_captcha_config_returns_configured_demo_accounts_only_when_enabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "AUTH_LOCAL_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "AUTH_SHOW_DEMO_PRESETS", True)
    monkeypatch.setattr(settings, "AUTH_DEMO_USER_EMAIL", "member@example.test")
    monkeypatch.setattr(settings, "AUTH_DEMO_USER_PASSWORD", "member-password")
    monkeypatch.setattr(settings, "AUTH_DEMO_ADMIN_EMAIL", "admin@example.test")
    monkeypatch.setattr(settings, "AUTH_DEMO_ADMIN_PASSWORD", "admin-password")

    payload = asyncio.run(captcha_config())

    assert payload["show_demo_presets"] is True
    assert payload["demo_presets"] == {
        "user": {"email": "member@example.test", "password": "member-password"},
        "admin": {"email": "admin@example.test", "password": "admin-password"},
    }
