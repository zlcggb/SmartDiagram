"""LangGraph AgentState definition."""

from typing import Annotated, Any, Sequence, TypedDict
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from app.state.agent_runtime import (
    AgentExecutionStep,
    AuditEvent,
    PermissionContext,
    ToolCallRecord,
    ValidationIssue,
)


class AgentState(TypedDict, total=False):
    """Shared state passed through the LangGraph agent pipeline."""

    # Chat messages (LangGraph manages appending via add_messages reducer)
    messages: Annotated[Sequence[BaseMessage], add_messages]

    # Router decision: which agent to invoke
    intent: str
    task_type: str
    engine_type: str

    # Optional: user-provided model configuration from the frontend
    model_config: dict | None

    # Current canvas state — enables incremental editing
    current_code: str       # The code currently rendered on the canvas
    current_task: str       # Which task category produced the current canvas content
    current_engine: str     # Which engine produced the current canvas content

    # Enterprise Agent Harness context
    run_id: str
    conversation_id: str
    tenant_id: str
    user_id: str
    team_id: str
    project_id: str
    permission_context: PermissionContext

    # Multi-step execution state. The current MVP only uses a subset of these
    # fields, but keeping the contract here lets future LangGraph nodes share
    # a single state envelope.
    execution_plan: list[AgentExecutionStep]
    execution_steps: list[AgentExecutionStep]
    memory_context: dict[str, Any]
    validation_errors: list[ValidationIssue]
    audit_events: list[AuditEvent]
    tool_calls: list[ToolCallRecord]
    cost_estimate: float
    error_count: int
    max_retries: int
