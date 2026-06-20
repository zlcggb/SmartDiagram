"""Export job and asset models."""

from datetime import datetime
from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now


class ExportJob(SQLModel, table=True):
    """Asynchronous or synchronous export job."""

    __tablename__ = "export_jobs"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    diagram_id: str = Field(foreign_key="diagrams.id", index=True)
    diagram_version_id: str = Field(foreign_key="diagram_versions.id", index=True)
    requested_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    format: str = Field(index=True)
    status: str = Field(default="queued", index=True)
    error_message: str = ""
    options_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    result_asset_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)
    started_at: datetime | None = Field(default=None, index=True)
    ended_at: datetime | None = Field(default=None, index=True)


class ExportAsset(SQLModel, table=True):
    """Stored export file asset."""

    __tablename__ = "export_assets"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    diagram_id: str = Field(foreign_key="diagrams.id", index=True)
    diagram_version_id: str = Field(foreign_key="diagram_versions.id", index=True)
    export_job_id: str | None = Field(default=None, foreign_key="export_jobs.id", index=True)
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    format: str = Field(index=True)
    storage_key: str = Field(index=True)
    mime_type: str = ""
    file_size: int = 0
    checksum: str = Field(default="", index=True)
    visibility: str = Field(default="private", index=True)
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)


class ExportPresignedURL(SQLModel, table=True):
    """Short-lived URL issued for an export asset."""

    __tablename__ = "export_presigned_urls"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    asset_id: str = Field(foreign_key="export_assets.id", index=True)
    requested_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    url_hash: str = Field(index=True)
    expires_at: datetime = Field(index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)
