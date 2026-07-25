"""Enterprise knowledge base models for permission-aware RAG."""

from datetime import datetime
from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now


class KnowledgeSource(SQLModel, table=True):
    """A knowledge source such as upload, wiki, URL, or business system."""

    __tablename__ = "knowledge_sources"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    name: str = Field(index=True)
    source_type: str = Field(default="upload", index=True)
    status: str = Field(default="active", index=True)
    classification: str = Field(default="internal", index=True)
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    acl_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class KnowledgeDocument(SQLModel, table=True):
    """Original document record and object-storage pointer."""

    __tablename__ = "knowledge_documents"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    source_id: str = Field(foreign_key="knowledge_sources.id", index=True)
    title: str = Field(default="", index=True)
    original_filename: str = ""
    mime_type: str = Field(default="", index=True)
    storage_key: str = Field(default="", index=True)
    content_hash: str = Field(default="", index=True)
    status: str = Field(default="pending", index=True)
    classification: str = Field(default="internal", index=True)
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    acl_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class KnowledgeChunk(SQLModel, table=True):
    """Searchable document chunk with permission metadata."""

    __tablename__ = "knowledge_chunks"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    source_id: str = Field(foreign_key="knowledge_sources.id", index=True)
    document_id: str = Field(foreign_key="knowledge_documents.id", index=True)
    chunk_index: int = Field(default=0, index=True)
    heading_path: str = ""
    source_locator: str = ""
    text: str = ""
    summary: str = ""
    token_count: int = 0
    status: str = Field(default="active", index=True)
    classification: str = Field(default="internal", index=True)
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    acl_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class KnowledgeEmbedding(SQLModel, table=True):
    """Embedding registry for chunks stored in pgvector, Qdrant, or Milvus."""

    __tablename__ = "knowledge_embeddings"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    chunk_id: str = Field(foreign_key="knowledge_chunks.id", index=True)
    vector_store: str = Field(default="pgvector", index=True)
    vector_id: str = Field(default="", index=True)
    embedding_model: str = Field(default="", index=True)
    dimensions: int = 0
    status: str = Field(default="active", index=True)
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)


class KnowledgeACL(SQLModel, table=True):
    """Explicit ACL rule for knowledge resources."""

    __tablename__ = "knowledge_acl"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    resource_type: str = Field(index=True)
    resource_id: str = Field(index=True)
    subject_type: str = Field(index=True)
    subject_id: str = Field(index=True)
    effect: str = Field(default="allow", index=True)
    scopes_json: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)


class DiagramTemplate(SQLModel, table=True):
    """Governed enterprise diagram template for team/project reuse."""

    __tablename__ = "diagram_templates"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    name: str = Field(index=True)
    description: str = ""
    engine_type: str = Field(default="", index=True)
    task_type: str = Field(default="", index=True)
    visibility: str = Field(default="project", index=True)
    status: str = Field(default="active", index=True)
    priority: int = Field(default=0, index=True)
    tags_json: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    template_code: str = ""
    style_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    acl_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    usage_count: int = Field(default=0, index=True)
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class KnowledgeIngestionJob(SQLModel, table=True):
    """Background ingestion job state for parsing, chunking, and embeddings."""

    __tablename__ = "knowledge_ingestion_jobs"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    source_id: str | None = Field(default=None, foreign_key="knowledge_sources.id", index=True)
    document_id: str | None = Field(default=None, foreign_key="knowledge_documents.id", index=True)
    requested_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    status: str = Field(default="queued", index=True)
    stage: str = Field(default="queued", index=True)
    progress: float = 0.0
    error_message: str = ""
    stats_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now, index=True)
    started_at: datetime | None = Field(default=None, index=True)
    ended_at: datetime | None = Field(default=None, index=True)
