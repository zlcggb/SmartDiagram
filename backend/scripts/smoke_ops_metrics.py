"""Smoke test audit JSON metrics and Prometheus exposition.

Usage:
  uv run python scripts/smoke_ops_metrics.py
  uv run python scripts/smoke_ops_metrics.py --require-db
"""

import argparse
import asyncio
import sys
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from sqlalchemy import text

from app.core.db import async_session, init_db
from app.main import app
from app.models.common import utc_now
from app.models.export import ExportJob
from app.models.knowledge import KnowledgeDocument, KnowledgeIngestionJob, KnowledgeSource
from app.services.audit_service import (
    create_agent_run_id,
    persist_agent_run_finish,
    persist_agent_run_start,
)
from app.services.agent_runtime import build_default_execution_plan
from app.services.agent_trace_service import AgentTraceRecorder
from app.services.diagram_persistence_service import create_conversation_id, persist_generated_diagram
from app.services.object_storage import get_object_storage
from app.services.worker_recovery_service import recover_stale_worker_jobs_once


async def database_available() -> bool:
    try:
        async with async_session() as session:
            await session.execute(text("select 1"))
        return True
    except Exception as exc:
        print(f"SKIP: database unavailable: {exc}")
        return False


def _permission_context() -> dict:
    suffix = uuid4().hex[:10]
    return {
        "tenant_id": f"ops-tenant-{suffix}",
        "user_id": "ops-owner",
        "team_id": "ops-team",
        "project_id": f"ops-project-{suffix}",
        "roles": ["owner"],
        "scopes": [
            "diagram:read",
            "diagram:write",
            "project:read",
            "audit:read",
            "approval:read",
            "approval:write",
        ],
    }


