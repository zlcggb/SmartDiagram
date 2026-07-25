"""Guest session and usage isolation tables."""

from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now


class GuestSession(SQLModel, table=True):
    """Server-issued guest identity (isolated from registered users)."""

    __tablename__ = "guest_sessions"

    id: str = Field(default_factory=new_id, primary_key=True)
    ip_hash: str = Field(default="", index=True)
    user_agent_hash: str = Field(default="", index=True)
    ai_calls_used: int = Field(default=0)
    status: str = Field(default="active", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)
    expires_at: datetime = Field(default_factory=utc_now, index=True)
    last_seen_at: datetime = Field(default_factory=utc_now, index=True)


class GuestUsageEvent(SQLModel, table=True):
    """AI usage records for guest principals (not mixed into tenant billing)."""

    __tablename__ = "guest_usage_events"

    id: str = Field(default_factory=new_id, primary_key=True)
    guest_id: str = Field(foreign_key="guest_sessions.id", index=True)
    source: str = Field(default="diagram", index=True)
    route: str = Field(default="", index=True)
    ip_hash: str = Field(default="", index=True)
    estimated_total_tokens: int = Field(default=0)
    estimated_cost: float = Field(default=0.0)
    created_at: datetime = Field(default_factory=utc_now, index=True)
