"""
LangGraph orchestrator: Router → Agent → END
"""

from langgraph.graph import StateGraph, END
from app.state.state import AgentState
from app.agents.router import router_node, route_decision
from app.agents.excalidraw_agent import excalidraw_agent_node
from app.agents.mermaid_agent import mermaid_agent_node
from app.agents.general_agent import general_agent_node
from app.agents.drawio_agent import drawio_agent_node
from app.agents.infographic_agent import infographic_agent_node
from app.agents.flow_agent import flow_agent_node
from app.agents.mindmap_agent import mindmap_agent_node
from app.agents.charts_agent import charts_agent_node

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
workflow.add_node("general_agent", general_agent_node)

# Entry point
workflow.set_entry_point("router")

# Conditional routing from router to agents
workflow.add_conditional_edges(
    "router",
    route_decision,
    {
        "excalidraw_agent": "excalidraw_agent",
        "mermaid_agent": "mermaid_agent",
        "flow_agent": "flow_agent",
        "mindmap_agent": "mindmap_agent",
        "charts_agent": "charts_agent",
        "drawio_agent": "drawio_agent",
        "infographic_agent": "infographic_agent",
        "general_agent": "general_agent",
    },
)

# All agents → END
for agent in [
    "excalidraw_agent",
    "mermaid_agent",
    "flow_agent",
    "mindmap_agent",
    "charts_agent",
    "drawio_agent",
    "infographic_agent",
    "general_agent",
]:
    workflow.add_edge(agent, END)

# Compile
graph = workflow.compile()
