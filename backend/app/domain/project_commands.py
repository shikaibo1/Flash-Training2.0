from typing import Literal
from pydantic import Field, model_validator
from .commands import RequestModel, Identifier
from .planning import LearningPlan

class ProjectCreateInput(RequestModel):
    request_id: Identifier
    goal: str = Field(min_length=2, max_length=1000)
    background: str = Field(default="", max_length=3000)
    deliverable: str = Field(default="", max_length=2000)
    source_text: str = Field(default="", max_length=30000)
    task_id: str | None = None

    probe_limit: int = Field(default=2, ge=0, le=2, strict=True)

class ProjectCreate(ProjectCreateInput):
    user_id: Identifier


class ProjectActionInput(RequestModel):
    request_id: Identifier
    revision: int = Field(ge=0, strict=True)
    action: Literal["start", "answer", "skip", "help", "verify", "retry", "finish", "bind", "reflect", "plan", "save_plan", "confirm_plan"]
    plan: LearningPlan | None = None
    answer: str = Field(default="", max_length=20000)
    round_id: str | None = None
    numeric_answer: float | None = Field(default=None, allow_inf_nan=False)
    assistance_used: bool = Field(default=False, strict=True)
    level: Literal["hint", "explain", "micro"] = "hint"
    atomic_skill_id: Identifier | None = None
    task_id: str | None = None

    @model_validator(mode='after')
    def plan_payload(self):
        if (self.action == 'save_plan') != (self.plan is not None):
            raise ValueError('仅保存方案时提交 plan，确认操作使用服务器保存的方案')
        return self

class ProjectAction(ProjectActionInput):
    user_id: Identifier


class ProjectDraftInput(RequestModel):
    round_id: Identifier
    revision: int = Field(ge=0, strict=True)
    text: str = Field(max_length=20000)
    draft_number: int = Field(ge=1, strict=True)
    assistance_used: bool = Field(default=False, strict=True)
    numeric_answer: float | None = Field(default=None, allow_inf_nan=False)


class ProjectDraft(ProjectDraftInput):
    user_id: Identifier
