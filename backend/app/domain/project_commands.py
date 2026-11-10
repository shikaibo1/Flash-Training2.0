from typing import Literal
from pydantic import Field
from .commands import RequestModel, Identifier

class ProjectCreate(RequestModel):
    user_id: Identifier = "default_user"
    request_id: Identifier
    goal: str = Field(min_length=2, max_length=1000)
    background: str = Field(default="", max_length=3000)
    deliverable: str = Field(default="", max_length=2000)
    source_text: str = Field(default="", max_length=30000)
    task_id: str | None = None
    probe_limit: int = Field(default=2, ge=0, le=2, strict=True)

class ProjectAction(RequestModel):
    user_id: Identifier = "default_user"
    request_id: Identifier
    revision: int = Field(ge=0, strict=True)
    action: Literal["start", "answer", "skip", "help", "verify", "retry", "finish", "bind", "reflect"]
    answer: str = Field(default="", max_length=20000)
    round_id: str | None = None
    numeric_answer: float | None = Field(default=None, allow_inf_nan=False)
    assistance_used: bool = Field(default=False, strict=True)
    level: Literal["hint", "explain", "micro"] = "hint"
    atomic_skill_id: Identifier | None = None
    task_id: str | None = None

class ProjectDraft(RequestModel):
    user_id: Identifier = "default_user"
    round_id: Identifier
    revision: int = Field(ge=0, strict=True)
    text: str = Field(max_length=20000)
    draft_number: int = Field(ge=1, strict=True)
    assistance_used: bool = Field(default=False, strict=True)
    numeric_answer: float | None = Field(default=None, allow_inf_nan=False)
