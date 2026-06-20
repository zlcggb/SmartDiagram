"""Conversation and message persistence models."""

from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now
from datetime import datetime


class Conversation(SQLModel, table=True):
    """A user-visible Agent conversation."""

    __tablename__ = "conversations"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    title: str = Field(default="", index=True)
    status: str = Field(default="active", index=True)
    summary: str = ""
    current_diagram_version_id: str | None = Field(default=None, index=True)
    context_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class Message(SQLModel, table=True):
    """A conversation message from user, assistant, or system."""

    __tablename__ = "messages"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    conversation_id: str = Field(foreign_key="conversations.id", index=True)
    role: str = Field(index=True)
    content: str = ""
    engine_type: str | None = Field(default=None, index=True)
    task_type: str | None = Field(default=None, index=True)
    diagram_version_id: str | None = Field(default=None, index=True)
    attachments_json: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)

