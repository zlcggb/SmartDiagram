"""Runtime helpers for enterprise Agent Harness execution plans."""

from app.state.agent_runtime import AgentExecutionStep
from app.artifacts.catalog import default_exports_for_engine, is_office_artifact


ENGINE_LABELS: dict[str, str] = {
    "excalidraw": "Excalidraw 手绘草图",
    "mermaid": "Mermaid 标准图",
    "flow": "React Flow 流程图",
    "mindmap": "思维导图",
    "charts": "ECharts 数据图表",
    "drawio": "Draw.io 架构图",
    "infographic": "信息图",
    "html_email": "HTML 邮件",
    "web_report_html": "HTML 网页分析稿",
    "general": "通用助手",
}


def _step(
    step_id: str,
    label: str,
    agent: str,
    phase: str,
    status: str = "pending",
    metadata: dict | None = None,
) -> AgentExecutionStep:
    return {
        "id": step_id,
        "label": label,
        "agent": agent,
        "phase": phase,
        "status": status,
        "metadata": metadata or {},
    }


def build_default_execution_plan(
    task_type: str | None,
    engine_type: str | None,
) -> list[AgentExecutionStep]:
    """Build the default observable plan for the current LangGraph run.

    This is the initial plan shown before every downstream node has produced
    trace data. Live SSE status events and persisted trace spans later reconcile
    these planned steps into running, succeeded, failed, or skipped states.
    """

    task = task_type or "general"
    engine = engine_type or "general"
    engine_label = ENGINE_LABELS.get(engine, engine)
    is_office = is_office_artifact(engine)
    intent_label = "办公产物类型" if is_office else "图表类型"
    planning_label = "拆解办公产物生成任务" if is_office else "拆解图表生成任务"
    knowledge_label = "检索企业模板、历史案例和知识上下文"
    draft_label = f"生成 {engine_label} 结构化办公产物草稿" if is_office else f"生成 {engine_label} 结构化图表"
    validation_label = "校验办公产物结构、权限和输出安全" if is_office else "校验图表结构、权限和输出安全"
    export_formats = default_exports_for_engine(engine)

    return [
        _step(
            "router",
            f"识别用户意图和{intent_label}",
            "router",
            "routing",
            "succeeded",
            {"task_type": task, "engine_type": engine},
        ),
        _step(
            "planner",
            planning_label,
            "planner",
            "planning",
            "pending",
            {"mode": "planned"},
        ),
        _step(
            "knowledge",
            knowledge_label,
            "knowledge",
            "retrieving_context",
            "pending",
            {"mode": "planned", "requires": ["knowledge_base", "permissions"]},
        ),
        _step(
            "chart",
            draft_label,
            engine,
            "generating_draft",
            "pending",
            {"task_type": task, "engine_type": engine},
        ),
        _step(
            "designer",
            "优化布局、样式和可读性",
            "design",
            "designing",
            "pending",
            {"mode": "deterministic", "engine_type": engine},
        ),
        _step(
            "validator",
            validation_label,
            "validator",
            "validating",
            "pending",
            {"mode": "planned", "requires": ["schema_validation", "policy_check"]},
        ),
        _step(
            "repair",
            "修正常见输出结构错误",
            "repair",
            "validating",
            "pending",
            {"mode": "deterministic", "runs_after": "validator"},
        ),
        _step(
            "consistency",
            "检查生成结果与企业知识约束一致性",
            "consistency",
            "validating",
            "pending",
            {"mode": "deterministic", "requires": ["authorized_knowledge_context"]},
        ),
        _step(
            "renderer",
            "渲染并返回画布结果",
            "renderer",
            "rendering",
            "pending",
            {"engine_type": engine},
        ),
        _step(
            "export",
            "准备权限感知导出计划",
            "export",
            "exporting",
            "pending",
            {"formats": export_formats},
        ),
    ]


def step_to_event(step: AgentExecutionStep) -> dict:
    """Return a stable JSON-serializable step event payload."""

    return {
        "id": step.get("id", ""),
        "label": step.get("label", ""),
        "agent": step.get("agent", ""),
        "phase": step.get("phase", ""),
        "status": step.get("status", "pending"),
        "metadata": step.get("metadata", {}),
    }


def steps_to_events(steps: list[AgentExecutionStep]) -> list[dict]:
    """Serialize execution steps for SSE transport."""

    return [step_to_event(step) for step in steps]
