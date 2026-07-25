"""Smoke test the enterprise diagram persistence and export loop.

Usage:
  uv run python scripts/smoke_enterprise_flow.py
  uv run python scripts/smoke_enterprise_flow.py --require-db

The default mode skips cleanly when PostgreSQL is unavailable. Use
`--require-db` in CI or local verification when the database must be running.
"""

import argparse
import asyncio
import sys
from datetime import timedelta
from uuid import uuid4
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from langchain_core.messages import AIMessage, HumanMessage
from sqlalchemy import select
from sqlalchemy import text

from app.agents.design_agent import design_agent_node
from app.agents.knowledge_agent import knowledge_agent_node
from app.core.db import async_session, init_db
from app.main import app
from app.models.conversation import Conversation
from app.models.common import utc_now
from app.models.export import ExportAsset, ExportPresignedURL
from app.services.export_job_service import run_pending_export_jobs_once
from app.services.object_storage import S3CompatibleObjectStorage
from app.services.audit_service import (
    create_agent_run_id,
    persist_agent_run_finish,
    persist_agent_run_start,
)
from app.services.diagram_persistence_service import (
    create_conversation_id,
    persist_generated_diagram,
)
from app.services.conversation_memory_service import (
    format_conversation_memory_for_prompt,
    load_conversation_memory,
)
from app.services.long_term_memory_service import (
    format_long_term_preferences_for_prompt,
    load_long_term_preferences,
)

PERMISSION_CONTEXT = {
    "tenant_id": "local",
    "user_id": "smoke-owner",
    "team_id": "smoke-team",
    "project_id": "smoke-project",
    "roles": ["owner"],
    "scopes": [
        "diagram:read",
        "diagram:write",
        "tool:diagram",
        "knowledge:read",
        "preference:read",
        "preference:write",
        "export:basic",
        "export:pdf",
        "export:pptx",
        "audit:read",
        "approval:read",
        "approval:write",
    ],
    "allowed_knowledge_scopes": ["knowledge:read"],
}

FLOW_CODE = """{
  "nodes": [
    {"id": "1", "position": {"x": 0, "y": 0}, "data": {"label": "客户询价"}},
    {"id": "2", "position": {"x": 0, "y": 0}, "data": {"label": "销售核价"}},
    {"id": "3", "position": {"x": 0, "y": 0}, "data": {"label": "经理审批"}},
    {"id": "4", "position": {"x": 0, "y": 0}, "data": {"label": "生成报价单"}}
  ],
  "edges": [
    {"id": "e1-2", "source": "1", "target": "2"},
    {"id": "e2-3", "source": "2", "target": "3"},
    {"id": "e3-4", "source": "3", "target": "4"}
  ]
}"""


async def database_available() -> bool:
    try:
        async with async_session() as session:
            await session.execute(text("select 1"))
        return True
    except Exception as exc:
        print(f"SKIP: database unavailable: {exc}")
        return False


