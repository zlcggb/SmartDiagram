"""Database connection and initialization."""

from sqlmodel import SQLModel
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def import_model_modules() -> None:
    """Import table modules so SQLModel metadata is complete in every process."""

    from app.models import audit, conversation, diagram, export, guest, knowledge, model_pricing, model_usage, platform_guest_quota, platform_quota, platform_role, project, tenant, usage  # noqa: F401


import_model_modules()


async def init_db():
    """Create all tables on startup."""
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session() -> AsyncSession:
    """Dependency for getting an async DB session."""
    async with async_session() as session:
        yield session
