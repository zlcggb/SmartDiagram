"""Shared Agent Harness runtime state contracts.

These types describe the enterprise execution envelope around the existing
diagram-generation agents. They are intentionally lightweight so the current
MVP graph can keep running while richer planning, validation, permissions, and
audit features are added incrementally.
"""

from typing import Any, Literal, NotRequired, TypedDict


ExecutionStatus = Literal[
    "pending",
    "running",
    "succeeded",
    "failed",
    "skipped",
    "needs_user_input",
]

ExecutionPhase = Literal[
    "routing",
    "planning",
    "retrieving_context",
    "generating_draft",
    "designing",
    "validating",
    "rendering",
    "exporting",
    "completed",
]


class PermissionContext(TypedDict, total=False):
    """Request-scoped authorization context for enterprise execution."""

    tenant_id: str
    user_id: str
    team_id: NotRequired[str]
    project_id: NotRequired[str]
    roles: list[str]
    scopes: list[str]
    allowed_knowledge_scopes: list[str]
    allowed_tool_scopes: list[str]


class AgentExecutionStep(TypedDict, total=False):
    """A single observable Agent Harness execution step."""

    id: str
    label: str
    agent: str
    phase: ExecutionPhase
    status: ExecutionStatus
    started_at: NotRequired[str | None]
    ended_at: NotRequired[str | None]
    error: NotRequired[str | None]
    metadata: NotRequired[dict[str, Any]]


class ToolCallRecord(TypedDict, total=False):
    """Audit-friendly record for a tool invocation."""

    id: str
    tool_name: str
    status: ExecutionStatus
    input_summary: NotRequired[str]
    output_summary: NotRequired[str]
    started_at: NotRequired[str | None]
    ended_at: NotRequired[str | None]
    cost_estimate: NotRequired[float]
    error: NotRequired[str | None]


class AuditEvent(TypedDict, total=False):
    """Structured event that can later be persisted to audit logs."""

    type: str
    actor_user_id: NotRequired[str]
    tenant_id: NotRequired[str]
    project_id: NotRequired[str]
    message: str
    metadata: NotRequired[dict[str, Any]]


class ValidationIssue(TypedDict, total=False):
    """Output validation issue emitted by validators."""

    code: str
    message: str
    severity: Literal["info", "warning", "error"]
    repairable: bool
