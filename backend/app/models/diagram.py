"""Diagram asset and version models."""

from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now
from datetime import datetime


class Diagram(SQLModel, table=True):
    """A logical diagram that can have multiple versions."""

    __tablename__ = "diagrams"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    conversation_id: str | None = Field(default=None, foreign_key="conversations.id", index=True)
    owner_user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    title: str = Field(default="", index=True)
    engine_type: str = Field(index=True)
    task_type: str = Field(index=True)
    visibility: str = Field(default="private", index=True)
    current_version_id: str | None = Field(default=None, index=True)
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class DiagramVersion(SQLModel, table=True):
    """Immutable generated or edited diagram version."""

    __tablename__ = "diagram_versions"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    diagram_id: str = Field(foreign_key="diagrams.id", index=True)
    conversation_id: str | None = Field(default=None, foreign_key="conversations.id", index=True)
    message_id: str | None = Field(default=None, foreign_key="messages.id", index=True)
    version_number: int = Field(default=1, index=True)
    engine_type: str = Field(index=True)
    task_type: str = Field(index=True)
    code: str = ""
    design_concept: str = ""
    validation_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    export_assets_json: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)

