"""Planner Agent for deterministic task decomposition."""

import re
from typing import Any

from langchain_core.messages import HumanMessage

from app.core.llm import extract_text_content
from app.artifacts.catalog import is_office_artifact
from app.services.agent_runtime import build_default_execution_plan
from app.state.state import AgentState


EXISTING_CODE_RE = re.compile(r"<existing_code>[\s\S]*?</existing_code>", re.IGNORECASE)
SYSTEM_INSTRUCTION_RE = re.compile(r"\[System Instruction:[\s\S]*?\]", re.IGNORECASE)

ENGINE_OUTPUT_CONTRACTS: dict[str, dict[str, Any]] = {
    "excalidraw": {
        "format": "excalidraw_elements",
        "required": ["elements"],
        "validator": "excalidraw_elements",
    },
    "mermaid": {
        "format": "mermaid_syntax",
        "required": ["non_empty_text"],
        "validator": "mermaid_text",
    },
    "flow": {
        "format": "react_flow_json",
        "required": ["nodes", "edges"],
        "validator": "react_flow_schema",
    },
    "mindmap": {
        "format": "markdown_mindmap",
        "required": ["root_topic", "hierarchy"],
        "validator": "mindmap_markdown",
    },
    "charts": {
        "format": "echarts_option_json",
        "required": ["series"],
        "validator": "echarts_option_schema",
    },
    "drawio": {
        "format": "drawio_mxfile_xml",
        "required": ["mxfile"],
        "validator": "drawio_xml",
    },
    "infographic": {
        "format": "infographic_dsl",
        "required": ["layout", "blocks"],
        "validator": "infographic_dsl",
    },
    "html_email": {
        "format": "office_artifact_dsl",
        "required": ["artifact_type", "email.subject", "sections"],
        "validator": "html_email_artifact",
    },
    "web_report_html": {
        "format": "office_artifact_dsl",
        "required": ["artifact_type", "title", "sections"],
        "validator": "web_report_artifact",
    },
}


def _latest_user_query(state: AgentState) -> str:
    for message in reversed(list(state.get("messages", []))):
        if isinstance(message, HumanMessage):
            text = extract_text_content(message.content)
            text = EXISTING_CODE_RE.sub("", text)
            text = SYSTEM_INSTRUCTION_RE.sub("", text)
            return " ".join(text.split()).strip()
    return ""


def _knowledge_required(query: str, permission_context: dict[str, Any]) -> bool:
    enterprise_markers = [
        "企业",
        "团队",
        "项目",
        "历史",
        "模板",
        "规范",
        "销售",
        "报价",
        "审批",
        "合同",
        "客户",
        "邮件",
        "网页",
        "报告",
    ]
    has_enterprise_scope = bool(permission_context.get("project_id")) or "knowledge:read" in set(
        permission_context.get("scopes") or []
    )
    return has_enterprise_scope or any(marker in query for marker in enterprise_markers)


def _infer_complexity(query: str, current_code: str) -> str:
    length = len(query)
    if current_code:
        return "edit"
    if length > 180 or any(token in query.lower() for token in ["端到端", "enterprise", "架构", "审批", "多角色"]):
        return "complex"
    return "standard"


def _build_subtasks(engine: str, knowledge_required: bool, mode: str) -> list[dict[str, Any]]:
    artifact_label = "办公产物" if is_office_artifact(engine) else "图表"
    generator_owner = "Office Artifact Agent" if is_office_artifact(engine) else "Chart Agent"
    subtasks: list[dict[str, Any]] = [
        {
            "id": "requirements",
            "label": "提取业务对象、参与方、输入输出和边界条件",
            "owner": "Planner Agent",
            "required": True,
        }
    ]
    subtasks.append(
        {
            "id": "knowledge",
            "label": "检索企业模板、历史图表和项目知识",
            "owner": "Knowledge Agent",
            "required": knowledge_required,
        }
    )
    subtasks.extend(
        [
            {
                "id": "draft",
                "label": f"生成 {engine or artifact_label} 结构化草稿",
                "owner": generator_owner,
                "required": True,
            },
            {
                "id": "layout",
                "label": "整理布局、命名和可读性",
                "owner": "Design Agent",
                "required": True,
            },
            {
                "id": "validate",
                "label": "校验格式、结构和权限安全",
                "owner": "Validator Agent",
                "required": True,
            },
            {
                "id": "repair",
                "label": "修复可自动纠正的输出结构问题",
                "owner": "Repair Agent",
                "required": False,
            },
            {
                "id": "export",
                "label": "准备可授权的导出格式",
                "owner": "Export Agent",
                "required": mode != "edit",
            },
        ]
    )
    return subtasks