async def run_smoke(require_db: bool) -> int:
    if not await database_available():
        return 1 if require_db else 0

    await init_db()
    permission_context = {
        **PERMISSION_CONTEXT,
        "tenant_id": f"tenant-{uuid4().hex[:10]}",
        "user_id": f"smoke-owner-{uuid4().hex[:10]}",
        "team_id": f"team-{uuid4().hex[:10]}",
        "project_id": f"project-{uuid4().hex[:10]}",
    }
    conversation_id = create_conversation_id()
    run_id = create_agent_run_id()
    token_usage = {
        "estimated_input_tokens": 120,
        "estimated_output_tokens": 512,
        "estimated_total_tokens": 632,
    }
    await persist_agent_run_start(
        run_id=run_id,
        permission_context=permission_context,
        model_config={"model_id": "smoke-model"},
        conversation_id=conversation_id,
        token_usage=token_usage,
        cost_estimate=0.0012,
    )
    persisted = await persist_generated_diagram(
        permission_context=permission_context,
        conversation_id=conversation_id,
        user_message="生成销售报价流程图",
        assistant_content="已生成销售报价流程图。",
        diagram_code=FLOW_CODE,
        design_concept="销售报价流程需要覆盖询价、核价、审批和报价单生成。",
        task_type="flowchart",
        engine_type="flow",
        validation_events=[{"ok": True, "engine_type": "flow", "errors": [], "warnings": []}],
        run_id=run_id,
    )
    if not persisted or not persisted["persisted"]:
        print(f"FAIL: diagram persistence failed: {persisted}")
        return 1

    diagram_id = persisted["diagram_id"]
    version_id = persisted["diagram_version_id"]
    print(f"diagram_id={diagram_id}")
    print(f"diagram_version_id={version_id}")

    trace_start = utc_now()
    await persist_agent_run_finish(
        run_id=run_id,
        permission_context=permission_context,
        status="succeeded",
        task_type="flowchart",
        engine_type="flow",
        execution_plan=[
            {
                "id": "router",
                "label": "识别用户意图和图表类型",
                "agent": "router",
                "phase": "routing",
                "status": "succeeded",
            },
            {
                "id": "planner",
                "label": "拆解图表生成任务",
                "agent": "planner",
                "phase": "planning",
                "status": "succeeded",
            },
            {
                "id": "chart",
                "label": "生成 React Flow 图表",
                "agent": "flow",
                "phase": "generating_draft",
                "status": "succeeded",
                "metadata": {"engine_type": "flow"},
            },
            {
                "id": "validator",
                "label": "校验图表结构",
                "agent": "validator",
                "phase": "validating",
                "status": "succeeded",
            },
        ],
        validation_events=[],
        audit_events=[
            {
                "type": "runtime.guard.evaluated",
                "actor_user_id": permission_context["user_id"],
                "tenant_id": permission_context["tenant_id"],
                "project_id": permission_context["project_id"],
                "message": "Smoke runtime cost persisted.",
                "metadata": {"estimated_cost": 0.0012},
            }
        ],
        tool_calls=[
            {
                "tool_name": "planner.default_plan",
                "status": "succeeded",
                "input_summary": "sales quote flowchart",
                "output_summary": "4-step execution plan",
            }
        ],
        error_message="",
        conversation_id=conversation_id,
        token_usage={**token_usage, "stream_event_count": 6},
        cost_estimate=0.0012,
        trace_spans=[
            {
                "trace_id": "smoke-trace",
                "span_id": "smoke-router",
                "name": "router",
                "span_type": "chain",
                "status": "succeeded",
                "duration_ms": 8.0,
                "started_at": trace_start.isoformat(),
                "ended_at": (trace_start + timedelta(milliseconds=8)).isoformat(),
                "attributes": {},
            },
            {
                "trace_id": "smoke-trace",
                "span_id": "smoke-planner",
                "name": "planner_agent",
                "span_type": "chain",
                "status": "succeeded",
                "duration_ms": 12.0,
                "started_at": (trace_start + timedelta(milliseconds=8)).isoformat(),
                "ended_at": (trace_start + timedelta(milliseconds=20)).isoformat(),
                "attributes": {},
            },
            {
                "trace_id": "smoke-trace",
                "span_id": "smoke-flow",
                "name": "flow_agent",
                "span_type": "chain",
                "status": "succeeded",
                "duration_ms": 28.0,
                "started_at": (trace_start + timedelta(milliseconds=20)).isoformat(),
                "ended_at": (trace_start + timedelta(milliseconds=48)).isoformat(),
                "attributes": {},
            },
            {
                "trace_id": "smoke-trace",
                "span_id": "smoke-validator",
                "name": "validator_agent",
                "span_type": "chain",
                "status": "succeeded",
                "duration_ms": 5.0,
                "started_at": (trace_start + timedelta(milliseconds=48)).isoformat(),
                "ended_at": (trace_start + timedelta(milliseconds=53)).isoformat(),
                "attributes": {},
            },
        ],
    )

    updated_code = FLOW_CODE.replace("经理审批", "财务审批")
    persisted_v2 = await persist_generated_diagram(
        permission_context=permission_context,
        conversation_id=conversation_id,
        user_message="把审批节点改成财务审批",
        assistant_content="已生成销售报价流程图的财务审批版本。",
        diagram_code=updated_code,
        design_concept="销售报价流程更新为财务审批。",
        task_type="flowchart",
        engine_type="flow",
        validation_events=[{"ok": True, "engine_type": "flow", "errors": [], "warnings": []}],
        diagram_id=diagram_id,
    )
    if not persisted_v2 or not persisted_v2["persisted"] or persisted_v2["version_number"] <= 1:
        print(f"FAIL: second diagram version persistence failed: {persisted_v2}")
        return 1

    async with async_session() as session:
        conversation = await session.get(Conversation, conversation_id)
        if not conversation or not conversation.summary:
            print(f"FAIL: conversation summary was not persisted: {conversation}")
            return 1
        short_term_memory = (conversation.context_json or {}).get("short_term_memory") or {}
        if (
            short_term_memory.get("turn_count", 0) < 2
            or short_term_memory.get("current_diagram_version_id") != persisted_v2["diagram_version_id"]
            or "财务审批" not in short_term_memory.get("last_user_message", "")
        ):
            print(f"FAIL: short-term memory snapshot invalid: {short_term_memory}")
            return 1
        conversation_memory = await load_conversation_memory(
            session,
            permission_context=permission_context,
            conversation_id=conversation_id,
        )
        memory_prompt = format_conversation_memory_for_prompt(conversation_memory)
    if (
        conversation_memory.get("status") != "loaded"
        or len(conversation_memory.get("recent_messages") or []) < 4
        or persisted_v2["diagram_version_id"] not in memory_prompt
        or "SHORT-TERM CONVERSATION MEMORY" not in memory_prompt
    ):
        print(f"FAIL: conversation memory load/prompt invalid: {conversation_memory} prompt={memory_prompt}")
        return 1

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        conversation_history_res = await client.get(
            "/api/conversations/history",
            params={
                "project_id": permission_context["project_id"],
                "query": "财务审批",
                "include_messages": "true",
                "include_current_diagram": "true",
                "limit": "5",
            },
            headers=_headers(permission_context),
        )
        if conversation_history_res.status_code != 200:
            print(
                "FAIL: conversation history returned "
                f"{conversation_history_res.status_code}: {conversation_history_res.text}"
            )
            return 1
        conversation_history = conversation_history_res.json()
        matching_conversations = [
            item
            for item in conversation_history.get("conversations", [])
            if item.get("conversation_id") == conversation_id
        ]
        if (
            not matching_conversations
            or matching_conversations[0].get("current_diagram_version_id") != persisted_v2["diagram_version_id"]
            or matching_conversations[0].get("message_count", 0) < 4
        ):
            print(f"FAIL: conversation history payload invalid: {conversation_history}")
            return 1
        current_diagram = matching_conversations[0].get("current_diagram") or {}
        if (
            current_diagram.get("diagram_id") != diagram_id
            or current_diagram.get("diagram_version_id") != persisted_v2["diagram_version_id"]
            or current_diagram.get("code") != updated_code
            or current_diagram.get("engine_type") != "flow"
            or current_diagram.get("task_type") != "flowchart"
        ):
            print(f"FAIL: conversation history missing current diagram snapshot: {current_diagram}")
            return 1
        history_messages = matching_conversations[0].get("messages") or []
        assistant_processes = [
            message.get("agent_process")
            for message in history_messages
            if message.get("role") == "assistant" and message.get("agent_process")
        ]
        if (
            not assistant_processes
            or assistant_processes[0].get("run_id") != run_id
            or assistant_processes[0].get("duration_ms", 0) <= 0
            or assistant_processes[0].get("step_count", 0) < 4
        ):
            print(f"FAIL: conversation history missing Agent process details: {history_messages}")
            return 1

        preference_payload = {
            "scope": "user",
            "preferences": {
                "style": {"palette": ["#0f766e", "#f59e0b"], "density": "compact"},
                "flow": {
                    "edge_color": "#0f766e",
                    "edge_width": 3,
                    "node_border_radius": 6,
                },
            },
            **permission_context,
        }
        preference_res = await client.patch("/api/preferences/diagram", json=preference_payload)
        if preference_res.status_code != 200:
            print(f"FAIL: preference update returned {preference_res.status_code}: {preference_res.text}")
            return 1
        preference_update = preference_res.json()
        merged_preferences = (preference_update.get("merged") or {}).get("preferences") or {}
        if (
            merged_preferences.get("flow", {}).get("edge_color") != "#0f766e"
            or merged_preferences.get("style", {}).get("density") != "compact"
        ):
            print(f"FAIL: preference merge invalid: {preference_update}")
            return 1

        project_preference_res = await client.patch(
            "/api/preferences/artifact",
            json={
                "scope": "project",
                "preferences": {
                    "flow": {
                        "edge_color": "#7c3aed",
                        "edge_width": 5,
                    },
                    "notes": "项目级风格包覆盖个人默认连线样式。",
                },
                **permission_context,
            },
        )
        if project_preference_res.status_code != 200:
            print(
                "FAIL: project preference update returned "
                f"{project_preference_res.status_code}: {project_preference_res.text}"
            )
            return 1
        project_preference_update = project_preference_res.json()
        project_preferences = (project_preference_update.get("merged") or {}).get("preferences") or {}
        project_sources = (project_preference_update.get("merged") or {}).get("sources") or {}
        if (
            project_preferences.get("flow", {}).get("edge_color") != "#7c3aed"
            or project_preferences.get("flow", {}).get("edge_width") != 5
            or project_preferences.get("style", {}).get("density") != "compact"
            or not project_sources.get("project")
        ):
            print(f"FAIL: project preference override invalid: {project_preference_update}")
            return 1

        preference_get_res = await client.get(
            "/api/preferences/artifact",
            headers=_headers(permission_context),
        )
        if preference_get_res.status_code != 200:
            print(f"FAIL: preference get returned {preference_get_res.status_code}: {preference_get_res.text}")
            return 1
        preference_memory = preference_get_res.json()
        preference_prompt = format_long_term_preferences_for_prompt(preference_memory)
        if (
            preference_memory.get("status") != "loaded"
            or "AUTHORIZED LONG-TERM ARTIFACT PREFERENCES" not in preference_prompt
            or "#7c3aed" not in preference_prompt
            or "project" not in preference_prompt
        ):
            print(f"FAIL: preference memory prompt invalid: {preference_memory} prompt={preference_prompt}")
            return 1

        async with async_session() as session:
            direct_preferences = await load_long_term_preferences(session, permission_context)
        design_result = await design_agent_node(
            {
                "messages": [AIMessage(content=f"<code>{FLOW_CODE}</code>")],
                "engine_type": "flow",
                "memory_context": {"long_term_preferences": direct_preferences},
                "permission_context": permission_context,
            }
        )
        designed_code = (design_result.get("memory_context") or {}).get("design", {}).get("designed_code", "")
        if '"stroke":"#7c3aed"' not in designed_code or '"strokeWidth":5' not in designed_code:
            print(f"FAIL: Design Agent did not apply long-term flow preferences: {design_result}")
            return 1

        denied_preference = await client.patch(
            "/api/preferences/diagram",
            json={
                "scope": "user",
                "preferences": {"flow": {"edge_color": "#dc2626"}},
                **{**permission_context, "scopes": ["preference:read"]},
            },
        )
        if denied_preference.status_code != 403:
            print(f"FAIL: preference write without scope returned {denied_preference.status_code}")
            return 1

        denied_project_preference = await client.patch(
            "/api/preferences/diagram",
            json={
                "scope": "project",
                "preferences": {"flow": {"edge_color": "#dc2626"}},
                **{
                    **permission_context,
                    "user_id": f"outsider-{uuid4().hex[:8]}",
                    "roles": ["member"],
                    "scopes": ["preference:read", "preference:write"],
                },
            },
        )
        if denied_project_preference.status_code != 403:
            print(f"FAIL: project preference write without project access returned {denied_project_preference.status_code}")
            return 1

        branch_res = await client.post(
            f"/api/diagrams/{diagram_id}/versions/{version_id}/branch",
            json={
                "branch_name": "报价流程备选分支",
                "reason": "用户目标变化，保留原版本并开新分支",
                **permission_context,
            },
        )
        if branch_res.status_code != 200:
            print(f"FAIL: branch create returned {branch_res.status_code}: {branch_res.text}")
            return 1
        branch = branch_res.json()
        if not branch.get("branched") or branch.get("diagram_id") == diagram_id or branch.get("code") != FLOW_CODE:
            print(f"FAIL: branch payload invalid: {branch}")
            return 1

        rollback_res = await client.post(
            f"/api/diagrams/{diagram_id}/versions/{version_id}/rollback",
            json={"reason": "用户回到原销售报价流程", **permission_context},
        )
        if rollback_res.status_code != 200:
            print(f"FAIL: rollback returned {rollback_res.status_code}: {rollback_res.text}")
            return 1
        rollback = rollback_res.json()
        if (
            not rollback.get("rolled_back")
            or rollback.get("source_version_id") != version_id
            or rollback.get("code") != FLOW_CODE
            or rollback.get("version_number", 0) <= persisted_v2["version_number"]
        ):
            print(f"FAIL: rollback payload invalid: {rollback}")
            return 1
        version_id = rollback["diagram_version_id"]

        versions_res = await client.get(
            f"/api/diagrams/{diagram_id}/versions",
            headers=_headers(permission_context),
        )
        if versions_res.status_code != 200:
            print(f"FAIL: diagram versions returned {versions_res.status_code}: {versions_res.text}")
            return 1
        versions = versions_res.json()
        if versions.get("current_version_id") != version_id or len(versions.get("versions", [])) < 3:
            print(f"FAIL: diagram version list did not reflect rollback: {versions}")
            return 1

        history_res = await client.get(
            "/api/diagrams/history",
            params={
                "query": "报价",
                "engine_type": "flow",
                "include_code": "true",
                "limit": 10,
            },
            headers=_headers(permission_context),
        )
        if history_res.status_code != 200:
            print(f"FAIL: diagram history returned {history_res.status_code}: {history_res.text}")
            return 1
        history = history_res.json()
        matching_history = [
            item
            for item in history.get("diagrams", [])
            if item.get("diagram_id") == diagram_id
        ]
        if (
            not matching_history
            or matching_history[0].get("current_version", {}).get("diagram_version_id") != version_id
            or "生成销售报价流程图" not in matching_history[0].get("title", "")
            or "客户询价" not in matching_history[0].get("current_version", {}).get("code", "")
        ):
            print(f"FAIL: diagram history payload invalid: {history}")
            return 1
        history_process = (matching_history[0].get("current_version") or {}).get("agent_process") or {}
        if (
            not history_process
            or history_process.get("run_id") != run_id
            or history_process.get("duration_ms", 0) <= 0
            or history_process.get("step_count", 0) < 4
            or not any(step.get("id") == "planner" for step in history_process.get("steps", []))
            or history_process.get("token_usage", {}).get("estimated_total_tokens") != token_usage["estimated_total_tokens"]
        ):
            print(f"FAIL: diagram history did not include Agent process details: {history_process}")
            return 1

        knowledge_result = await knowledge_agent_node(
            {
                "messages": [HumanMessage(content="参考历史图表，生成销售报价流程图")],
                "engine_type": "flow",
                "task_type": "flowchart",
                "permission_context": permission_context,
                "memory_context": {},
                "audit_events": [],
            }
        )
        knowledge_memory = (knowledge_result.get("memory_context") or {}).get("knowledge") or {}
        historical_diagrams = knowledge_memory.get("historical_diagrams") or []
        if (
            not historical_diagrams
            or not any(item.get("diagram_id") == diagram_id for item in historical_diagrams)
            or knowledge_memory.get("status") not in {"history_selected", "retrieved"}
        ):
            print(f"FAIL: Knowledge Agent did not retrieve historical diagrams: {knowledge_result}")
            return 1

        diff_res = await client.get(
            f"/api/diagrams/{diagram_id}/versions/{persisted_v2['diagram_version_id']}/diff",
            params={"target_version_id": version_id},
            headers=_headers(permission_context),
        )
        if diff_res.status_code != 200:
            print(f"FAIL: diagram version diff returned {diff_res.status_code}: {diff_res.text}")
            return 1
        diff = diff_res.json()
        diff_summary = diff.get("summary") or {}
        diff_preview = diff.get("preview") or {}
        if (
            not diff_summary.get("changed")
            or diff_summary.get("removed_line_count", 0) < 1
            or diff_summary.get("added_line_count", 0) < 1
            or not any("财务审批" in line for line in diff_preview.get("removed_lines", []))
            or not any("经理审批" in line for line in diff_preview.get("added_lines", []))
        ):
            print(f"FAIL: diagram version diff did not capture rollback changes: {diff}")
            return 1

        approval_create_res = await client.post(
            "/api/approvals",
            json={
                "approval_type": "knowledge_consistency",
                "reason": "Smoke approval required for knowledge conflict.",
                "resource": {
                    "diagram_id": diagram_id,
                    "diagram_version_id": version_id,
                    "conflict": {"missing_required_terms": ["销售核价"]},
                },
                **permission_context,
            },
        )
        if approval_create_res.status_code != 200:
            print(f"FAIL: approval create returned {approval_create_res.status_code}: {approval_create_res.text}")
            return 1
        approval = approval_create_res.json()
        if approval.get("status") != "pending" or not approval.get("approval_id"):
            print(f"FAIL: approval payload invalid: {approval}")
            return 1
        approval_res = await client.get(
            f"/api/approvals/{approval['approval_id']}",
            headers=_headers(permission_context),
        )
        if approval_res.status_code != 200:
            print(f"FAIL: approval get returned {approval_res.status_code}: {approval_res.text}")
            return 1
        approval_decision_res = await client.post(
            f"/api/approvals/{approval['approval_id']}/decision",
            json={"decision": "approved", "comment": "smoke approval accepted", **permission_context},
        )
        if approval_decision_res.status_code != 200 or approval_decision_res.json().get("status") != "approved":
            print(
                "FAIL: approval decision returned "
                f"{approval_decision_res.status_code}: {approval_decision_res.text}"
            )
            return 1

        created_jobs = []
        presigned_url_ids = []
        asset_ids = []
        confirmation_required_count = 0
        for export_format in ["json", "svg", "png", "pdf", "pptx"]:
            export_payload = {"format": export_format, **permission_context}
            if export_format in {"pdf", "pptx"}:
                unconfirmed_res = await client.post(
                    f"/api/diagrams/{diagram_id}/versions/{version_id}/exports",
                    json=export_payload,
                )
                if unconfirmed_res.status_code != 409:
                    print(
                        "FAIL: "
                        f"{export_format} unconfirmed export returned {unconfirmed_res.status_code}: "
                        f"{unconfirmed_res.text}"
                    )
                    return 1
                confirmation_detail = unconfirmed_res.json().get("detail", {})
                if not confirmation_detail.get("required_confirmation"):
                    print(f"FAIL: {export_format} confirmation response malformed: {confirmation_detail}")
                    return 1
                confirmation_required_count += 1
                export_payload = {
                    **export_payload,
                    "confirmed": True,
                    "confirmation_reason": "smoke_human_confirmation",
                }

            create_res = await client.post(
                f"/api/diagrams/{diagram_id}/versions/{version_id}/exports",
                json=export_payload,
            )
            if create_res.status_code != 200:
                print(f"FAIL: {export_format} export create returned {create_res.status_code}: {create_res.text}")
                return 1
            job = create_res.json()
            created_jobs.append(job)
            if job.get("status") != "completed" or not job.get("asset_id"):
                print(f"FAIL: {export_format} export did not complete: {job}")
                return 1
            asset_ids.append(job["asset_id"])

            url_res = await client.get(
                f"/api/export-assets/{job['asset_id']}/download-url",
                headers=_headers(permission_context),
            )
            if url_res.status_code != 200:
                print(f"FAIL: {export_format} download-url returned {url_res.status_code}: {url_res.text}")
                return 1
            download_url = url_res.json()
            if not download_url.get("presigned_url_id") or not download_url.get("expires_at"):
                print(f"FAIL: {export_format} download-url missing persistence metadata: {download_url}")
                return 1
            presigned_url_ids.append(download_url["presigned_url_id"])

            download_res = await client.get(
                f"/api/export-assets/{job['asset_id']}/download",
                headers=_headers(permission_context),
            )
            if download_res.status_code != 200 or not download_res.content:
                print(f"FAIL: {export_format} download returned {download_res.status_code}")
                return 1
            print(f"{export_format}: {len(download_res.content)} bytes")

        async_export_res = await client.post(
            f"/api/diagrams/{diagram_id}/versions/{version_id}/exports",
            json={"format": "json", "mode": "async", **permission_context},
        )
        if async_export_res.status_code != 200:
            print(f"FAIL: async export create returned {async_export_res.status_code}: {async_export_res.text}")
            return 1
        async_export = async_export_res.json()
        if async_export.get("mode") != "async" or async_export.get("status") not in {"queued", "running", "completed"}:
            print(f"FAIL: async export did not queue correctly: {async_export}")
            return 1

        async_job = {}
        for _ in range(10):
            async_job_res = await client.get(
                f"/api/export-jobs/{async_export['job_id']}",
                headers=_headers(permission_context),
            )
            if async_job_res.status_code != 200:
                print(f"FAIL: async export job lookup returned {async_job_res.status_code}: {async_job_res.text}")
                return 1
            async_job = async_job_res.json()
            if async_job.get("status") in {"completed", "failed"}:
                break
            await asyncio.sleep(0.1)
        if async_job.get("status") != "completed" or not async_job.get("result_asset_id"):
            print(f"FAIL: async export did not complete: {async_job}")
            return 1

        queued_export_res = await client.post(
            f"/api/diagrams/{diagram_id}/versions/{version_id}/exports",
            json={"format": "svg", "mode": "queued", **permission_context},
        )
        if queued_export_res.status_code != 200:
            print(f"FAIL: queued export create returned {queued_export_res.status_code}: {queued_export_res.text}")
            return 1
        queued_export = queued_export_res.json()
        if queued_export.get("mode") != "queued" or queued_export.get("status") != "queued":
            print(f"FAIL: queued export should remain queued before worker: {queued_export}")
            return 1

        queued_worker_summary = await run_pending_export_jobs_once(limit=25)
        queued_jobs = [
            job
            for job in queued_worker_summary.get("jobs", [])
            if job.get("job_id") == queued_export["job_id"]
        ]
        if not queued_jobs or queued_jobs[0].get("status") != "completed":
            print(f"FAIL: queued export worker did not complete job: {queued_worker_summary}")
            return 1
        queued_job_res = await client.get(
            f"/api/export-jobs/{queued_export['job_id']}",
            headers=_headers(permission_context),
        )
        if queued_job_res.status_code != 200:
            print(f"FAIL: queued export job lookup returned {queued_job_res.status_code}: {queued_job_res.text}")
            return 1
        queued_job = queued_job_res.json()
        if queued_job.get("status") != "completed" or not queued_job.get("result_asset_id"):
            print(f"FAIL: queued export did not complete after worker: {queued_job}")
            return 1
        asset_ids.append(queued_job["result_asset_id"])

        outsider_context = {
            **permission_context,
            "user_id": "outsider-user",
            "roles": ["viewer"],
            "scopes": ["diagram:read", "export:basic"],
        }
        denied_export = await client.post(
            f"/api/diagrams/{diagram_id}/versions/{version_id}/exports",
            json={"format": "json", **outsider_context},
        )
        if denied_export.status_code != 403:
            print(f"FAIL: project outsider export returned {denied_export.status_code}: {denied_export.text}")
            return 1

        denied_branch = await client.post(
            f"/api/diagrams/{diagram_id}/versions/{version_id}/branch",
            json={"branch_name": "forbidden", **outsider_context},
        )
        if denied_branch.status_code != 403:
            print(f"FAIL: project outsider branch returned {denied_branch.status_code}: {denied_branch.text}")
            return 1
        denied_diff = await client.get(
            f"/api/diagrams/{diagram_id}/versions/{version_id}/diff",
            headers=_headers(outsider_context),
        )
        if denied_diff.status_code != 403:
            print(f"FAIL: project outsider diff returned {denied_diff.status_code}: {denied_diff.text}")
            return 1
        denied_history = await client.get(
            "/api/diagrams/history",
            params={"project_id": permission_context["project_id"]},
            headers=_headers(outsider_context),
        )
        if denied_history.status_code != 403:
            print(f"FAIL: project outsider history returned {denied_history.status_code}: {denied_history.text}")
            return 1
        denied_conversation_history = await client.get(
            "/api/conversations/history",
            params={
                "project_id": permission_context["project_id"],
                "include_messages": "true",
                "include_current_diagram": "true",
            },
            headers=_headers(outsider_context),
        )
        if denied_conversation_history.status_code != 403:
            print(
                "FAIL: project outsider conversation history returned "
                f"{denied_conversation_history.status_code}: {denied_conversation_history.text}"
            )
            return 1
        denied_approval = await client.post(
            f"/api/approvals/{approval['approval_id']}/decision",
            json={"decision": "rejected", **outsider_context},
        )
        if denied_approval.status_code != 403:
            print(f"FAIL: project outsider approval decision returned {denied_approval.status_code}: {denied_approval.text}")
            return 1

        audit_res = await client.get(
            "/api/audit/events",
            params={
                "tenant_id": permission_context["tenant_id"],
                "user_id": permission_context["user_id"],
                "team_id": permission_context["team_id"],
                "project_id": permission_context["project_id"],
                "roles": ",".join(permission_context["roles"]),
                "scopes": ",".join(permission_context["scopes"]),
                "event_type": "export.created",
            },
        )
        if audit_res.status_code != 200 or not audit_res.json().get("events"):
            print(f"FAIL: audit query returned {audit_res.status_code}: {audit_res.text}")
            return 1

        confirmation_audit_res = await client.get(
            "/api/audit/events",
            params={
                "tenant_id": permission_context["tenant_id"],
                "user_id": permission_context["user_id"],
                "team_id": permission_context["team_id"],
                "project_id": permission_context["project_id"],
                "roles": ",".join(permission_context["roles"]),
                "scopes": ",".join(permission_context["scopes"]),
                "event_type": "export.confirmation.required",
            },
        )
        confirmation_events = confirmation_audit_res.json().get("events", []) if confirmation_audit_res.status_code == 200 else []
        if len(confirmation_events) < confirmation_required_count:
            print(
                "FAIL: export confirmation audit records missing: "
                f"{confirmation_audit_res.status_code} {confirmation_audit_res.text}"
            )
            return 1

        branch_audit_res = await client.get(
            "/api/audit/events",
            params={
                "tenant_id": permission_context["tenant_id"],
                "user_id": permission_context["user_id"],
                "team_id": permission_context["team_id"],
                "project_id": permission_context["project_id"],
                "roles": ",".join(permission_context["roles"]),
                "scopes": ",".join(permission_context["scopes"]),
                "event_type": "diagram.branch.created",
            },
        )
        rollback_audit_res = await client.get(
            "/api/audit/events",
            params={
                "tenant_id": permission_context["tenant_id"],
                "user_id": permission_context["user_id"],
                "team_id": permission_context["team_id"],
                "project_id": permission_context["project_id"],
                "roles": ",".join(permission_context["roles"]),
                "scopes": ",".join(permission_context["scopes"]),
                "event_type": "diagram.version.rollback",
            },
        )
        diff_audit_res = await client.get(
            "/api/audit/events",
            params={
                "tenant_id": permission_context["tenant_id"],
                "user_id": permission_context["user_id"],
                "team_id": permission_context["team_id"],
                "project_id": permission_context["project_id"],
                "roles": ",".join(permission_context["roles"]),
                "scopes": ",".join(permission_context["scopes"]),
                "event_type": "diagram.version.diff.viewed",
            },
        )
        if (
            branch_audit_res.status_code != 200
            or not branch_audit_res.json().get("events")
            or rollback_audit_res.status_code != 200
            or not rollback_audit_res.json().get("events")
            or diff_audit_res.status_code != 200
            or not diff_audit_res.json().get("events")
        ):
            print(
                "FAIL: branch/rollback/diff audit records missing: "
                f"branch={branch_audit_res.status_code} {branch_audit_res.text} "
                f"rollback={rollback_audit_res.status_code} {rollback_audit_res.text} "
                f"diff={diff_audit_res.status_code} {diff_audit_res.text}"
            )
            return 1

        approval_audit_res = await client.get(
            "/api/audit/events",
            params={
                "tenant_id": permission_context["tenant_id"],
                "user_id": permission_context["user_id"],
                "team_id": permission_context["team_id"],
                "project_id": permission_context["project_id"],
                "roles": ",".join(permission_context["roles"]),
                "scopes": ",".join(permission_context["scopes"]),
                "event_type": "human.approval.decided",
            },
        )
        if approval_audit_res.status_code != 200 or not approval_audit_res.json().get("events"):
            print(f"FAIL: approval audit records missing: {approval_audit_res.status_code} {approval_audit_res.text}")
            return 1

        metrics_res = await client.get(
            "/api/audit/metrics",
            params={
                "tenant_id": permission_context["tenant_id"],
                "user_id": permission_context["user_id"],
                "team_id": permission_context["team_id"],
                "project_id": permission_context["project_id"],
                "roles": ",".join(permission_context["roles"]),
                "scopes": ",".join(permission_context["scopes"]),
            },
        )
        if metrics_res.status_code != 200:
            print(f"FAIL: audit metrics returned {metrics_res.status_code}: {metrics_res.text}")
            return 1
        metrics = metrics_res.json()
        if metrics.get("agent_runs", {}).get("estimated_cost", 0) <= 0:
            print(f"FAIL: audit metrics did not include estimated cost: {metrics}")
            return 1

        denied_audit = await client.get(
            "/api/audit/events",
            params={
                "tenant_id": permission_context["tenant_id"],
                "user_id": permission_context["user_id"],
                "project_id": permission_context["project_id"],
                "roles": "owner",
                "scopes": "diagram:read",
            },
        )
        if denied_audit.status_code != 403:
            print(f"FAIL: audit without audit:read returned {denied_audit.status_code}")
            return 1

    async with async_session() as session:
        presigned_records = list(
            (
                await session.execute(
                    select(ExportPresignedURL).where(
                        ExportPresignedURL.id.in_(presigned_url_ids)
                    )
                )
            )
            .scalars()
            .all()
        )
        asset_records = list(
            (
                await session.execute(
                    select(ExportAsset).where(ExportAsset.id.in_(asset_ids))
                )
            )
            .scalars()
            .all()
        )
    if len(presigned_records) != len(presigned_url_ids):
        print(
            "FAIL: persisted presigned URL records mismatch: "
            f"expected={len(presigned_url_ids)} actual={len(presigned_records)}"
        )
        return 1
    if len(asset_records) != len(asset_ids):
        print(
            "FAIL: persisted export asset records mismatch: "
            f"expected={len(asset_ids)} actual={len(asset_records)}"
        )
        return 1
    for asset in asset_records:
        if (asset.metadata_json or {}).get("storage_backend") != "local":
            print(f"FAIL: export asset missing local storage backend metadata: {asset.metadata_json}")
            return 1

    s3_storage = S3CompatibleObjectStorage(
        endpoint_url="https://example-account.r2.cloudflarestorage.com",
        bucket="smartdiagram-smoke",
        region="auto",
        access_key_id="smoke-access-key",
        secret_access_key="smoke-secret-key",
    )
    signed_url = s3_storage.get_signed_url(
        "tenants/local/projects/smoke/exports/example.json",
        expires_in=600,
    )
    if (
        "X-Amz-Algorithm=AWS4-HMAC-SHA256" not in signed_url
        or "X-Amz-Signature=" not in signed_url
        or "smartdiagram-smoke" not in signed_url
    ):
        print(f"FAIL: S3/R2 presigned URL is invalid: {signed_url}")
        return 1

    print(f"authorized_export_jobs={len(created_jobs)}")
    print(f"branch_diagram_id={branch['diagram_id']}")
    print(f"rollback_version_number={rollback['version_number']}")
    print(f"diff_added={diff_summary['added_line_count']} diff_removed={diff_summary['removed_line_count']}")
    print(f"history_matches={len(matching_history)}")
    print(f"approval_status={approval_decision_res.json()['status']}")
    print(f"async_export_status={async_job['status']}")
    print(f"queued_export_status={queued_job['status']}")
    print(f"presigned_urls={len(presigned_records)}")
    print(f"confirmation_required_events={confirmation_required_count}")
    print(f"storage_backend={asset_records[0].metadata_json['storage_backend']}")
    print(f"audit_events={len(audit_res.json().get('events', []))}")
    print(f"audit_metrics_events={metrics_res.json().get('audit_events', {}).get('total', 0)}")
    print(f"audit_metrics_cost={metrics_res.json().get('agent_runs', {}).get('estimated_cost', 0)}")
    print("OK: enterprise persistence/export smoke passed")
    return 0


def _headers(permission_context: dict) -> dict[str, str]:
    return {
        "x-tenant-id": str(permission_context["tenant_id"]),
        "x-user-id": str(permission_context["user_id"]),
        "x-team-id": str(permission_context.get("team_id", "")),
        "x-project-id": str(permission_context.get("project_id", "")),
        "x-roles": ",".join(permission_context.get("roles", [])),
        "x-scopes": ",".join(permission_context.get("scopes", [])),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-db", action="store_true", help="Fail instead of skip when PostgreSQL is unavailable.")
    args = parser.parse_args()
    return asyncio.run(run_smoke(require_db=args.require_db))


if __name__ == "__main__":
    sys.exit(main())
