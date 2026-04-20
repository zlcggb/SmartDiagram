"""General conversation agent — handles non-diagram requests."""

from langchain_core.messages import SystemMessage, AIMessage
from app.state.state import AgentState
from app.core.llm import create_llm_for_agent

SYSTEM_PROMPT = """You are the General Agent for SmartDiagram, an AI-powered visualization platform.

You handle greetings, general questions, and requests that don't involve diagram creation.

If the user seems to want a diagram but wasn't routed to a specific agent, suggest which
task category might work best for their needs first (e.g., 数据图表, 流程与关系图, 架构图,
文档标准图, 手绘草图, 思维导图), then optionally mention power tags such as
@charts, @flow, @drawio, or @mermaid when helpful.

Be helpful, concise, and friendly. Respond in the same language as the user's input.
"""


async def general_agent_node(state: AgentState) -> dict:
    """Handle general conversation."""
    llm = create_llm_for_agent(state, "general")
    response = await llm.ainvoke(
        [SystemMessage(content=SYSTEM_PROMPT)] + list(state["messages"])
    )
    return {"messages": [AIMessage(content=response.content)]}