def _sample_trace_spans(run_id: str, permission_context: dict) -> list[dict]:
    recorder = AgentTraceRecorder(
        run_id=run_id,
        permission_context=permission_context,
        conversation_id=None,
    )
    events = [
        {
            "event": "on_chain_start",
            "name": "router",
            "run_id": "ops-router-run",
            "parent_ids": [],
            "data": {"input": {"messages": ["redacted"]}},
        },
        {
            "event": "on_chain_end",
            "name": "router",
            "run_id": "ops-router-run",
            "parent_ids": [],
            "data": {"output": {"engine_type": "mermaid"}},
        },
        {
            "event": "on_chain_start",
            "name": "planner_agent",
            "run_id": "ops-planner-run",
            "parent_ids": ["ops-router-run"],
            "data": {"input": {"engine_type": "mermaid"}},
        },
        {
            "event": "on_chain_end",
            "name": "planner_agent",
            "run_id": "ops-planner-run",
            "parent_ids": ["ops-router-run"],
            "data": {"output": {"status": "ready"}},
        },
        {
            "event": "on_chain_start",
            "name": "knowledge_agent",
            "run_id": "ops-knowledge-run",
            "parent_ids": ["ops-planner-run"],
            "data": {"input": {"query": "redacted"}},
        },
        {
            "event": "on_chain_end",
            "name": "knowledge_agent",
            "run_id": "ops-knowledge-run",
            "parent_ids": ["ops-planner-run"],
            "data": {"output": {"status": "no_authorized_context"}},
        },
        {
            "event": "on_chain_start",
            "name": "mermaid_agent",
            "run_id": "ops-chart-run",
            "parent_ids": ["ops-knowledge-run"],
            "data": {"input": {"engine_type": "mermaid"}},
        },
        {
            "event": "on_chat_model_start",
            "name": "ChatOpenAI",
            "run_id": "ops-model-run",
            "parent_ids": ["ops-chart-run"],
            "data": {"input": {"messages": ["redacted"]}},
        },
        {
            "event": "on_chat_model_end",
            "name": "ChatOpenAI",
            "run_id": "ops-model-run",
            "parent_ids": ["ops-chart-run"],
            "data": {"output": {"generations": []}},
        },
        {
            "event": "on_chain_end",
            "name": "mermaid_agent",
            "run_id": "ops-chart-run",
            "parent_ids": ["ops-knowledge-run"],
            "data": {"output": {"engine_type": "mermaid"}},
        },
        {
            "event": "on_chain_start",
            "name": "design_agent",
            "run_id": "ops-design-run",
            "parent_ids": ["ops-chart-run"],
            "data": {"input": {"engine_type": "mermaid"}},
        },
        {
            "event": "on_chain_end",
            "name": "design_agent",
            "run_id": "ops-design-run",
            "parent_ids": ["ops-chart-run"],
            "data": {"output": {"status": "skipped"}},
        },
        {
            "event": "on_chain_start",
            "name": "validator_agent",
            "run_id": "ops-validator-run",
            "parent_ids": ["ops-design-run"],
            "data": {"input": {"engine_type": "mermaid"}},
        },
        {
            "event": "on_chain_end",
            "name": "validator_agent",
            "run_id": "ops-validator-run",
            "parent_ids": ["ops-design-run"],
            "data": {"output": {"ok": True}},
        },
        {
            "event": "on_chain_start",
            "name": "repair_agent",
            "run_id": "ops-repair-run",
            "parent_ids": ["ops-validator-run"],
            "data": {"input": {"engine_type": "mermaid"}},
        },
        {
            "event": "on_chain_end",
            "name": "repair_agent",
            "run_id": "ops-repair-run",
            "parent_ids": ["ops-validator-run"],
            "data": {"output": {"status": "passed"}},
        },
        {
            "event": "on_chain_start",
            "name": "consistency_agent",
            "run_id": "ops-consistency-run",
            "parent_ids": ["ops-repair-run"],
            "data": {"input": {"engine_type": "mermaid"}},
        },
        {
            "event": "on_chain_end",
            "name": "consistency_agent",
            "run_id": "ops-consistency-run",
            "parent_ids": ["ops-repair-run"],
            "data": {"output": {"status": "checked"}},
        },
        {
            "event": "on_chain_start",
            "name": "export_agent",
            "run_id": "ops-export-run",
            "parent_ids": ["ops-consistency-run"],
            "data": {"input": {"engine_type": "mermaid"}},
        },
        {
            "event": "on_chain_end",
            "name": "export_agent",
            "run_id": "ops-export-run",
            "parent_ids": ["ops-consistency-run"],
            "data": {"output": {"status": "ready"}},
        },
    ]
    for event in events:
        recorder.observe_langgraph_event(event)
    return recorder.finish(status="succeeded")


