"""Project models and membership."""

from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now
from datetime import datetime


class Project(SQLModel, table=True):
    """A permission boundary for conversations, diagrams, and knowledge."""

    __tablename__ = "projects"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    name: str = Field(index=True)
    description: str = ""
    visibility: str = Field(default="private", index=True)
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    settings_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class ProjectMember(SQLModel, table=True):
    """Project-level access control."""

    __tablename__ = "project_members"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    project_id: str = Field(foreign_key="projects.id", index=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    role: str = Field(default="viewer", index=True)
    scopes_json: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)

