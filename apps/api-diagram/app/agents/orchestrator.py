"""LangGraph orchestrator for the enterprise Agent Harness."""

from langgraph.graph import StateGraph, END
from app.state.state import AgentState
from app.agents.router import router_node, route_decision
from app.agents.excalidraw_agent import excalidraw_agent_node
from app.agents.mermaid_agent import mermaid_agent_node
from app.agents.general_agent import general_agent_node
from app.agents.drawio_agent import drawio_agent_node
from app.agents.infographic_agent import infographic_agent_node
from app.agents.office_artifact_agent import office_artifact_agent_node
from app.agents.flow_agent import flow_agent_node
from app.agents.mindmap_agent import mindmap_agent_node
from app.agents.charts_agent import charts_agent_node
from app.agents.knowledge_agent import knowledge_agent_node
from app.agents.planner_agent import planner_agent_node
from app.agents.design_agent import design_agent_node
from app.agents.validator_agent import validator_agent_node
from app.agents.repair_agent import repair_agent_node
from app.agents.consistency_agent import consistency_agent_node, route_after_consistency
from app.agents.export_agent import export_agent_node


def route_after_router(state: AgentState) -> str:
    """Route general chat directly, and diagram tasks through Planner Agent."""

    engine = state.get("engine_type", "") or state.get("intent", "")
    if engine == "general":
        return "general_agent"
    return "planner_agent"

# Build the state graph
workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("router", router_node)
workflow.add_node("excalidraw_agent", excalidraw_agent_node)
workflow.add_node("mermaid_agent", mermaid_agent_node)
workflow.add_node("flow_agent", flow_agent_node)
workflow.add_node("mindmap_agent", mindmap_agent_node)
workflow.add_node("charts_agent", charts_agent_node)
workflow.add_node("drawio_agent", drawio_agent_node)
workflow.add_node("infographic_agent", infographic_agent_node)
workflow.add_node("office_artifact_agent", office_artifact_agent_node)
workflow.add_node("planner_agent", planner_agent_node)
workflow.add_node("knowledge_agent", knowledge_agent_node)
workflow.add_node("design_agent", design_agent_node)
workflow.add_node("validator_agent", validator_agent_node)
workflow.add_node("repair_agent", repair_agent_node)
workflow.add_node("consistency_agent", consistency_agent_node)
workflow.add_node("export_agent", export_agent_node)
workflow.add_node("general_agent", general_agent_node)

# Entry point
workflow.set_entry_point("router")

# Conditional routing from router to agents
workflow.add_conditional_edges(
    "router",
    route_after_router,
    {
        "planner_agent": "planner_agent",
        "general_agent": "general_agent",
    },
)

# Planner decomposes the task, Knowledge Agent enriches state, then dispatches.
workflow.add_edge("planner_agent", "knowledge_agent")

workflow.add_conditional_edges(
    "knowledge_agent",
    route_decision,
    {
        "excalidraw_agent": "excalidraw_agent",
        "mermaid_agent": "mermaid_agent",
        "flow_agent": "flow_agent",
        "mindmap_agent": "mindmap_agent",
        "charts_agent": "charts_agent",
        "drawio_agent": "drawio_agent",
        "infographic_agent": "infographic_agent",
        "office_artifact_agent": "office_artifact_agent",
    },
)

# Diagram agents normalize design, run deterministic validation, then prepare export options.
for agent in [
    "excalidraw_agent",
    "mermaid_agent",
    "flow_agent",
    "mindmap_agent",
    "charts_agent",
    "drawio_agent",
    "infographic_agent",
    "office_artifact_agent",
]:
    workflow.add_edge(agent, "design_agent")

workflow.add_edge("design_agent", "validator_agent")
workflow.add_edge("validator_agent", "repair_agent")
workflow.add_edge("repair_agent", "consistency_agent")
workflow.add_conditional_edges(
    "consistency_agent",
    route_after_consistency,
    {
        "export_agent": "export_agent",
        "needs_user_input": END,
    },
)
workflow.add_edge("export_agent", END)
workflow.add_edge("general_agent", END)

# Compile
graph = workflow.compile()
