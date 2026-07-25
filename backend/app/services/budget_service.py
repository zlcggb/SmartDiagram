"""Tenant-level usage budget evaluation."""

from datetime import datetime
from typing import Any

from sqlalchemy import distinct, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.audit import AgentRun
from app.models.model_usage import ModelUsageEvent
from app.models.common import new_id, utc_now
from app.models.tenant import Tenant
from app.models.usage import TenantUsageBudget, TenantUsageRollup
from app.services.audit_service import ensure_principals
from app.state.agent_runtime import PermissionContext


def current_budget_period(now: datetime | None = None) -> str:
    """Return the current monthly budget period in YYYY-MM format."""

    current = now or utc_now()
    return f"{current.year:04d}-{current.month:02d}"


def budget_period_bounds(period: str) -> tuple[datetime, datetime]:
    """Return [start, end) bounds for a YYYY-MM budget period."""

    year_text, month_text = period.split("-", 1)
    year = int(year_text)
    month = int(month_text)
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)
    return start, end


def _token_total(token_usage: dict[str, Any]) -> int:
    explicit_total = token_usage.get("estimated_total_tokens")
    if explicit_total is not None:
        return int(explicit_total or 0)
    return int(token_usage.get("estimated_input_tokens") or 0) + int(
        token_usage.get("estimated_output_tokens") or 0
    )


def _budget_insert_values(tenant_id: str, budget_period: str) -> dict[str, Any]:
    now = utc_now()
    return {
        "id": new_id(),
        "tenant_id": tenant_id,
        "period": budget_period,
        "monthly_cost_limit": settings.TENANT_DEFAULT_MONTHLY_COST_LIMIT,
        "monthly_token_limit": settings.TENANT_DEFAULT_MONTHLY_TOKEN_LIMIT,
        "hard_limit_enabled": settings.TENANT_BUDGET_HARD_LIMIT,
        "status": "active",
        "settings_json": {},
        "created_at": now,
        "updated_at": now,
    }


def _uses_postgres(session: AsyncSession) -> bool:
    return session.get_bind().dialect.name == "postgresql"


async def _load_tenant_budget(
    session: AsyncSession,
    tenant_id: str,
    budget_period: str,
) -> TenantUsageBudget | None:
    statement = select(TenantUsageBudget).where(
        TenantUsageBudget.tenant_id == tenant_id,
        TenantUsageBudget.period == budget_period,
    )
    return (await session.execute(statement)).scalars().first()


async def _insert_tenant_budget_if_missing(
    session: AsyncSession,
    tenant_id: str,
    budget_period: str,
) -> int:
    values = _budget_insert_values(tenant_id, budget_period)
    if _uses_postgres(session):
        statement = (
            pg_insert(TenantUsageBudget.__table__)
            .values(**values)
            .on_conflict_do_nothing(constraint="uq_tenant_usage_budget_period")
        )
        result = await session.execute(statement)
        await session.flush()
        return int(result.rowcount or 0)

    budget = TenantUsageBudget(**values)
    session.add(budget)
    try:
        await session.flush()
        return 1
    except IntegrityError:
        await session.rollback()
        return 0


async def ensure_tenant_budget(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    period: str | None = None,
) -> TenantUsageBudget:
    """Ensure a tenant has a budget row for the requested monthly period."""

    await ensure_principals(session, permission_context, conversation_id=None)
    tenant_id = permission_context.get("tenant_id") or "local"
    budget_period = period or current_budget_period()
    existing = await _load_tenant_budget(session, tenant_id, budget_period)
    if existing:
        return existing

    await _insert_tenant_budget_if_missing(session, tenant_id, budget_period)
    budget = await _load_tenant_budget(session, tenant_id, budget_period)
    if not budget:
        raise RuntimeError(f"Failed to ensure budget row for tenant={tenant_id} period={budget_period}")
    return budget


def _rollup_scope(project_id: str | None) -> tuple[str, str]:
    if project_id:
        return "project", project_id
    return "tenant", "__tenant__"


