"""Platform-wide quota profiles keyed by account tier or tenant role."""

from datetime import datetime
from typing import Any

from sqlalchemy import Column, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now


class PlatformQuotaProfile(SQLModel, table=True):
    """Batch quota template — applied to all users matching profile_type + profile_key."""

    __tablename__ = "platform_quota_profiles"
    __table_args__ = (
        UniqueConstraint("profile_type", "profile_key", name="uq_platform_quota_profile"),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    profile_type: str = Field(index=True, description="account_tier | tenant_role")
    profile_key: str = Field(index=True, description="free/standard/pro/enterprise or member/admin/owner")
    daily_token_limit: int = Field(default=0, description="0 = unlimited for this dimension")
    monthly_token_limit: int = Field(default=0)
    monthly_cost_limit: float = Field(default=0.0)
    hard_limit_enabled: bool = Field(default=True, index=True)
    settings_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)
