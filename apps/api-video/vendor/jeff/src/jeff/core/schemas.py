"""Wire models matching typesafe_sdk/_schemas/models.py; extra input fields are ignored."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .state import serialize_state

State = str | dict[str, Any] | list[Any]
JSONish = str | dict[str, Any] | list[Any]


def _text(v: Any) -> str | None:
    """Render a str | dict | list value to prompt text; None stays None."""
    if v is None:
        return None
    return serialize_state(v)


class _Question(BaseModel):
    instructions: JSONish | None = None

    def instructions_text(self) -> str | None:
        return _text(self.instructions)


class NoulCriteria(BaseModel):
    true: JSONish | None = None
    false: JSONish | None = None


class NoulQuestion(_Question):
    type: Literal["noul"]
    criteria: NoulCriteria | None = None

    def criterion(self, side: str) -> str | None:
        if self.criteria is None:
            return None
        return _text(getattr(self.criteria, side))


class ChoiceQuestion(_Question):
    type: Literal["choice"]
    # Wire schema: option name -> description (any JSON) or null.
    criteria: dict[str, JSONish | None]

    @field_validator("criteria")
    @classmethod
    def _at_least_one(cls, v):
        if len(v) < 1:
            raise ValueError("choice needs at least one option")
        return v

    def options(self) -> list[tuple[str, str | None]]:
        return [(k, _text(d)) for k, d in self.criteria.items()]


class ScoreQuestion(_Question):
    type: Literal["score"]
    criteria: list[JSONish] = Field(min_length=1)

    def levels(self) -> list[tuple[str, list[str] | None]]:
        """Return (label, examples) per level; unpack {what, examples}, render other values as text."""
        out = []
        for lv in self.criteria:
            if isinstance(lv, dict) and "what" in lv:
                ex = lv.get("examples")
                out.append((serialize_state(lv["what"]), [str(e) for e in ex] if isinstance(ex, list) else None))
            else:
                out.append((serialize_state(lv), None))
        return out

    def legend(self) -> dict[str, JSONish]:
        return {str(i): lv for i, lv in enumerate(self.criteria)}


Question = Annotated[NoulQuestion | ChoiceQuestion | ScoreQuestion, Field(discriminator="type")]


class SystemOneRequest(BaseModel):
    state: State
    model: str | None = None
    # Not in the wire schema but appears in one docs example; alias of model.
    selectedModels: list[str] | None = None
    questions: dict[str, Question] = Field(min_length=1)

    @model_validator(mode="after")
    def _resolve_model(self):
        if self.model is None:
            if self.selectedModels:
                self.model = self.selectedModels[0]
            else:
                raise ValueError("model is required")
        return self


class Usage(BaseModel):
    input_tokens: int
    output_tokens: int


class NoulAnswer(BaseModel):
    type: Literal["noul"] = "noul"
    noul: float


class ChoiceAnswer(BaseModel):
    type: Literal["choice"] = "choice"
    choice: str
    confidence: float
    probabilities: dict[str, float]


class ScoreAnswer(BaseModel):
    type: Literal["score"] = "score"
    score: float
    confidence: float
    legend: dict[str, JSONish]
    probabilities: dict[str, float]


Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer


class SystemOneResponse(BaseModel):
    model: str
    answers: dict[str, Answer]
    usage: Usage


class ModelMetadata(BaseModel):
    name: str
    description: str
    release_date: str


class ModelMetadataList(BaseModel):
    models: list[ModelMetadata]
