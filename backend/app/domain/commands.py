from __future__ import annotations
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, field_validator
from .models import JsonObject

Identifier = Annotated[str, Field(min_length=1, max_length=200)]
FeedbackText = Annotated[str, Field(min_length=1, max_length=5000)]


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class GenerateRequest(RequestModel):
    skill_id: Identifier
    params: JsonObject = Field(default_factory=dict)


class StartRequest(GenerateRequest):
    """The authenticated account is supplied by the API, never the request body."""


class SubmitRequest(RequestModel):
    session_id: Identifier
    answer: str = Field(min_length=1, max_length=50000)
    assistance_used: bool = Field(default=False, strict=True)


class EvaluateRequest(GenerateRequest):
    content: str = Field(min_length=1, max_length=50000)
    reference: str = Field(default="", max_length=40000)


class SkillCreate(RequestModel):
    name: str = Field(min_length=1, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=10000)
    generate_prompt: str = Field(default="", max_length=20000)
    evaluate_prompt: str = Field(default="", max_length=20000)
    atomic_skills: list[Identifier] = Field(min_length=1, max_length=10)
    default_params: JsonObject = Field(default_factory=dict)
    role_id: str = ""
    context: str = Field(default="通用", min_length=1, max_length=200)
    task_brief: str = Field(min_length=1, max_length=10000)
    deliverable: str = Field(min_length=1, max_length=4000)


class SkillPatch(RequestModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, min_length=1, max_length=10000)
    generate_prompt: str | None = Field(default=None, max_length=20000)
    evaluate_prompt: str | None = Field(default=None, max_length=20000)
    enabled: bool | None = None
    atomic_skills: list[Identifier] | None = Field(default=None, min_length=1, max_length=10)
    default_params: JsonObject | None = None
    role_id: str | None = None
    context: str | None = Field(default=None, min_length=1, max_length=200)
    task_brief: str | None = Field(default=None, min_length=1, max_length=10000)
    deliverable: str | None = Field(default=None, min_length=1, max_length=4000)

    @field_validator("display_name", "description", "generate_prompt", "evaluate_prompt",
                     "enabled", "atomic_skills", "default_params", "role_id", "context", "task_brief", "deliverable")
    @classmethod
    def no_explicit_null(cls, value):
        if value is None:
            raise ValueError("Omit a field instead of setting it to null")
        return value


class AtomicCreate(RequestModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=10000)
    categories: list[str] = Field(default_factory=list, max_length=50)
    action: str = Field(min_length=1, max_length=2000)
    input_spec: str = Field(min_length=1, max_length=4000)
    output_spec: str = Field(min_length=1, max_length=4000)
    boundary: str = Field(min_length=1, max_length=4000)
    rubric: list[FeedbackText] = Field(min_length=1, max_length=10)
    knowledge_ids: list[Identifier] = Field(default_factory=list, max_length=30)
    prerequisite_ids: list[Identifier] = Field(default_factory=list, max_length=20)
    contexts: list[Identifier] = Field(min_length=1, max_length=20)
    trigger_conditions: list[FeedbackText] = Field(default_factory=list, max_length=10)
    applicability_conditions: list[FeedbackText] = Field(default_factory=list, max_length=10)
    common_misuses: list[FeedbackText] = Field(default_factory=list, max_length=10)
    clarification_conditions: list[FeedbackText] = Field(default_factory=list, max_length=10)


class CustomSkillRequest(RequestModel):
    skill_name: str = Field(min_length=1, max_length=200)
