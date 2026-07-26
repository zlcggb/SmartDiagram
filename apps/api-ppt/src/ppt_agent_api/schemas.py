from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


Stage = Literal["brief", "research", "outline", "search", "plan", "design", "ir", "export", "pipeline"]
StageStatus = Literal["start", "progress", "done", "error", "skip"]


class PipelineRequest(BaseModel):
    theme: str | None = None
    accentId: str | None = None
    surfaceId: str | None = None
    presentationStyle: Literal[
        "apple-minimal",
        "consulting",
        "data-story",
        "tech-architecture",
        "editorial",
    ] | None = None
    mode: Literal["draft", "standard", "visual"] = "standard"
    skipDesign: bool = False
    force: bool = False
    threadId: str | None = None


class ProgressEvent(BaseModel):
    stage: Stage
    status: StageStatus
    message: str
    current: int | None = None
    total: int | None = None
    slideId: str | None = None
    slideTitle: str | None = None
    delta: str | None = None
    chunkId: str | None = None
    subStage: str | None = None
    clearDelta: bool | None = None
    node: str | None = None
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ApiEnvelope(BaseModel):
    success: bool
    message: str
    data: Any = None


def ok(data: Any, message: str) -> dict[str, Any]:
    return ApiEnvelope(success=True, message=message, data=data).model_dump()


def fail(message: str, data: Any = None) -> dict[str, Any]:
    return ApiEnvelope(success=False, message=message, data=data).model_dump()