def _usage_from_rollup(rollup: TenantUsageRollup) -> dict[str, Any]:
    return {
        "period": rollup.period,
        "scope": rollup.scope,
        "tenant_id": rollup.tenant_id,
        "project_id": rollup.project_id,
        "run_count": rollup.run_count,
        "status_counts": rollup.status_counts_json or {},
        "estimated_cost": round(float(rollup.estimated_cost or 0.0), 8),
        "estimated_total_tokens": int(rollup.estimated_total_tokens or 0),
        "estimated_input_tokens": int(rollup.estimated_input_tokens or 0),
        "estimated_output_tokens": int(rollup.estimated_output_tokens or 0),
        "source": "rollup",
        "rollup_id": rollup.id,
        "rolled_up_at": rollup.refreshed_at.isoformat() if rollup.refreshed_at else None,
    }


async def _get_usage_rollup(
    session: AsyncSession,
    tenant_id: str,
    period: str,
    *,
    project_id: str | None = None,
) -> TenantUsageRollup | None:
    scope, scope_id = _rollup_scope(project_id)
    statement = select(TenantUsageRollup).where(
        TenantUsageRollup.tenant_id == tenant_id,
        TenantUsageRollup.period == period,
        TenantUsageRollup.scope == scope,
        TenantUsageRollup.scope_id == scope_id,
    )
    return (await session.execute(statement)).scalars().first()


async def _aggregate_agent_run_usage(
    session: AsyncSession,
    tenant_id: str,
    period: str,
    *,
    project_id: str | None = None,
) -> dict[str, Any]:
    """Aggregate estimated usage from AgentRun records for a budget period."""

    period_start, period_end = budget_period_bounds(period)
    statement = select(AgentRun).where(
        AgentRun.tenant_id == tenant_id,
        AgentRun.started_at >= period_start,
        AgentRun.started_at < period_end,
    )
    if project_id:
        statement = statement.where(AgentRun.project_id == project_id)

    runs = list((await session.execute(statement)).scalars().all())
    event_statement = select(ModelUsageEvent).where(
        ModelUsageEvent.tenant_id == tenant_id,
        ModelUsageEvent.started_at >= period_start,
        ModelUsageEvent.started_at < period_end,
    )
    if project_id:
        event_statement = event_statement.where(ModelUsageEvent.project_id == project_id)
    model_events = list((await session.execute(event_statement)).scalars().all())
    total_cost = 0.0
    total_tokens = 0
    total_input_tokens = 0
    total_output_tokens = 0
    status_counts: dict[str, int] = {}
    for run in runs:
        status_counts[run.status] = status_counts.get(run.status, 0) + 1
        token_usage = run.token_usage_json or {}
        total_cost += float(run.cost_estimate or 0.0)
        total_tokens += _token_total(token_usage)
        total_input_tokens += int(token_usage.get("estimated_input_tokens") or 0)
        total_output_tokens += int(token_usage.get("estimated_output_tokens") or 0)

    for event in model_events:
        status_counts[event.status] = status_counts.get(event.status, 0) + 1
        total_cost += float(event.estimated_cost or 0.0)
        total_tokens += int(event.total_tokens or 0)
        total_input_tokens += int(event.input_tokens or 0)
        total_output_tokens += int(event.output_tokens or 0)

    return {
        "period": period,
        "scope": "project" if project_id else "tenant",
        "tenant_id": tenant_id,
        "project_id": project_id,
        "run_count": len(runs) + len(model_events),
        "agent_run_count": len(runs),
        "model_call_count": len(model_events),
        "status_counts": status_counts,
        "estimated_cost": round(total_cost, 8),
        "estimated_total_tokens": total_tokens,
        "estimated_input_tokens": total_input_tokens,
        "estimated_output_tokens": total_output_tokens,
        "source": "agent_runs",
    }


async def get_tenant_usage(
    session: AsyncSession,
    tenant_id: str,
    period: str,
    *,
    project_id: str | None = None,
    prefer_rollup: bool = False,
) -> dict[str, Any]:
    """Return tenant or project usage, optionally from a pre-aggregated rollup."""

    if prefer_rollup:
        rollup = await _get_usage_rollup(
            session,
            tenant_id,
            period,
            project_id=project_id,
        )
        if rollup:
            return _usage_from_rollup(rollup)

    return await _aggregate_agent_run_usage(
        session,
        tenant_id,
        period,
        project_id=project_id,
    )


