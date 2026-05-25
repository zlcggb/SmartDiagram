"""
Intelligent Router: classifies user intent and routes to the best agent.
Supports explicit @agent tags, canvas context continuation, and LLM-based intent recognition.
"""

from typing import Literal
from langchain_core.messages import HumanMessage, SystemMessage
from app.state.state import AgentState
from app.core.llm import create_llm_for_agent, extract_text_content
from app.agents.catalog import ENGINE_TO_TASK, TASK_TO_ENGINE, get_task_for_engine
from app.core.logger import logger
import re

# Engine capability descriptions for the router prompt
ENGINE_DESCRIPTIONS = {
    "excalidraw": (
        "Best for hand-drawn sketches, whiteboards, low-fidelity wireframes, "
        "discussion drafts, and freeform idea exploration. Output: Excalidraw JSON elements."
    ),
    "mermaid": (
        "Best for document-friendly standard diagrams such as Sequence Diagrams, Class Diagrams, "
        "State Diagrams, ER Diagrams, Gantt Charts, Timelines, and other Mermaid-supported syntax. Output: Mermaid syntax."
    ),
    "flow": (
        "Best for workflows, node-link diagrams, BPMN-like process flows, DAGs, "
        "agent pipelines, approvals, and interactive relationship graphs. "
        "Output: React Flow JSON."
    ),
    "mindmap": (
        "Best for hierarchical structures, mind maps, brainstorming, and concept maps. "
        "Output: Markdown/Markmap format."
    ),
    "charts": (
        "Best for quantitative data visualization: bar, line, pie, gauge, scatter, dashboard, "
        "heatmap, radar, funnel, map, and other chart-first analytics. "
        "Output: ECharts configuration JSON."
    ),
    "drawio": (
        "Best for system architecture, deployment diagrams, cloud infrastructure, network topology, "
        "and detailed enterprise technical architecture. Output: Draw.io mxGraph XML."
    ),
    "infographic": (
        "Best for infographic-style storytelling, visual summaries, KPI posters, executive one-pagers, "
        "and polished presentation templates. Output: AntV Infographic DSL."
    ),
    "general": (
        "Handles greetings, general questions, or requests that don't fit other agents."
    ),
}

TASK_ROUTING_HINTS = {
    "data_chart": [
        "数据图表", "图表", "柱状图", "折线图", "饼图", "面积图", "散点图", "雷达图",
        "漏斗图", "仪表盘", "热力图", "地图", "k线", "k 线", "金融图", "桑基图",
        "旭日图", "tree map", "treemap", "dashboard", "bar chart", "line chart",
        "pie chart", "scatter plot", "heatmap", "chart", "charts",
    ],
    "flow": [
        "流程图", "流程", "工作流", "审批流", "节点图", "关系图", "dag", "workflow",
        "pipeline", "agent flow", "状态机", "state machine", "编排", "泳道图", "flowchart",
    ],
    "architecture": [
        "架构图", "系统架构", "技术架构", "部署图", "云架构", "基础设施图", "网络拓扑",
        "拓扑图", "cloud architecture", "deployment diagram", "infrastructure diagram",
        "network topology",
    ],
    "document": [
        "文档图", "标准图", "时序图", "sequence diagram", "甘特图", "gantt", "时间线",
        "timeline", "er图", "er diagram", "类图", "class diagram", "状态图", "uml",
    ],
    "mindmap": [
        "思维导图", "脑图", "mindmap", "mind map", "知识树", "结构梳理",
    ],
    "sketch": [
        "手绘", "草图", "白板", "低保真", "wireframe", "sketch", "whiteboard", "讨论稿",
    ],
    "infographic": [
        "信息图", "海报", "kpi海报", "一页报告", "宣传图", "visual summary", "infographic",
    ],
}

# Explicit @tag to agent mapping
EXPLICIT_MAPPINGS = {
    "@excalidraw": "excalidraw",
    "@whiteboard": "excalidraw",
    "@sketch": "excalidraw",
    "@draw": "excalidraw",
    "@mermaid": "mermaid",
    "@sequence": "mermaid",
    "@gantt": "mermaid",
    "@timeline": "mermaid",
    "@flow": "flow",
    "@flowchart": "flow",
    "@workflow": "flow",
    "@dag": "flow",
    "@mindmap": "mindmap",
    "@chart": "charts",
    "@charts": "charts",
    "@dashboard": "charts",
    "@drawio": "drawio",
    "@architecture": "drawio",
    "@topology": "drawio",
    "@infographic": "infographic",
    "@infograph": "infographic",
}


def detect_task_from_keywords(text: str, current_task: str = "") -> str | None:
    """Use lightweight task keywords to short-circuit obvious routing cases."""
    lowered = text.lower().strip()
    if not lowered:
        return None

    scores: dict[str, int] = {}
    for agent, keywords in TASK_ROUTING_HINTS.items():
        score = sum(1 for keyword in keywords if keyword in lowered)
        if score > 0:
            scores[agent] = score

    if not scores:
        return None

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best_task, best_score = ranked[0]
    tied = [task for task, score in ranked if score == best_score]

    if len(tied) > 1:
        if current_task and current_task in tied:
            return current_task
        return None

    return best_task


import time as _time

