"""Repair Agent for deterministic output correction after validation."""

from typing import Any

from langchain_core.messages import AIMessage

from app.agents.validator_agent import extract_final_code_from_state
from app.services.output_repair import repair_output
from app.state.state import AgentState


async def repair_agent_node(state: AgentState) -> dict:
    """Repair common output-structure issues without calling an LLM."""

    engine = state.get("engine_type") or state.get("current_engine") or ""
    code = extract_final_code_from_state(state)
    repair = repair_output(engine, code)
    memory_context = dict(state.get("memory_context", {}) or {})
    memory_context["repair"] = {
        "status": "repaired" if repair["repaired"] else ("passed" if repair["ok"] else "failed"),
        "engine_type": engine,
        "repaired": repair["repaired"],
        "applied_rules": repair["applied_rules"],
        "errors": repair["errors"],
        "validation": repair["validation"],
        "repaired_code": repair["content"] if repair["repaired"] else "",
        "note": (
            f"Repair Agent applied {len(repair['applied_rules'])} deterministic repair rules."
            if repair["repaired"]
            else "Repair Agent did not apply a deterministic repair."
        ),
    }
    if repair["repaired"]:
        memory_context["validation"] = {
            "status": "passed",
            "code_present": True,
            "result": {"type": "validation", **repair["validation"]},
            "source": "repair_agent",
        }

    permission_context = state.get("permission_context", {}) or {}
    result: dict[str, Any] = {
        "memory_context": memory_context,
        "validation_errors": [] if repair["repaired"] else state.get("validation_errors", []),
        "audit_events": [
            {
                "type": "repair.output.checked",
                "actor_user_id": permission_context.get("user_id"),
                "tenant_id": permission_context.get("tenant_id"),
                "project_id": permission_context.get("project_id"),
                "message": "Repair Agent evaluated deterministic output correction.",
                "metadata": {
                    "status": memory_context["repair"]["status"],
                    "engine_type": engine,
                    "repaired": repair["repaired"],
                    "applied_rules": repair["applied_rules"],
                    "validation": repair["validation"],
                    "errors": repair["errors"],
                },
            }
        ],
        "tool_calls": [
            {
                "tool_name": "repair.output",
                "status": "succeeded" if repair["ok"] else "failed",
                "input_summary": f"engine={engine or 'unknown'}",
                "output_summary": (
                    f"repaired=True, rules={len(repair['applied_rules'])}"
                    if repair["repaired"]
                    else "; ".join(repair["errors"][:2]) or "no repair needed"
                ),
            }
        ],
    }
    if repair["repaired"]:
        result["messages"] = [
            AIMessage(
                content=(
                    "<design_concept>"
                    "Repair Agent corrected deterministic output-structure issues."
                    "</design_concept>"
                    f"<code>{repair['content']}</code>"
                )
            )
        ]
    return result