async def refresh_usage_rollup(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    period: str | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    """Refresh one tenant/project usage rollup from AgentRun records."""

    await ensure_principals(session, permission_context, conversation_id=None)
    tenant_id = permission_context.get("tenant_id") or "local"
    return await refresh_usage_rollup_for_scope(
        session,
        tenant_id,
        period=period,
        project_id=project_id,
    )


async def refresh_usage_rollup_for_scope(
    session: AsyncSession,
    tenant_id: str,
    *,
    period: str | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    """Refresh one rollup for a concrete tenant/project scope."""

    budget_period = period or current_budget_period()
    scope, scope_id = _rollup_scope(project_id)
    usage = await _aggregate_agent_run_usage(
        session,
        tenant_id,
        budget_period,
        project_id=project_id,
    )
    rollup = await _get_usage_rollup(
        session,
        tenant_id,
        budget_period,
        project_id=project_id,
    )
    now = utc_now()
    if not rollup:
        rollup = TenantUsageRollup(
            tenant_id=tenant_id,
            period=budget_period,
            scope=scope,
            scope_id=scope_id,
            project_id=project_id,
            created_at=now,
        )
        session.add(rollup)

    rollup.run_count = int(usage["run_count"])
    rollup.status_counts_json = usage["status_counts"]
    rollup.estimated_cost = float(usage["estimated_cost"])
    rollup.estimated_total_tokens = int(usage["estimated_total_tokens"])
    rollup.estimated_input_tokens = int(usage["estimated_input_tokens"])
    rollup.estimated_output_tokens = int(usage["estimated_output_tokens"])
    rollup.refreshed_at = now
    rollup.updated_at = now
    await session.flush()
    return _usage_from_rollup(rollup)


async def ensure_current_budget_periods(
    session: AsyncSession,
    *,
    period: str | None = None,
) -> dict[str, Any]:
    """Create current-period budget rows for active tenants.

    This acts as the local quota-reset job: each new month gets an explicit
    budget boundary before the first request needs to evaluate it.
    """

    budget_period = period or current_budget_period()
    tenant_ids = {
        tenant_id
        for tenant_id in (await session.execute(select(Tenant.id))).scalars().all()
        if tenant_id
    }
    budget_tenant_ids = {
        tenant_id
        for tenant_id in (await session.execute(select(distinct(TenantUsageBudget.tenant_id)))).scalars().all()
        if tenant_id
    }
    run_tenant_ids = {
        tenant_id
        for tenant_id in (await session.execute(select(distinct(AgentRun.tenant_id)))).scalars().all()
        if tenant_id
    }
    tenant_ids.update(budget_tenant_ids)
    tenant_ids.update(run_tenant_ids)

    created = 0
    use_postgres = _uses_postgres(session)
    for tenant_id in sorted(tenant_ids):
        if not use_postgres and await _load_tenant_budget(session, tenant_id, budget_period):
            continue
        created += await _insert_tenant_budget_if_missing(session, tenant_id, budget_period)
    return {
        "period": budget_period,
        "tenant_count": len(tenant_ids),
        "created_budget_count": created,
    }


async def refresh_active_usage_rollups(
    session: AsyncSession,
    *,
    period: str | None = None,
) -> dict[str, Any]:
    """Refresh tenant and project rollups for scopes with current usage."""

    budget_period = period or current_budget_period()
    await ensure_current_budget_periods(session, period=budget_period)
    period_start, period_end = budget_period_bounds(budget_period)

    tenant_ids = {
        tenant_id
        for tenant_id in (
            await session.execute(
                select(distinct(AgentRun.tenant_id)).where(
                    AgentRun.started_at >= period_start,
                    AgentRun.started_at < period_end,
                )
            )
        ).scalars().all()
        if tenant_id
    }
    tenant_ids.update(
        tenant_id
        for tenant_id in (
            await session.execute(
                select(distinct(TenantUsageBudget.tenant_id)).where(
                    TenantUsageBudget.period == budget_period
                )
            )
        ).scalars().all()
        if tenant_id
    )

    rollups: list[dict[str, Any]] = []
    for tenant_id in sorted(tenant_ids):
        rollups.append(
            await refresh_usage_rollup_for_scope(
                session,
                tenant_id,
                period=budget_period,
                project_id=None,
            )
        )

    project_rows = (
        await session.execute(
            select(AgentRun.tenant_id, AgentRun.project_id)
            .where(AgentRun.started_at >= period_start)
            .where(AgentRun.started_at < period_end)
            .where(AgentRun.project_id.is_not(None))
            .distinct()
        )
    ).all()
    for tenant_id, project_id in sorted(project_rows):
        if not tenant_id or not project_id:
            continue
        rollups.append(
            await refresh_usage_rollup_for_scope(
                session,
                tenant_id,
                period=budget_period,
                project_id=project_id,
            )
        )

    await session.flush()
    return {
        "period": budget_period,
        "tenant_count": len(tenant_ids),
        "project_scope_count": len(project_rows),
        "rollup_count": len(rollups),
        "rollups": rollups,
    }


def _limit_remaining(limit: float | int, used: float | int) -> float | int | None:
    if not limit or limit <= 0:
        return None
    return max(0, limit - used)


async def evaluate_tenant_budget(
    session: AsyncSession,
    permission_context: PermissionContext,
    runtime_guard: dict[str, Any],
    *,
    period: str | None = None,
) -> dict[str, Any]:
    """Check whether a request can run under the tenant monthly budget."""

    budget = await ensure_tenant_budget(session, permission_context, period=period)
    usage = await get_tenant_usage(
        session,
        budget.tenant_id,
        budget.period,
        prefer_rollup=False,
    )
    projected_cost = round(
        float(usage["estimated_cost"]) + float(runtime_guard.get("estimated_cost") or 0.0),
        8,
    )
    projected_tokens = int(usage["estimated_total_tokens"]) + int(
        runtime_guard.get("estimated_total_tokens") or 0
    )
    cost_exceeded = (
        budget.monthly_cost_limit > 0 and projected_cost > budget.monthly_cost_limit
    )
    token_exceeded = (
        budget.monthly_token_limit > 0 and projected_tokens > budget.monthly_token_limit
    )
    allowed = not budget.hard_limit_enabled or not (cost_exceeded or token_exceeded)
    reason = "ok"
    if cost_exceeded:
        reason = "tenant_monthly_cost_budget_exceeded"
    if token_exceeded:
        reason = "tenant_monthly_token_budget_exceeded"

    return {
        "allowed": allowed,
        "reason": reason,
        "period": budget.period,
        "tenant_id": budget.tenant_id,
        "hard_limit_enabled": budget.hard_limit_enabled,
        "budget": {
            "monthly_cost_limit": budget.monthly_cost_limit,
            "monthly_token_limit": budget.monthly_token_limit,
            "status": budget.status,
        },
        "usage": usage,
        "projected": {
            "estimated_cost": projected_cost,
            "estimated_total_tokens": projected_tokens,
        },
        "remaining": {
            "cost": _limit_remaining(budget.monthly_cost_limit, projected_cost),
            "tokens": _limit_remaining(budget.monthly_token_limit, projected_tokens),
        },
    }


async def get_budget_metrics_snapshot(
    session: AsyncSession,
    permission_context: PermissionContext,
    *,
    include_tenant_limits: bool,
    project_id: str | None = None,
    period: str | None = None,
) -> dict[str, Any]:
    """Build a sanitized budget snapshot for observability metrics."""

    budget = await ensure_tenant_budget(session, permission_context, period=period)
    usage = await get_tenant_usage(
        session,
        budget.tenant_id,
        budget.period,
        project_id=None if include_tenant_limits else project_id,
        prefer_rollup=True,
    )
    snapshot: dict[str, Any] = {
        "period": budget.period,
        "scope": usage["scope"],
        "usage": usage,
    }
    if not include_tenant_limits:
        snapshot["note"] = "Project-scoped metrics hide tenant-wide budget limits and remaining usage."
        return snapshot

    snapshot["budget"] = {
        "monthly_cost_limit": budget.monthly_cost_limit,
        "monthly_token_limit": budget.monthly_token_limit,
        "hard_limit_enabled": budget.hard_limit_enabled,
        "status": budget.status,
    }
    snapshot["remaining"] = {
        "cost": _limit_remaining(budget.monthly_cost_limit, float(usage["estimated_cost"])),
        "tokens": _limit_remaining(
            budget.monthly_token_limit,
            int(usage["estimated_total_tokens"]),
        ),
    }
    return snapshot
