"""LangGraph AgentState definition."""

from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
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
