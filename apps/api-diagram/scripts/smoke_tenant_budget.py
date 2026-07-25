"""Smoke test tenant monthly budget guardrails.

Usage:
  uv run python scripts/smoke_tenant_budget.py
  uv run python scripts/smoke_tenant_budget.py --require-db
"""

import argparse
import asyncio
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from sqlalchemy import text

from app.core.db import async_session, init_db
from app.main import app
from app.services.audit_service import (
    create_agent_run_id,
    persist_agent_run_finish,
    persist_agent_run_start,
)
from app.services.budget_service import (
    current_budget_period,
    ensure_tenant_budget,
    evaluate_tenant_budget,
)
from app.services.usage_rollup_scheduler import run_usage_rollup_maintenance_once


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
        "tenant_id": f"budget-tenant-{suffix}",
        "user_id": "budget-owner",
        "team_id": "budget-team",
        "project_id": f"budget-project-{suffix}",
        "roles": ["owner"],
        "scopes": [
            "diagram:read",
            "diagram:write",
            "project:read",
            "audit:read",
        ],
    }


async def run_smoke(require_db: bool) -> int:
    if not await database_available():
        return 1 if require_db else 0

    await init_db()
    permission_context = _permission_context()
    period = current_budget_period()

    async with async_session() as session:
        budget = await ensure_tenant_budget(session, permission_context, period=period)
        budget.monthly_cost_limit = 0.002
        budget.monthly_token_limit = 1000
        budget.hard_limit_enabled = True
        await session.commit()

    run_id = create_agent_run_id()
    token_usage = {
        "estimated_input_tokens": 200,
        "estimated_output_tokens": 400,
        "estimated_total_tokens": 600,
    }
    await persist_agent_run_start(
        run_id=run_id,
        permission_context=permission_context,
        model_config={"model_id": "budget-smoke-model"},
        conversation_id=None,
        token_usage=token_usage,
        cost_estimate=0.001,
    )
    await persist_agent_run_finish(
        run_id=run_id,
        permission_context=permission_context,
        status="succeeded",
        task_type="flowchart",
        engine_type="mermaid",
        token_usage=token_usage,
        cost_estimate=0.001,
    )

    async with async_session() as session:
        allowed = await evaluate_tenant_budget(
            session,
            permission_context,
            {
                "estimated_cost": 0.0005,
                "estimated_total_tokens": 200,
            },
            period=period,
        )
        rejected = await evaluate_tenant_budget(
            session,
            permission_context,
            {
                "estimated_cost": 0.002,
                "estimated_total_tokens": 200,
            },
            period=period,
        )

    if not allowed["allowed"]:
        print(f"FAIL: request below tenant budget should pass: {allowed}")
        return 1
    if rejected["allowed"] or rejected["reason"] != "tenant_monthly_cost_budget_exceeded":
        print(f"FAIL: request above tenant cost budget should be rejected: {rejected}")
        return 1

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        reject_res = await client.post(
            "/api/chat/stream",
            json={
                "message": "生成销售报价流程图",
                "max_tokens": 1200,
                **permission_context,
            },
        )
        if reject_res.status_code != 402:
            print(f"FAIL: chat request should be rejected by tenant budget: {reject_res.status_code} {reject_res.text}")
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
        budget_snapshot = metrics.get("budget") or {}
        if budget_snapshot.get("budget", {}).get("monthly_cost_limit") != 0.002:
            print(f"FAIL: budget metrics missing monthly cost limit: {metrics}")
            return 1
        if budget_snapshot.get("usage", {}).get("estimated_cost", 0) <= 0:
            print(f"FAIL: budget metrics missing usage: {metrics}")
            return 1
        if budget_snapshot.get("usage", {}).get("source") != "agent_runs":
            print(f"FAIL: budget metrics should use live aggregation before rollup refresh: {metrics}")
            return 1

        rollup_res = await client.post(
            "/api/audit/usage-rollups/refresh",
            params={
                "tenant_id": permission_context["tenant_id"],
                "user_id": permission_context["user_id"],
                "team_id": permission_context["team_id"],
                "project_id": permission_context["project_id"],
                "roles": ",".join(permission_context["roles"]),
                "scopes": ",".join(permission_context["scopes"]),
                "period": period,
                "scope": "tenant",
            },
        )
        if rollup_res.status_code != 200:
            print(f"FAIL: usage rollup refresh returned {rollup_res.status_code}: {rollup_res.text}")
            return 1
        rollup = (rollup_res.json().get("rollup") or {})
        if rollup.get("source") != "rollup" or rollup.get("run_count") != 1:
            print(f"FAIL: usage rollup response invalid: {rollup_res.json()}")
            return 1

        rollup_metrics_res = await client.get(
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
        if rollup_metrics_res.status_code != 200:
            print(f"FAIL: rollup audit metrics returned {rollup_metrics_res.status_code}: {rollup_metrics_res.text}")
            return 1
        rollup_budget_snapshot = (rollup_metrics_res.json().get("budget") or {})
        if rollup_budget_snapshot.get("usage", {}).get("source") != "rollup":
            print(f"FAIL: budget metrics should use refreshed rollup: {rollup_metrics_res.json()}")
            return 1
        if not rollup_budget_snapshot.get("usage", {}).get("rollup_id"):
            print(f"FAIL: rollup-backed metrics missing rollup id: {rollup_metrics_res.json()}")
            return 1
        budget_snapshot = rollup_budget_snapshot

    maintenance_summary = await run_usage_rollup_maintenance_once()
    tenant_rollups = [
        rollup
        for rollup in maintenance_summary.get("rollups", [])
        if rollup.get("tenant_id") == permission_context["tenant_id"]
        and rollup.get("scope") == "tenant"
    ]
    if not tenant_rollups:
        print(f"FAIL: usage rollup maintenance job missed smoke tenant: {maintenance_summary}")
        return 1
    if tenant_rollups[0].get("run_count") != 1:
        print(f"FAIL: usage rollup maintenance job returned invalid run count: {tenant_rollups[0]}")
        return 1

    print(f"tenant_budget_period={period}")
    print(f"tenant_budget_usage_cost={budget_snapshot['usage']['estimated_cost']}")
    print(f"tenant_budget_remaining_cost={budget_snapshot['remaining']['cost']}")
    print(f"tenant_budget_usage_source={budget_snapshot['usage']['source']}")
    print(f"tenant_budget_rollup_job_rollups={maintenance_summary['rollup_count']}")
    print("OK: tenant budget smoke passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-db", action="store_true", help="Fail instead of skip when PostgreSQL is unavailable.")
    args = parser.parse_args()
    return asyncio.run(run_smoke(require_db=args.require_db))


if __name__ == "__main__":
    sys.exit(main())
