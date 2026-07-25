"""Agent execution, tool call, and audit event models."""

from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now
from datetime import datetime


class AgentRun(SQLModel, table=True):
    """One end-to-end Agent Harness execution."""

    __tablename__ = "agent_runs"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    conversation_id: str | None = Field(default=None, foreign_key="conversations.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    status: str = Field(default="running", index=True)
    intent: str = Field(default="", index=True)
    task_type: str = Field(default="", index=True)
    engine_type: str = Field(default="", index=True)
    execution_plan_json: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    execution_steps_json: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    model_config_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    token_usage_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    cost_estimate: float = 0.0
    error_message: str = ""
    started_at: datetime = Field(default_factory=utc_now, index=True)
    ended_at: datetime | None = Field(default=None, index=True)


class AgentTraceSpan(SQLModel, table=True):
    """OpenTelemetry-style span record for Agent graph execution."""

    __tablename__ = "agent_trace_spans"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    agent_run_id: str = Field(foreign_key="agent_runs.id", index=True)
    conversation_id: str | None = Field(default=None, foreign_key="conversations.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    trace_id: str = Field(index=True)
    span_id: str = Field(index=True)
    parent_span_id: str | None = Field(default=None, index=True)
    name: str = Field(index=True)
    span_type: str = Field(default="chain", index=True)
    status: str = Field(default="running", index=True)
    duration_ms: float = 0.0
    attributes_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    started_at: datetime = Field(default_factory=utc_now, index=True)
    ended_at: datetime | None = Field(default=None, index=True)


class ToolCall(SQLModel, table=True):
    """Audit-friendly record of an internal or external tool invocation."""

    __tablename__ = "tool_calls"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    agent_run_id: str | None = Field(default=None, foreign_key="agent_runs.id", index=True)
    conversation_id: str | None = Field(default=None, foreign_key="conversations.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    tool_name: str = Field(index=True)
    status: str = Field(default="running", index=True)
    input_summary: str = ""
    output_summary: str = ""
    input_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    output_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    error_message: str = ""
    cost_estimate: float = 0.0
    started_at: datetime = Field(default_factory=utc_now, index=True)
    ended_at: datetime | None = Field(default=None, index=True)


class AuditEvent(SQLModel, table=True):
    """Append-only audit event for security, compliance, and debugging."""

    __tablename__ = "audit_events"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    conversation_id: str | None = Field(default=None, foreign_key="conversations.id", index=True)
    agent_run_id: str | None = Field(default=None, foreign_key="agent_runs.id", index=True)
    event_type: str = Field(index=True)
    severity: str = Field(default="info", index=True)
    message: str = ""
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)


class HumanApprovalRequest(SQLModel, table=True):
    """Durable human-in-the-loop approval checkpoint."""

    __tablename__ = "human_approval_requests"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    conversation_id: str | None = Field(default=None, foreign_key="conversations.id", index=True)
    agent_run_id: str | None = Field(default=None, foreign_key="agent_runs.id", index=True)
    requested_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    decided_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    approval_type: str = Field(index=True)
    status: str = Field(default="pending", index=True)
    required_scope: str = Field(default="approval:write", index=True)
    reason: str = ""
    resource_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    decision_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    decided_at: datetime | None = Field(default=None, index=True)
    expires_at: datetime | None = Field(default=None, index=True)
