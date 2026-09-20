"""Recruiting / ATS domain models."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.common import new_id, utc_now


class RecruitJob(SQLModel, table=True):
    __tablename__ = "recruit_jobs"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    title: str = Field(index=True)
    department: str = Field(default="", index=True)
    location: str = Field(default="", index=True)
    employment_type: str = Field(default="full-time", index=True)
    status: str = Field(default="draft", index=True)
    hiring_manager: str = ""
    recruiter: str = ""
    priority: str = Field(default="medium", index=True)
    headcount: int = 1
    description: str = ""
    requirements: str = ""
    stage_config_json: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    tags_json: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now, index=True)


class RecruitCandidate(SQLModel, table=True):
    __tablename__ = "recruit_candidates"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    job_id: str = Field(foreign_key="recruit_jobs.id", index=True)
    full_name: str = Field(index=True)
    email: str = Field(default="", index=True)
    phone: str = ""
    current_company: str = ""
    location: str = ""
    source_channel: str = Field(default="manual", index=True)
    status: str = Field(default="active", index=True)
    current_stage: str = Field(default="applied", index=True)
    ranking: str = Field(default="review", index=True)
    portfolio_url: str = ""
    linkedin_url: str = ""
    summary: str = ""
    notes: str = ""
    tags_json: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now, index=True)


class RecruitResume(SQLModel, table=True):
    __tablename__ = "recruit_resumes"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    candidate_id: str = Field(foreign_key="recruit_candidates.id", index=True)
    filename: str = ""
    mime_type: str = Field(default="", index=True)
    content_hash: str = Field(default="", index=True)
    route_mode: str = Field(default="text", index=True)
    processing_status: str = Field(default="parsed", index=True)
    parsed_text: str = ""
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now, index=True)


class RecruitScreeningResult(SQLModel, table=True):
    __tablename__ = "recruit_screening_results"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    candidate_id: str = Field(foreign_key="recruit_candidates.id", index=True)
    job_id: str = Field(foreign_key="recruit_jobs.id", index=True)
    total_score: int = Field(default=0, index=True)
    max_score: int = 100
    recommendation: str = Field(default="", index=True)
    evaluation_mode: str = Field(default="ai", index=True)
    overall_summary: str = ""
    matched_signals_json: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    strengths_json: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    risks_json: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    interview_questions_json: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    dimension_scores_json: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    evidence_excerpt: str = ""
    raw_result_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)


class RecruitInterview(SQLModel, table=True):
    __tablename__ = "recruit_interviews"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    candidate_id: str = Field(foreign_key="recruit_candidates.id", index=True)
    job_id: str = Field(foreign_key="recruit_jobs.id", index=True)
    interview_type: str = Field(default="onsite", index=True)
    stage: str = Field(default="screen", index=True)
    interviewer: str = Field(default="", index=True)
    scheduled_at: datetime | None = Field(default=None, index=True)
    decision: str = Field(default="", index=True)
    score: int | None = Field(default=None, index=True)
    notes: str = ""
    summary: str = ""
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)
    updated_at: datetime = Field(default_factory=utc_now, index=True)


class RecruitInterviewQuestionSet(SQLModel, table=True):
    __tablename__ = "recruit_interview_question_sets"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    candidate_id: str = Field(foreign_key="recruit_candidates.id", index=True)
    job_id: str = Field(foreign_key="recruit_jobs.id", index=True)
    screening_result_id: str | None = Field(default=None, foreign_key="recruit_screening_results.id", index=True)
    title: str = ""
    questions_json: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    source: str = Field(default="ai", index=True)
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)


class RecruitActivity(SQLModel, table=True):
    __tablename__ = "recruit_activities"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    candidate_id: str | None = Field(default=None, foreign_key="recruit_candidates.id", index=True)
    job_id: str | None = Field(default=None, foreign_key="recruit_jobs.id", index=True)
    activity_type: str = Field(default="", index=True)
    message: str = ""
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_by: str | None = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)


class RecruitMetric(SQLModel, table=True):
    __tablename__ = "recruit_metrics"

    id: str = Field(default_factory=new_id, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    team_id: str | None = Field(default=None, foreign_key="teams.id", index=True)
    project_id: str | None = Field(default=None, foreign_key="projects.id", index=True)
    metric_name: str = Field(index=True)
    dimension_key: str = Field(default="", index=True)
    dimension_value: str = Field(default="", index=True)
    metric_value: float = 0
    measured_at: datetime = Field(default_factory=utc_now, index=True)
