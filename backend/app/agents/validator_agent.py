"""Validator Agent for deterministic diagram output checks."""

import re

from langchain_core.messages import AIMessage

from app.services.output_validation import validate_output
from app.state.state import AgentState


CODE_BLOCK_RE = re.compile(r"<code>(.*?)</code>", re.DOTALL | re.IGNORECASE)


def extract_final_code_from_state(state: AgentState) -> str:
    """Extract the latest diagram code emitted by a chart agent."""

    for message in reversed(list(state.get("messages", []))):
        if not isinstance(message, AIMessage):
            continue
        content = str(message.content or "")
        matches = CODE_BLOCK_RE.findall(content)
        if matches:
            return matches[-1].strip()
    return ""


async def validator_agent_node(state: AgentState) -> dict:
    """Validate the final generated diagram payload without calling an LLM."""

    engine = state.get("engine_type") or state.get("current_engine") or ""
    code = extract_final_code_from_state(state)
    validation = validate_output(engine, code)
    validation_event = {"type": "validation", **validation}
    memory_context = dict(state.get("memory_context", {}) or {})
    memory_context["validation"] = {
        "status": "passed" if validation["ok"] else "failed",
        "code_present": bool(code),
        "result": validation_event,
    }

    permission_context = state.get("permission_context", {}) or {}
    return {
        "memory_context": memory_context,
        "validation_errors": [
            {
                "code": "output.validation",
                "message": message,
                "severity": "error",
                "repairable": validation["repairable"],
            }
            for message in validation["errors"]
        ],
        "audit_events": [
            {
                "type": "validator.output.checked",
                "actor_user_id": permission_context.get("user_id"),
                "tenant_id": permission_context.get("tenant_id"),
                "project_id": permission_context.get("project_id"),
                "message": "Validator Agent checked generated diagram output.",
                "metadata": validation_event,
            }
        ],
        "tool_calls": [
            {
                "tool_name": "validator.output",
                "status": "succeeded" if validation["ok"] else "failed",
                "input_summary": f"engine={engine or 'unknown'}",
                "output_summary": "ok" if validation["ok"] else "; ".join(validation["errors"][:2]),
            }
        ],
    }
