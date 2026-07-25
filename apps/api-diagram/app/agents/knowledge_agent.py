"""Knowledge Agent for permission-aware context retrieval."""

import asyncio

from langchain_core.messages import HumanMessage

from app.core.db import async_session
from app.core.llm import extract_text_content
from app.services.diagram_history_service import search_authorized_diagram_history
from app.services.diagram_template_service import select_best_artifact_template
from app.services.knowledge_retriever import retrieve_authorized_chunks_from_db
from app.services.permission_service import can_read_template
from app.state.state import AgentState


def _latest_user_query(state: AgentState) -> str:
    for message in reversed(list(state.get("messages", []))):
        if isinstance(message, HumanMessage):
            return extract_text_content(message.content).strip()
    return ""


async def knowledge_agent_node(state: AgentState) -> dict:
    """Prepare knowledge context for downstream chart agents."""

    permission_context = state.get("permission_context", {})
    memory_context = dict(state.get("memory_context", {}) or {})
    audit_events = list(state.get("audit_events", []) or [])
    query = _latest_user_query(state)

    async def _retrieve() -> tuple[list[dict], dict | None, list[dict]]:
        async with async_session() as session:
            chunks = await retrieve_authorized_chunks_from_db(
                session=session,
                query=query,
                permission_context=permission_context,
                top_k=5,
            )
            template = None
            if can_read_template(permission_context):
                template = await select_best_artifact_template(
                    session,
                    permission_context,
                    query=query,
                    engine_type=str(state.get("engine_type") or ""),
                    task_type=str(state.get("task_type") or ""),
                )
            historical_diagrams: list[dict] = []
            if "diagram:read" in permission_context.get("scopes", []):
                history = await search_authorized_diagram_history(
                    session,
                    permission_context,
                    query=query,
                    engine_type=str(state.get("engine_type") or ""),
                    task_type=str(state.get("task_type") or ""),
                    include_code=False,
                    limit=3,
                )
                historical_diagrams = history.get("diagrams", [])
            await session.commit()
            return chunks, template, historical_diagrams

    chunks: list[dict] = []
    template: dict | None = None
    historical_diagrams: list[dict] = []
    status = "no_authorized_context"
    note = "No authorized knowledge chunks matched this request."
    error = ""

    if query:
        try:
            chunks, template, historical_diagrams = await asyncio.wait_for(_retrieve(), timeout=2.0)
            context_parts = []
            if chunks:
                context_parts.append(f"{len(chunks)} authorized knowledge chunks")
            if template:
                context_parts.append("a governed template")
            if historical_diagrams:
                context_parts.append(f"{len(historical_diagrams)} historical diagrams")
            if context_parts:
                status = "retrieved"
                if template and chunks:
                    status = "retrieved_with_template"
                elif template:
                    status = "template_selected"
                elif historical_diagrams and not chunks:
                    status = "history_selected"
                note = "Retrieved " + ", ".join(context_parts) + "."
            elif chunks and template:
                status = "retrieved_with_template"
                note = f"Retrieved {len(chunks)} authorized knowledge chunks and selected a governed template."
            elif template:
                status = "template_selected"
                note = "Selected an authorized governed template for this request."
            elif chunks:
                status = "retrieved"
                note = f"Retrieved {len(chunks)} authorized knowledge chunks."
        except Exception as exc:
            status = "unavailable"
            error = str(exc)
            note = "Knowledge retrieval was skipped because the database or retriever is unavailable."

    citations = [chunk.get("citation", {}) for chunk in chunks]
    security_summaries = [
        (chunk.get("metadata") or {}).get("security_scan", {})
        for chunk in chunks
    ]
    memory_context["knowledge"] = {
        "status": status,
        "query": query,
        "chunks": chunks,
        "citations": citations,
        "tenant_id": permission_context.get("tenant_id"),
        "project_id": permission_context.get("project_id"),
        "note": note,
    }
    if historical_diagrams:
        memory_context["knowledge"]["historical_diagrams"] = historical_diagrams
    if template:
        memory_context["knowledge"]["selected_template"] = template
    if error:
        memory_context["knowledge"]["error"] = error

    audit_events.append(
        {
            "type": "knowledge.retrieve",
            "actor_user_id": permission_context.get("user_id"),
            "tenant_id": permission_context.get("tenant_id"),
            "project_id": permission_context.get("project_id"),
            "message": note,
            "metadata": {
                "status": status,
                "chunk_ids": [chunk.get("chunk_id") for chunk in chunks],
                "citations": citations,
                "selected_template_id": template.get("template_id") if template else None,
                "selected_template_name": template.get("name") if template else None,
                "historical_diagram_ids": [item.get("diagram_id") for item in historical_diagrams],
                "security_scans": security_summaries,
            },
        }
    )
    return {"memory_context": memory_context, "audit_events": audit_events}
