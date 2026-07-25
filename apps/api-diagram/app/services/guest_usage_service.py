"""Record guest AI usage for platform admin reporting."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.guest import GuestSession, GuestUsageEvent
from app.models.common import utc_now
from app.services.guest_quota_service import hash_client_ip


async def record_guest_ai_usage(
    session: AsyncSession,
    *,
    guest_id: str,
    ip: str,
    source: str = "diagram",
    route: str = "/api/chat/stream",
    estimated_total_tokens: int = 0,
    estimated_cost: float = 0.0,
) -> None:
    record = await session.get(GuestSession, guest_id)
    if record:
        record.ai_calls_used = int(record.ai_calls_used or 0) + 1
        record.last_seen_at = utc_now()
    session.add(
        GuestUsageEvent(
            guest_id=guest_id,
            source=source,
            route=route,
            ip_hash=hash_client_ip(ip),
            estimated_total_tokens=max(0, estimated_total_tokens),
            estimated_cost=max(0.0, estimated_cost),
        )
    )
    await session.flush()
