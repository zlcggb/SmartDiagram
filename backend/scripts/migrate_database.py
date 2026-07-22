"""Apply the SmartDiagram database's non-destructive schema bootstrap.

The application currently uses SQLModel metadata rather than Alembic.  This
command deliberately performs only ``CREATE TABLE IF NOT EXISTS`` style work:
it creates tables that are missing and verifies that every mapped table is
visible afterwards.  It never drops tables, columns, or rows.

Future changes to existing columns must be shipped as explicit, reviewed
incremental migrations before this command is extended to run them.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import inspect, text

from app.core.db import engine, import_model_modules


async def migrate() -> None:
    import_model_modules()

    from sqlmodel import SQLModel

    # Serialize deploy-time schema work across multiple application instances.
    async with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            await connection.execute(
                text("SELECT pg_advisory_xact_lock(hashtext('smartdiagram_schema_migration'))")
            )

        await connection.run_sync(SQLModel.metadata.create_all)

    async with engine.connect() as connection:
        table_names = set(await connection.run_sync(lambda sync: inspect(sync).get_table_names()))

    expected = set(SQLModel.metadata.tables)
    missing = sorted(expected - table_names)
    if missing:
        raise RuntimeError(f"database migration incomplete; missing tables: {', '.join(missing)}")

    print(f"SmartDiagram database schema ready ({len(expected)} mapped tables, no data removed)")


if __name__ == "__main__":
    asyncio.run(migrate())