def build_generation_plan(state: AgentState) -> dict[str, Any]:
    """Build an auditable, non-LLM execution plan for a chart request."""

    permission_context = state.get("permission_context", {}) or {}
    query = _latest_user_query(state)
    engine = state.get("engine_type") or state.get("current_engine") or ""
    task = state.get("task_type") or state.get("current_task") or ""
    current_code = state.get("current_code") or ""
    mode = "edit" if current_code else "create"
    complexity = _infer_complexity(query, current_code)
    needs_knowledge = _knowledge_required(query, permission_context)
    output_contract = ENGINE_OUTPUT_CONTRACTS.get(
        engine,
        {"format": "generic_diagram", "required": ["diagram_payload"], "validator": "generic"},
    )
    assumptions = []
    if len(query) < 12:
        assumptions.append("用户需求较短，先按通用业务流程模板生成。")
    if not needs_knowledge:
        fallback_label = "办公产物" if is_office_artifact(engine) else "图表"
        assumptions.append(f"未检测到强企业知识依赖，知识检索无结果时使用通用{fallback_label}模板。")

    return {
        "status": "ready",
        "mode": mode,
        "complexity": complexity,
        "task_type": task,
        "engine_type": engine,
        "user_goal": query[:240],
        "knowledge_required": needs_knowledge,
        "subtasks": _build_subtasks(engine, needs_knowledge, mode),
        "output_contract": output_contract,
        "quality_gates": [
            "tenant_project_permission_filter",
            output_contract["validator"],
            "prompt_injection_safe_context",
            "export_scope_check",
        ],
        "fallback_strategy": [
            "知识库无授权结果时继续使用通用模板",
            "结构校验失败时标记可修复错误并保留原始输出供前端展示",
            "导出权限不足时只返回允许格式",
        ],
        "note": "Planner Agent decomposed the request before retrieval and generation.",
    }


def _mark_planner_step_succeeded(plan_steps: list[dict[str, Any]], planning: dict[str, Any]) -> list[dict[str, Any]]:
    updated: list[dict[str, Any]] = []
    for step in plan_steps:
        copied = dict(step)
        metadata = dict(copied.get("metadata") or {})
        if copied.get("id") == "planner":
            copied["status"] = "succeeded"
            metadata.update(
                {
                    "mode": planning["mode"],
                    "complexity": planning["complexity"],
                    "subtask_count": len(planning["subtasks"]),
                    "knowledge_required": planning["knowledge_required"],
                }
            )
        elif copied.get("id") == "knowledge":
            metadata["required"] = planning["knowledge_required"]
        copied["metadata"] = metadata
        updated.append(copied)
    return updated


async def planner_agent_node(state: AgentState) -> dict:
    """Create the execution plan used by downstream enterprise agents."""

    planning = build_generation_plan(state)
    memory_context = dict(state.get("memory_context", {}) or {})
    memory_context["planning"] = planning
    base_steps = state.get("execution_plan") or build_default_execution_plan(
        planning["task_type"],
        planning["engine_type"],
    )
    execution_plan = _mark_planner_step_succeeded(base_steps, planning)
    permission_context = state.get("permission_context", {}) or {}
    audit_event = {
        "type": "planner.plan.created",
        "actor_user_id": permission_context.get("user_id"),
        "tenant_id": permission_context.get("tenant_id"),
        "project_id": permission_context.get("project_id"),
        "message": "Planner Agent decomposed the diagram generation task.",
        "metadata": {
            "status": planning["status"],
            "mode": planning["mode"],
            "complexity": planning["complexity"],
            "engine_type": planning["engine_type"],
            "task_type": planning["task_type"],
            "subtask_count": len(planning["subtasks"]),
            "knowledge_required": planning["knowledge_required"],
            "quality_gates": planning["quality_gates"],
        },
    }
    tool_call = {
        "tool_name": "planner.task_decomposition",
        "status": "succeeded",
        "input_summary": f"engine={planning['engine_type'] or 'unknown'}",
        "output_summary": f"subtasks={len(planning['subtasks'])}",
    }
    return {
        "memory_context": memory_context,
        "execution_plan": execution_plan,
        "audit_events": [audit_event],
        "tool_calls": [tool_call],
    }
