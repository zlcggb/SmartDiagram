"""Usage budget models for enterprise guardrails."""

from typing import Any

from datetime import datetime
from sqlalchemy import Column, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now


class TenantUsageBudget(SQLModel, table=True):
    """Monthly tenant-level Agent usage budget."""

    __tablename__ = "tenant_usage_budgets"
    __table_args__ = (
        UniqueConstraint("tenant_id", "period", name="uq_tenant_usage_budget_period"),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    period: str = Field(index=True, description="Budget period in YYYY-MM format.")
    monthly_cost_limit: float = Field(default=0.0)
    monthly_token_limit: int = Field(default=0)
    hard_limit_enabled: bool = Field(default=True, index=True)
    status: str = Field(default="active", index=True)
    settings_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class TenantUsageRollup(SQLModel, table=True):
    """Pre-aggregated Agent usage for tenant or project observability."""

    __tablename__ = "tenant_usage_rollups"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "period",
            "scope",
            "scope_id",
            name="uq_tenant_usage_rollup_scope_period",
        ),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    period: str = Field(index=True, description="Budget period in YYYY-MM format.")
    scope: str = Field(default="tenant", index=True)
    scope_id: str = Field(default="__tenant__", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    run_count: int = 0
    status_counts_json: dict[str, int] = Field(default_factory=dict, sa_column=Column(JSON))
    estimated_cost: float = 0.0
    estimated_total_tokens: int = 0
    estimated_input_tokens: int = 0
    estimated_output_tokens: int = 0
    refreshed_at: datetime = Field(default_factory=utc_now, index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)
