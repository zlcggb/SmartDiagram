"""Platform-managed guest quota settings (singleton row)."""

from datetime import datetime
from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.common import utc_now

PLATFORM_GUEST_QUOTA_ID = "platform-default"


class PlatformGuestQuotaSettings(SQLModel, table=True):
    """Unified guest quota policy editable from platform user center."""

    __tablename__ = "platform_guest_quota_settings"

    id: str = Field(default=PLATFORM_GUEST_QUOTA_ID, primary_key=True)
    max_uses_per_guest: int = Field(default=5, description="AI call cap per guest in sliding window")
    max_uses_per_ip: int = Field(default=20, description="AI call cap per IP in sliding window")
    window_seconds: int = Field(default=86400, description="Sliding window length in seconds")
    daily_token_limit: int = Field(default=0, description="0 = unlimited")
    monthly_token_limit: int = Field(default=0, description="0 = unlimited")
    monthly_cost_limit: float = Field(default=0.0, description="0 = unlimited")
    hard_limit_enabled: bool = Field(default=True, index=True)
    settings_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utc_now)
    created_at: datetime = Field(default_factory=utc_now, index=True)
