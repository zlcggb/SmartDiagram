"""Smoke test runtime guardrails without external LLM calls.

Usage:
  uv run python scripts/smoke_runtime_guards.py
"""

import sys
import asyncio
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from langchain_core.messages import AIMessage, HumanMessage

from app.core.config import settings
from app.agents.consistency_agent import consistency_agent_node
from app.agents.design_agent import design_agent_node
from app.agents.export_agent import export_agent_node
from app.agents.orchestrator import graph
from app.agents.planner_agent import planner_agent_node
from app.agents.repair_agent import repair_agent_node
from app.agents.validator_agent import validator_agent_node
from app.services.agent_runtime import build_default_execution_plan
from app.services.runtime_guard_service import (
    RuntimeGuardError,
    StreamLoopGuard,
    evaluate_runtime_request_async,
    evaluate_runtime_request,
    reset_runtime_guard_state,
)


def main() -> int:
    permission_context = {
        "tenant_id": "runtime-smoke",
        "user_id": "runtime-user",
        "roles": ["member"],
        "scopes": ["diagram:read", "diagram:write"],
    }
    body = {"message": "生成销售报价流程图", "max_tokens": 512}

    reset_runtime_guard_state()
    first = evaluate_runtime_request(body, permission_context, rate_limit_per_minute=2)
    second = evaluate_runtime_request(body, permission_context, rate_limit_per_minute=2)
    third = evaluate_runtime_request(body, permission_context, rate_limit_per_minute=2)
    if not first["allowed"] or not second["allowed"]:
        print(f"FAIL: first two requests should pass: {first} {second}")
        return 1
    if third["allowed"] or third["reason"] != "rate_limited":
        print(f"FAIL: third request should be rate limited: {third}")
        return 1

    reset_runtime_guard_state()
    over_budget = evaluate_runtime_request(
        {"message": "x" * 5000, "max_tokens": 512},
        permission_context,
        max_estimated_tokens=100,
    )
    if over_budget["allowed"] or over_budget["reason"] != "estimated_token_budget_exceeded":
        print(f"FAIL: oversized request should fail budget: {over_budget}")
        return 1

    reset_runtime_guard_state()
    degraded = evaluate_runtime_request(
        {"message": "x" * 1200, "max_tokens": 512},
        permission_context,
        max_estimated_tokens=2000,
        degrade_token_threshold=100,
    )
    if not degraded["allowed"] or not degraded["degraded"]:
        print(f"FAIL: large-but-allowed request should degrade: {degraded}")
        return 1

    loop_guard = StreamLoopGuard(max_events=2, max_agent_repeats=1)
    try:
        loop_guard.observe_event({"event": "on_chain_start", "name": "router"})
        loop_guard.observe_event({"event": "on_chain_end", "name": "router"})
        loop_guard.observe_event({"event": "on_chain_stream", "name": "router"})
        print("FAIL: loop guard did not enforce max_events")
        return 1
    except RuntimeGuardError:
        pass

    repeat_guard = StreamLoopGuard(max_events=10, max_agent_repeats=1)
    try:
        repeat_guard.observe_event({"event": "on_chain_start", "name": "router"})
        repeat_guard.observe_event({"event": "on_chain_start", "name": "router"})
        print("FAIL: loop guard did not enforce repeated step limit")
        return 1
    except RuntimeGuardError:
        pass

    execution_plan = build_default_execution_plan("flowchart", "mermaid")
    if not any(step.get("id") == "designer" and step.get("phase") == "designing" for step in execution_plan):
        print(f"FAIL: execution plan missing Design Agent step: {execution_plan}")
        return 1
    if not any(step.get("id") == "repair" and step.get("agent") == "repair" for step in execution_plan):
        print(f"FAIL: execution plan missing Repair Agent step: {execution_plan}")
        return 1
    if not any(step.get("id") == "consistency" and step.get("agent") == "consistency" for step in execution_plan):
        print(f"FAIL: execution plan missing Consistency Agent step: {execution_plan}")
        return 1
    if not any(step.get("id") == "export" and step.get("phase") == "exporting" for step in execution_plan):
        print(f"FAIL: execution plan missing Export Agent step: {execution_plan}")
        return 1
    graph_edges = {(edge.source, edge.target) for edge in graph.get_graph().edges}
    diagram_agents = {
        "excalidraw_agent",
        "mermaid_agent",
        "flow_agent",
        "mindmap_agent",
        "charts_agent",
        "drawio_agent",
        "infographic_agent",
    }
    missing_design_edges = [
        agent
        for agent in diagram_agents
        if (agent, "design_agent") not in graph_edges
    ]
    if (
        ("router", "planner_agent") not in graph_edges
        or ("planner_agent", "knowledge_agent") not in graph_edges
        or missing_design_edges
        or ("design_agent", "validator_agent") not in graph_edges
        or ("validator_agent", "repair_agent") not in graph_edges
        or ("repair_agent", "consistency_agent") not in graph_edges
        or ("consistency_agent", "export_agent") not in graph_edges
        or ("export_agent", "__end__") not in graph_edges
    ):
        print(
            "FAIL: graph topology missing Planner/Design/Validator/Consistency/Export Agent edges: "
            f"design={missing_design_edges} {graph_edges}"
        )
        return 1

    print(f"estimated_cost={degraded['estimated_cost']}")
    print("OK: runtime guard smoke passed")
    return 0


