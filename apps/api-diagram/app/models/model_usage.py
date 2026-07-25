"""Durable per-provider model usage events."""

from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now


class ModelUsageEvent(SQLModel, table=True):
    """One actual model HTTP attempt, without prompt or full output content."""

    __tablename__ = "model_usage_events"

    id: str = Field(default_factory=new_id, primary_key=True)
    external_event_id: str = Field(index=True, unique=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    project_id: str | None = Field(default=None, index=True)
    slide_id: str | None = Field(default=None, index=True)
    source: str = Field(default="ppt", index=True)
    stage: str = Field(default="unknown", index=True)
    provider: str = Field(default="unknown", index=True)
    model: str = Field(default="unknown", index=True)
    status: str = Field(default="succeeded", index=True)
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0
    usage_available: bool = False
    estimated_cost: float = 0.0
    currency: str = "CNY"
    pricing_source: str = "unpriced"
    duration_ms: int = 0
    http_status: int | None = None
    error_code: str = ""
    error_message: str = ""
    output_summary: str = ""
    started_at: datetime = Field(default_factory=utc_now, index=True)
    ended_at: datetime | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)