async def router_node(state: AgentState) -> dict:
    """Analyze user input and determine target agent."""
    _t0 = _time.time()
    messages = state["messages"]
    last_message = messages[-1]

    text_content = ""
    if isinstance(last_message, HumanMessage):
        if isinstance(last_message.content, str):
            text_content = last_message.content
        elif isinstance(last_message.content, list):
            text_content = " ".join(
                part.get("text", "") for part in last_message.content
                if isinstance(part, dict) and part.get("type") == "text"
            )

    if text_content:
        content_lower = text_content.lower().strip()
        for tag, agent_name in sorted(EXPLICIT_MAPPINGS.items(), key=lambda x: len(x[0]), reverse=True):
            if tag in content_lower:
                cleaned = re.sub(
                    rf"{re.escape(tag)}\s*", "", text_content, flags=re.IGNORECASE
                ).strip()
                cleaned = re.sub(r"<existing_code>[\s\S]*?</existing_code>", "", cleaned).strip()
                if not cleaned:
                    cleaned = f"Generate a default {agent_name} diagram."
                if isinstance(last_message.content, list):
                    for part in last_message.content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            part["text"] = cleaned
                            break
                else:
                    last_message.content = cleaned
                logger.info(f"⏱️ Router (@tag shortcut) took {_time.time()-_t0:.1f}s → {agent_name}")
                return {"intent": agent_name}

    current_task = state.get("current_task", "")
    current_engine = state.get("current_engine", "")
    current_code = state.get("current_code", "")
    clean_text = re.sub(r"<existing_code>[\s\S]*?</existing_code>", "", text_content).strip()
    keyword_task = detect_task_from_keywords(clean_text, current_task)

    if keyword_task and keyword_task != current_task:
        engine_type = TASK_TO_ENGINE.get(keyword_task, "general")
        logger.info(f"⏱️ Router (keyword match) took {_time.time()-_t0:.1f}s → {engine_type}")
        return {"task_type": keyword_task, "engine_type": engine_type, "intent": engine_type}

    # If there is history (multi-turn conversation) and a current active engine,
    # default to continuing with the current engine unless a keyword strongly matches another agent.
    # This short-circuits the LLM router call to save 3-10 seconds.
    if current_engine and current_engine in ENGINE_DESCRIPTIONS:
        is_multi_turn = len(messages) > 1 or current_code
        if is_multi_turn and (not keyword_task or keyword_task == current_task):
            logger.info(f"⏱️ Router (multi-turn continuation) took {_time.time()-_t0:.1f}s → {current_engine}")
            return {
                "task_type": current_task or get_task_for_engine(current_engine),
                "engine_type": current_engine,
                "intent": current_engine,
            }

    if keyword_task:
        engine_type = TASK_TO_ENGINE.get(keyword_task, "general")
        logger.info(f"⏱️ Router (keyword fallback) took {_time.time()-_t0:.1f}s → {engine_type}")
        return {"task_type": keyword_task, "engine_type": engine_type, "intent": engine_type}

    # 3. LLM-based intent classification
    desc_text = "\n".join(f"- '{k}': {v}" for k, v in ENGINE_DESCRIPTIONS.items())

    context_hint = ""
    if current_engine:
        context_hint = f"\nCURRENT ACTIVE ENGINE: {current_engine}\nCURRENT ACTIVE TASK: {current_task or get_task_for_engine(current_engine)}\nIf the user's request is a follow-up, edit, or refinement of the current diagram, prefer the current engine unless they clearly want something different.\n"

    system_prompt = f"""You are the SmartDiagram Router.
Analyze the user's request and classify the intent to route to the best agent.
{context_hint}
Available agents:
{desc_text}

Respond with ONLY one keyword: 'excalidraw', 'mermaid', 'flow', 'mindmap', 'charts', 'drawio', 'infographic', or 'general'.
"""

    logger.info(f"⏱️ Router: keyword match failed, calling LLM for classification...")
    llm = create_llm_for_agent(state, "router")
    classify_text = clean_text

    response = await llm.ainvoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=classify_text),
    ])
    intent = extract_text_content(response.content).strip().lower()

    for engine_key in ENGINE_DESCRIPTIONS:
        if engine_key in intent:
            logger.info(f"⏱️ Router (LLM classification) took {_time.time()-_t0:.1f}s → {engine_key}")
            return {
                "task_type": ENGINE_TO_TASK.get(engine_key, "general"),
                "engine_type": engine_key,
                "intent": engine_key,
            }

    logger.info(f"⏱️ Router (LLM fallback) took {_time.time()-_t0:.1f}s → general")
    return {"task_type": "general", "engine_type": "general", "intent": "general"}


def route_decision(
    state: AgentState,
) -> Literal[
    "excalidraw_agent",
    "mermaid_agent",
    "flow_agent",
    "mindmap_agent",
    "charts_agent",
    "drawio_agent",
    "infographic_agent",
    "general_agent",
]:
    """Map intent string to agent node name."""
    mapping = {
        "excalidraw": "excalidraw_agent",
        "mermaid": "mermaid_agent",
        "flow": "flow_agent",
        "mindmap": "mindmap_agent",
        "charts": "charts_agent",
        "drawio": "drawio_agent",
        "infographic": "infographic_agent",
        "general": "general_agent",
    }
    return mapping.get(state.get("engine_type", "") or state.get("intent", ""), "general_agent")
