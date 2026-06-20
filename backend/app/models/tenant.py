"""Tenant, user, and team models."""

from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now
from datetime import datetime


class Tenant(SQLModel, table=True):
    """Enterprise tenant boundary."""

    __tablename__ = "tenants"

    id: str = Field(default_factory=new_id, primary_key=True)
    name: str = Field(index=True)
    slug: str = Field(index=True)
    status: str = Field(default="active", index=True)
    settings_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class User(SQLModel, table=True):
    """User identity within a tenant."""

    __tablename__ = "users"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    email: str = Field(index=True)
    display_name: str = ""
    role: str = Field(default="member", index=True)
    status: str = Field(default="active", index=True)
    preferences_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class Team(SQLModel, table=True):
    """Team workspace inside a tenant."""

    __tablename__ = "teams"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    name: str = Field(index=True)
    description: str = ""
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    settings_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class TeamMember(SQLModel, table=True):
    """Team membership and role assignment."""

    __tablename__ = "team_members"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str = Field(foreign_key="teams.id", index=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    role: str = Field(default="member", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)

