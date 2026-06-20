"""Consistency Agent for knowledge-grounded output checks."""

from app.agents.validator_agent import extract_final_code_from_state
from app.services.knowledge_consistency import check_knowledge_consistency
from app.state.state import AgentState


async def consistency_agent_node(state: AgentState) -> dict:
    """Check generated output against explicit constraints in retrieved knowledge."""

    memory_context = dict(state.get("memory_context", {}) or {})
    permission_context = state.get("permission_context", {}) or {}
    code = extract_final_code_from_state(state)
    knowledge = memory_context.get("knowledge") or {}
    result = check_knowledge_consistency(
        generated_code=code,
        knowledge_context=knowledge,
    )
    memory_context["consistency"] = {
        **result,
        "code_present": bool(code),
    }

    issue_messages = []
    for term in result["missing_required_terms"]:
        issue_messages.append(f"Missing required knowledge term: {term}")
    for term in result["forbidden_terms_present"]:
        issue_messages.append(f"Forbidden knowledge term is present: {term}")

    return {
        "memory_context": memory_context,
        "validation_errors": [
            {
                "code": "knowledge.consistency",
                "message": message,
                "severity": "warning",
                "repairable": False,
            }
            for message in issue_messages
        ],
        "audit_events": [
            {
                "type": "consistency.knowledge.checked",
                "actor_user_id": permission_context.get("user_id"),
                "tenant_id": permission_context.get("tenant_id"),
                "project_id": permission_context.get("project_id"),
                "message": result["note"],
                "metadata": {
                    "status": result["status"],
                    "ok": result["ok"],
                    "needs_user_input": result["needs_user_input"],
                    "checked_chunks": result["checked_chunks"],
                    "missing_required_terms": result["missing_required_terms"],
                    "forbidden_terms_present": result["forbidden_terms_present"],
                    "coverage_ratio": result["coverage_ratio"],
                    "citations": result["citations"],
                },
            }
        ],
        "tool_calls": [
            {
                "tool_name": "consistency.knowledge",
                "status": "succeeded" if result["ok"] else "needs_user_input",
                "input_summary": f"chunks={result['checked_chunks']}",
                "output_summary": result["status"],
            }
        ],
    }


def route_after_consistency(state: AgentState) -> str:
    """Stop before export when a knowledge conflict requires confirmation."""

    consistency = ((state.get("memory_context") or {}).get("consistency") or {})
    if consistency.get("needs_user_input"):
        return "needs_user_input"
    return "export_agent"