async def async_checks() -> int:
    permission_context = {
        "tenant_id": "runtime-smoke-async",
        "user_id": "runtime-user",
        "roles": ["member"],
        "scopes": ["diagram:read", "diagram:write"],
    }
    body = {"message": "生成销售报价流程图", "max_tokens": 512}

    reset_runtime_guard_state()
    first = await evaluate_runtime_request_async(
        body,
        permission_context,
        rate_limit_per_minute=1,
        rate_limit_backend="memory",
    )
    second = await evaluate_runtime_request_async(
        body,
        permission_context,
        rate_limit_per_minute=1,
        rate_limit_backend="memory",
    )
    if first["rate_limit_backend"] != "memory" or not first["allowed"]:
        print(f"FAIL: async memory rate limit should allow first request: {first}")
        return 1
    if second["allowed"] or second["reason"] != "rate_limited":
        print(f"FAIL: async memory rate limit should reject second request: {second}")
        return 1

    previous_fail_open = settings.RUNTIME_RATE_LIMIT_REDIS_FAIL_OPEN
    settings.RUNTIME_RATE_LIMIT_REDIS_FAIL_OPEN = True
    try:
        reset_runtime_guard_state()
        redis_or_fallback = await evaluate_runtime_request_async(
            body,
            {**permission_context, "tenant_id": f"runtime-smoke-redis-{uuid4().hex[:10]}"},
            rate_limit_per_minute=1,
            rate_limit_backend="redis",
        )
    finally:
        settings.RUNTIME_RATE_LIMIT_REDIS_FAIL_OPEN = previous_fail_open
    if not redis_or_fallback["allowed"]:
        print(f"FAIL: Redis fail-open guard should allow request: {redis_or_fallback}")
        return 1
    if redis_or_fallback["rate_limit_backend"] not in {"redis", "memory_fallback"}:
        print(f"FAIL: unexpected Redis guard backend marker: {redis_or_fallback}")
        return 1

    planner_output = await planner_agent_node(
        {
            "engine_type": "flow",
            "task_type": "flow",
            "permission_context": {
                "tenant_id": "runtime-smoke",
                "user_id": "runtime-user",
                "project_id": "runtime-project",
                "roles": ["member"],
                "scopes": ["knowledge:read", "export:basic"],
            },
            "messages": [HumanMessage(content="帮我生成一个销售报价流程图")],
            "memory_context": {},
        }
    )
    planner_plan = (planner_output.get("memory_context") or {}).get("planning") or {}
    planner_steps = planner_output.get("execution_plan") or []
    planner_step = next((step for step in planner_steps if step.get("id") == "planner"), {})
    if (
        planner_plan.get("status") != "ready"
        or planner_plan.get("knowledge_required") is not True
        or planner_step.get("status") != "succeeded"
        or not planner_output.get("audit_events")
        or not planner_output.get("tool_calls")
    ):
        print(f"FAIL: Planner Agent did not create an auditable plan: {planner_output}")
        return 1

    design_output = await design_agent_node(
        {
            "engine_type": "flow",
            "permission_context": {
                "tenant_id": "runtime-smoke",
                "user_id": "runtime-user",
                "project_id": "runtime-project",
            },
            "messages": [
                AIMessage(
                    content='<design_concept>ok</design_concept><code>{"nodes":[{"id":"1","data":{"label":"Start"}}],"edges":[{"id":"e1","source":"1","target":"2"}]}</code>'
                )
            ],
            "memory_context": {},
        }
    )
    design_context = (design_output.get("memory_context") or {}).get("design") or {}
    if (
        design_context.get("status") != "optimized"
        or not design_context.get("changed")
        or not design_context.get("designed_code")
        or not design_output.get("audit_events")
        or not design_output.get("tool_calls")
    ):
        print(f"FAIL: Design Agent should optimize flow styling: {design_output}")
        return 1

    export_state = {
        "engine_type": "mermaid",
        "task_type": "flowchart",
        "permission_context": {
            "tenant_id": "runtime-smoke",
            "user_id": "runtime-user",
            "project_id": "runtime-project",
            "roles": ["member"],
            "scopes": ["export:basic", "export:pdf"],
        },
        "memory_context": {},
    }
    export_output = await export_agent_node(export_state)
    export_plan = (export_output.get("memory_context") or {}).get("export") or {}
    allowed = {item.get("format") for item in export_plan.get("allowed_formats", [])}
    denied = {item.get("format") for item in export_plan.get("denied_formats", [])}
    if not {"json", "svg", "png", "pdf"}.issubset(allowed) or "pptx" not in denied:
        print(f"FAIL: Export Agent permission plan is incorrect: {export_plan}")
        return 1
    if not export_output.get("audit_events") or not export_output.get("tool_calls"):
        print(f"FAIL: Export Agent did not emit audit/tool records: {export_output}")
        return 1

    validator_output = await validator_agent_node(
        {
            "engine_type": "flow",
            "permission_context": export_state["permission_context"],
            "messages": [
                AIMessage(
                    content='<design_concept>ok</design_concept><code>{"nodes":[],"edges":[]}</code>'
                )
            ],
        }
    )
    validation = (validator_output.get("memory_context") or {}).get("validation", {}).get("result", {})
    if validation.get("ok") is not True or validation.get("engine_type") != "flow":
        print(f"FAIL: Validator Agent should pass valid flow output: {validator_output}")
        return 1
    invalid_output = await validator_agent_node(
        {
            "engine_type": "flow",
            "permission_context": export_state["permission_context"],
            "messages": [AIMessage(content="<code>{}</code>")],
        }
    )
    invalid_validation = (invalid_output.get("memory_context") or {}).get("validation", {}).get("result", {})
    if invalid_validation.get("ok") is not False or not invalid_output.get("validation_errors"):
        print(f"FAIL: Validator Agent should fail invalid flow output: {invalid_output}")
        return 1

    repair_output = await repair_agent_node(
        {
            "engine_type": "flow",
            "permission_context": export_state["permission_context"],
            "messages": [AIMessage(content="<code>{}</code>")],
            "memory_context": {},
            "validation_errors": [{"message": "missing nodes and edges"}],
        }
    )
    repair_context = (repair_output.get("memory_context") or {}).get("repair") or {}
    repaired_validation = (repair_output.get("memory_context") or {}).get("validation", {}).get("result", {})
    if (
        repair_context.get("status") != "repaired"
        or not repair_context.get("repaired_code")
        or repaired_validation.get("ok") is not True
        or repair_output.get("validation_errors")
        or not repair_output.get("audit_events")
        or not repair_output.get("tool_calls")
    ):
        print(f"FAIL: Repair Agent should repair missing flow arrays: {repair_output}")
        return 1

    consistency_output = await consistency_agent_node(
        {
            "engine_type": "flow",
            "permission_context": export_state["permission_context"],
            "messages": [
                AIMessage(
                    content='<code>{"nodes":[{"id":"1","data":{"label":"客户询价"}},{"id":"2","data":{"label":"生成报价单"}}],"edges":[]}</code>'
                )
            ],
            "memory_context": {
                "knowledge": {
                    "status": "retrieved",
                    "chunks": [
                        {
                            "chunk_id": "runtime-knowledge-1",
                            "text": "required_terms: 客户询价, 销售核价\nforbidden_terms: 私下折扣",
                            "citation": {"source_id": "source-1", "document_id": "doc-1"},
                            "metadata": {},
                        }
                    ],
                }
            },
        }
    )
    consistency = (consistency_output.get("memory_context") or {}).get("consistency") or {}
    if (
        consistency.get("status") != "needs_user_input"
        or "销售核价" not in consistency.get("missing_required_terms", [])
        or consistency_output.get("tool_calls", [{}])[0].get("status") != "needs_user_input"
        or not consistency_output.get("audit_events")
        or not consistency_output.get("validation_errors")
    ):
        print(f"FAIL: Consistency Agent should flag explicit knowledge conflicts: {consistency_output}")
        return 1

    return 0


if __name__ == "__main__":
    result = main()
    if result == 0:
        result = asyncio.run(async_checks())
    sys.exit(result)
