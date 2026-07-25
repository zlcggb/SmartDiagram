"""Cross-tenant platform roles persisted in the database."""

from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now

PLATFORM_ROLE_ADMIN = "platform_admin"


class UserPlatformRole(SQLModel, table=True):
    """Platform-wide role assignment (not tenant-scoped)."""

    __tablename__ = "user_platform_roles"
    __table_args__ = (
        UniqueConstraint("user_id", "role", name="uq_user_platform_role"),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    role: str = Field(default=PLATFORM_ROLE_ADMIN, index=True)
    source: str = Field(default="manual", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)