async def run_smoke(require_db: bool) -> int:
    if not await database_available():
        return 1 if require_db else 0

    await init_db()
    permission_context = _permission_context()
    run_id = create_agent_run_id()
    token_usage = {
        "estimated_input_tokens": 321,
        "estimated_output_tokens": 654,
        "estimated_total_tokens": 975,
    }
    await persist_agent_run_start(
        run_id=run_id,
        permission_context=permission_context,
        model_config={"model_id": "ops-smoke-model"},
        conversation_id=None,
        token_usage=token_usage,
        cost_estimate=0.0042,
    )
    trace_spans = _sample_trace_spans(run_id, permission_context)
    execution_plan = build_default_execution_plan("flowchart", "mermaid")
    validation_events = [{"ok": True, "engine_type": "mermaid", "errors": [], "warnings": []}]
    await persist_agent_run_finish(
        run_id=run_id,
        permission_context=permission_context,
        status="succeeded",
        task_type="flowchart",
        engine_type="mermaid",
        execution_plan=execution_plan,
        validation_events=validation_events,
        audit_events=[
            {
                "type": "runtime.guard.evaluated",
                "actor_user_id": permission_context["user_id"],
                "tenant_id": permission_context["tenant_id"],
                "project_id": permission_context["project_id"],
                "message": "Ops smoke runtime guard event.",
                "metadata": {"estimated_cost": 0.0042},
            },
            {
                "type": "planner.plan.created",
                "actor_user_id": permission_context["user_id"],
                "tenant_id": permission_context["tenant_id"],
                "project_id": permission_context["project_id"],
                "message": "Ops smoke planner event.",
                "metadata": {"subtask_count": 6},
            },
            {
                "type": "knowledge.retrieve",
                "actor_user_id": permission_context["user_id"],
                "tenant_id": permission_context["tenant_id"],
                "project_id": permission_context["project_id"],
                "message": "Ops smoke knowledge event.",
                "metadata": {"status": "no_authorized_context"},
            },
            {
                "type": "design.output.optimized",
                "actor_user_id": permission_context["user_id"],
                "tenant_id": permission_context["tenant_id"],
                "project_id": permission_context["project_id"],
                "message": "Ops smoke design event.",
                "metadata": {"status": "skipped"},
            },
            {
                "type": "validator.output.checked",
                "actor_user_id": permission_context["user_id"],
                "tenant_id": permission_context["tenant_id"],
                "project_id": permission_context["project_id"],
                "message": "Ops smoke validator event.",
                "metadata": {"ok": True},
            },
            {
                "type": "repair.output.checked",
                "actor_user_id": permission_context["user_id"],
                "tenant_id": permission_context["tenant_id"],
                "project_id": permission_context["project_id"],
                "message": "Ops smoke repair event.",
                "metadata": {"status": "passed"},
            },
            {
                "type": "consistency.knowledge.checked",
                "actor_user_id": permission_context["user_id"],
                "tenant_id": permission_context["tenant_id"],
                "project_id": permission_context["project_id"],
                "message": "Ops smoke consistency event.",
                "metadata": {"status": "checked", "ok": True},
            },
            {
                "type": "export.plan.created",
                "actor_user_id": permission_context["user_id"],
                "tenant_id": permission_context["tenant_id"],
                "project_id": permission_context["project_id"],
                "message": "Ops smoke export event.",
                "metadata": {"status": "ready"},
            },
        ],
        tool_calls=[
            {"tool_name": "planner.task_decomposition", "status": "succeeded", "output_summary": "subtasks=6"},
            {"tool_name": "design.optimize", "status": "succeeded", "output_summary": "changed=False"},
            {"tool_name": "validator.output", "status": "succeeded", "output_summary": "ok"},
            {"tool_name": "repair.output", "status": "succeeded", "output_summary": "no repair needed"},
            {"tool_name": "consistency.knowledge", "status": "succeeded", "output_summary": "checked"},
            {"tool_name": "export.plan", "status": "succeeded", "output_summary": "allowed_formats=3"},
        ],
        token_usage=token_usage,
        cost_estimate=0.0042,
        trace_spans=trace_spans,
    )
    conversation_id = create_conversation_id()
    persisted = await persist_generated_diagram(
        permission_context=permission_context,
        conversation_id=conversation_id,
        user_message="生成运维队列烟测图",
        assistant_content="已生成运维队列烟测图。",
        diagram_code="graph TD\n  A[Queued] --> B[Worker]\n",
        design_concept="Ops queue smoke diagram.",
        task_type="flowchart",
        engine_type="mermaid",
        validation_events=[{"ok": True, "engine_type": "mermaid", "errors": [], "warnings": []}],
    )
    if not persisted or not persisted.get("persisted"):
        print(f"FAIL: queue health diagram persistence failed: {persisted}")
        return 1

    storage_key = f"ops/{permission_context['tenant_id']}/queue.md"
    get_object_storage().put_object(
        storage_key,
        b"# Ops queue document\n\nWorker queue health smoke content.",
        "text/markdown",
    )

    async with async_session() as session:
        stale_started_at = utc_now() - timedelta(hours=2)
        session.add(
            ExportJob(
                tenant_id=permission_context["tenant_id"],
                project_id=permission_context["project_id"],
                diagram_id=persisted["diagram_id"],
                diagram_version_id=persisted["diagram_version_id"],
                requested_by=permission_context["user_id"],
                format="svg",
                status="queued",
            )
        )
        session.add(
            ExportJob(
                tenant_id=permission_context["tenant_id"],
                project_id=permission_context["project_id"],
                diagram_id=persisted["diagram_id"],
                diagram_version_id=persisted["diagram_version_id"],
                requested_by=permission_context["user_id"],
                format="png",
                status="running",
                started_at=stale_started_at,
            )
        )
        source = KnowledgeSource(
            tenant_id=permission_context["tenant_id"],
            team_id=permission_context["team_id"],
            project_id=permission_context["project_id"],
            name="Ops queue source",
            created_by=permission_context["user_id"],
        )
        session.add(source)
        await session.flush()
        document = KnowledgeDocument(
            tenant_id=permission_context["tenant_id"],
            team_id=permission_context["team_id"],
            project_id=permission_context["project_id"],
            source_id=source.id,
            title="Ops queue document",
            original_filename="ops-queue.md",
            mime_type="text/markdown",
            storage_key=storage_key,
            content_hash="ops-queue",
            status="uploaded",
            created_by=permission_context["user_id"],
        )
        session.add(document)
        await session.flush()
        session.add(
            KnowledgeIngestionJob(
                tenant_id=permission_context["tenant_id"],
                source_id=source.id,
                document_id=document.id,
                requested_by=permission_context["user_id"],
                status="queued",
                stage="queued",
            )
        )
        session.add(
            KnowledgeIngestionJob(
                tenant_id=permission_context["tenant_id"],
                source_id=source.id,
                document_id=document.id,
                requested_by=permission_context["user_id"],
                status="running",
                stage="parsing",
                progress=0.2,
                started_at=stale_started_at,
            )
        )
        await session.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        params = {
            "tenant_id": permission_context["tenant_id"],
            "user_id": permission_context["user_id"],
            "team_id": permission_context["team_id"],
            "project_id": permission_context["project_id"],
            "roles": ",".join(permission_context["roles"]),
            "scopes": ",".join(permission_context["scopes"]),
        }
        approval_create_res = await client.post(
            "/api/approvals",
            json={
                "approval_type": "ops_checkpoint",
                "reason": "Ops smoke pending approval.",
                "resource": {
                    "diagram_id": persisted["diagram_id"],
                    "diagram_version_id": persisted["diagram_version_id"],
                    "source": "smoke_ops_metrics",
                },
                **permission_context,
            },
        )
        if approval_create_res.status_code != 200:
            print(f"FAIL: approval create returned {approval_create_res.status_code}: {approval_create_res.text}")
            return 1
        approval = approval_create_res.json()
        if approval.get("status") != "pending":
            print(f"FAIL: approval should be pending: {approval}")
            return 1

        approvals_res = await client.get("/api/approvals", params={**params, "status": "pending"})
        if approvals_res.status_code != 200:
            print(f"FAIL: approvals list returned {approvals_res.status_code}: {approvals_res.text}")
            return 1
        if not any(item.get("approval_id") == approval.get("approval_id") for item in approvals_res.json().get("approvals", [])):
            print(f"FAIL: pending approvals list missing smoke approval: {approvals_res.text}")
            return 1

        metrics_res = await client.get("/api/audit/metrics", params=params)
        if metrics_res.status_code != 200:
            print(f"FAIL: audit metrics returned {metrics_res.status_code}: {metrics_res.text}")
            return 1
        metrics = metrics_res.json()
        if metrics.get("agent_runs", {}).get("estimated_cost", 0) <= 0:
            print(f"FAIL: JSON metrics missing estimated cost: {metrics}")
            return 1
        if (metrics.get("execution_steps", {}).get("status_counts") or {}).get("succeeded", 0) < 7:
            print(f"FAIL: JSON metrics missing execution step status counts: {metrics}")
            return 1
        if not metrics.get("budget"):
            print(f"FAIL: JSON metrics missing budget snapshot: {metrics}")
            return 1
        approval_metrics = metrics.get("approval_requests") or {}
        if approval_metrics.get("pending", 0) < 1:
            print(f"FAIL: JSON metrics missing pending approval requests: {metrics}")
            return 1
        if (approval_metrics.get("status_counts") or {}).get("pending", 0) < 1:
            print(f"FAIL: JSON metrics missing approval status counts: {metrics}")
            return 1
        queue_health = metrics.get("queue_health") or {}
        if (queue_health.get("totals") or {}).get("queued", 0) < 2:
            print(f"FAIL: JSON metrics missing queued worker jobs: {metrics}")
            return 1
        if (queue_health.get("queues", {}).get("exports") or {}).get("queued_count", 0) < 1:
            print(f"FAIL: JSON metrics missing queued export jobs: {queue_health}")
            return 1
        if (queue_health.get("queues", {}).get("knowledge_ingestion") or {}).get("queued_count", 0) < 1:
            print(f"FAIL: JSON metrics missing queued knowledge jobs: {queue_health}")
            return 1
        if (queue_health.get("queues", {}).get("exports") or {}).get("stale_running_count", 0) < 1:
            print(f"FAIL: JSON metrics missing stale export jobs: {queue_health}")
            return 1
        if (queue_health.get("queues", {}).get("knowledge_ingestion") or {}).get("stale_running_count", 0) < 1:
            print(f"FAIL: JSON metrics missing stale knowledge jobs: {queue_health}")
            return 1

        queue_health_res = await client.get("/api/audit/queue-health", params=params)
        if queue_health_res.status_code != 200:
            print(f"FAIL: queue health endpoint returned {queue_health_res.status_code}: {queue_health_res.text}")
            return 1
        queue_health_body = queue_health_res.json()
        if (queue_health_body.get("totals") or {}).get("queued", 0) < 2:
            print(f"FAIL: queue health endpoint missing queued jobs: {queue_health_body}")
            return 1
        if (queue_health_body.get("totals") or {}).get("running", 0) < 2:
            print(f"FAIL: queue health endpoint missing stale running jobs: {queue_health_body}")
            return 1

        trace_res = await client.get(f"/api/audit/agent-runs/{run_id}/trace", params=params)
        if trace_res.status_code != 200:
            print(f"FAIL: trace endpoint returned {trace_res.status_code}: {trace_res.text}")
            return 1
        trace = trace_res.json()
        if trace.get("span_count", 0) < 4:
            print(f"FAIL: trace endpoint returned too few spans: {trace}")
            return 1
        names = {span.get("name") for span in trace.get("spans", [])}
        if not {
            "router",
            "planner_agent",
            "knowledge_agent",
            "mermaid_agent",
            "design_agent",
            "validator_agent",
            "repair_agent",
            "consistency_agent",
            "export_agent",
            "ChatOpenAI",
        }.issubset(names):
            print(f"FAIL: trace endpoint missing expected graph nodes: {trace}")
            return 1
        if not any(span.get("parent_span_id") for span in trace.get("spans", [])):
            print(f"FAIL: trace endpoint missing parent span relationships: {trace}")
            return 1

        steps_res = await client.get(f"/api/audit/agent-runs/{run_id}/steps", params=params)
        if steps_res.status_code != 200:
            print(f"FAIL: execution steps endpoint returned {steps_res.status_code}: {steps_res.text}")
            return 1
        steps_body = steps_res.json()
        step_ids = {step.get("id") for step in steps_body.get("execution_steps", [])}
        expected_step_ids = {"router", "planner", "knowledge", "chart", "designer", "validator", "repair", "consistency", "export"}
        if not expected_step_ids.issubset(step_ids):
            print(f"FAIL: execution steps missing expected Agent Harness steps: {steps_body}")
            return 1
        failed_steps = [
            step
            for step in steps_body.get("execution_steps", [])
            if step.get("id") in expected_step_ids and step.get("status") != "succeeded"
        ]
        if failed_steps:
            print(f"FAIL: execution steps should be succeeded: {failed_steps}")
            return 1
        if len(steps_body.get("tool_calls", [])) < 4:
            print(f"FAIL: execution steps endpoint missing persisted tool calls: {steps_body}")
            return 1

        prometheus_res = await client.get("/api/audit/prometheus", params=params)
        if prometheus_res.status_code != 200:
            print(f"FAIL: prometheus metrics returned {prometheus_res.status_code}: {prometheus_res.text}")
            return 1
        text_body = prometheus_res.text
        required_lines = [
            "smartdiagram_agent_runs_total",
            'engine_type="mermaid"',
            "smartdiagram_agent_tokens_estimated_total",
            'token_type="total"',
            "smartdiagram_agent_cost_estimated_total",
            "smartdiagram_agent_execution_steps",
            'step_id="designer"',
            "smartdiagram_audit_events_total",
            "smartdiagram_approval_requests",
            'approval_type="ops_checkpoint"',
            'status="pending"',
            "smartdiagram_approval_oldest_pending_age_seconds",
            "smartdiagram_budget_usage",
            "smartdiagram_queue_jobs",
            'queue="exports"',
            'queue="knowledge_ingestion"',
            'status="running"',
            "smartdiagram_queue_oldest_queued_age_seconds",
        ]
        for required in required_lines:
            if required not in text_body:
                print(f"FAIL: prometheus output missing {required}: {text_body}")
                return 1

        denied_res = await client.get(
            "/api/audit/prometheus",
            params={
                **params,
                "scopes": "diagram:read",
            },
        )
        if denied_res.status_code != 403:
            print(f"FAIL: prometheus without audit:read returned {denied_res.status_code}")
            return 1
        denied_trace_res = await client.get(
            f"/api/audit/agent-runs/{run_id}/trace",
            params={
                **params,
                "scopes": "diagram:read",
            },
        )
        if denied_trace_res.status_code != 403:
            print(f"FAIL: trace without audit:read returned {denied_trace_res.status_code}")
            return 1
        denied_steps_res = await client.get(
            f"/api/audit/agent-runs/{run_id}/steps",
            params={
                **params,
                "scopes": "diagram:read",
            },
        )
        if denied_steps_res.status_code != 403:
            print(f"FAIL: steps without audit:read returned {denied_steps_res.status_code}")
            return 1
        denied_queue_res = await client.get(
            "/api/audit/queue-health",
            params={
                **params,
                "scopes": "diagram:read",
            },
        )
        if denied_queue_res.status_code != 403:
            print(f"FAIL: queue health without audit:read returned {denied_queue_res.status_code}")
            return 1
        denied_approvals_res = await client.get(
            "/api/approvals",
            params={
                **params,
                "scopes": "audit:read,diagram:read",
            },
        )
        if denied_approvals_res.status_code != 403:
            print(f"FAIL: approvals without approval:read returned {denied_approvals_res.status_code}")
            return 1

        recovery_summary = await recover_stale_worker_jobs_once(
            stale_after_seconds=1,
            action="requeue",
            limit=25,
        )
        recovered_current_tenant = [
            job
            for job in recovery_summary.get("jobs", [])
            if job.get("status") == "queued"
        ]
        if len(recovered_current_tenant) < 2:
            print(f"FAIL: stale worker recovery did not requeue jobs: {recovery_summary}")
            return 1
        recovered_health_res = await client.get("/api/audit/queue-health", params=params)
        if recovered_health_res.status_code != 200:
            print(f"FAIL: recovered queue health returned {recovered_health_res.status_code}: {recovered_health_res.text}")
            return 1
        recovered_health = recovered_health_res.json()
        recovered_stale_count = sum(
            (queue or {}).get("stale_running_count", 0)
            for queue in (recovered_health.get("queues") or {}).values()
        )
        if recovered_stale_count != 0:
            print(f"FAIL: stale worker recovery left stale running jobs: {recovered_health}")
            return 1

    print(f"ops_metrics_cost={metrics['agent_runs']['estimated_cost']}")
    print(f"ops_trace_spans={trace['span_count']}")
    print(f"ops_execution_steps={len(steps_body.get('execution_steps', []))}")
    print(f"ops_pending_approvals={approval_metrics['pending']}")
    print(f"ops_queue_queued={queue_health_body['totals']['queued']}")
    print(f"ops_stale_recovered={len(recovered_current_tenant)}")
    print("OK: ops metrics smoke passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-db", action="store_true", help="Fail instead of skip when PostgreSQL is unavailable.")
    args = parser.parse_args()
    return asyncio.run(run_smoke(require_db=args.require_db))


if __name__ == "__main__":
    sys.exit(main())
