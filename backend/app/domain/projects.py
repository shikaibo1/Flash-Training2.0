"""Persistent learning state; definitions, observations and decisions stay separate."""
from typing import Literal
from pydantic import Field
from .models import Model, AtomicSkill, Skill, PracticeContent

Stage = Literal["initial", "probe", "verification"]
FindingState = Literal["supported", "gap", "uncertain"]

class Finding(Model):
    atomic_skill_id: str
    state: FindingState
    quote: str = Field(default="", max_length=2000)
    reason: str = Field(min_length=1, max_length=1500)
    next_action: str = Field(min_length=1, max_length=1000)
    issue: Literal["none", "missing_evidence", "explicit_error", "task_limitation"]

class Assessment(Model):
    findings: list[Finding] = Field(min_length=1, max_length=10)
    summary: str = Field(min_length=1, max_length=2000)
    probe_question: str = Field(default="", max_length=280)
    probe_atom_id: str = ""
    probe_value: Literal["low", "high"] = "low"
    decision_reason: str = Field(min_length=1, max_length=1000)

class LearningRound(Model):
    round_id: str
    stage: Stage
    content: PracticeContent
    target_ids: list[str]
    answer: str = ""
    draft: str = ""
    draft_number: int = 0
    assistance_used: bool = False
    assessment: Assessment | None = None
    numeric_answer: float | None = None
    expected_value: float | None = None
    variant: int | None = None

class Intervention(Model):
    atomic_skill_id: str = ""
    level: Literal["hint", "explain", "micro"]
    title: str = Field(min_length=1, max_length=500)
    text: str = Field(min_length=1, max_length=8000)
    exercise: str = Field(default="", max_length=4000)
    source: str = Field(default="教学解释；请结合原材料检查适用范围。", max_length=1000)

class LearningEvent(Model):
    event_id: str
    kind: str
    created_at: str
    summary: str
    round_id: str | None = None
    decision: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)

class LearningProject(Model):
    project_id: str
    user_id: str
    goal: str
    background: str
    deliverable: str
    source_text: str
    status: Literal["pending", "ready", "answering", "probing", "support", "review", "completed"]
    scope_note: str
    skill: Skill | None = None
    atoms: list[AtomicSkill] = Field(default_factory=list)
    rounds: list[LearningRound] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    interventions: list[Intervention] = Field(default_factory=list)
    events: list[LearningEvent] = Field(default_factory=list)
    decision_reason: str = ""
    probe_limit: int = 2
    probes_used: int = 0
    cycle: int = 0
    revision: int = 0
    created_at: str
    updated_at: str

class ProjectObservation(Model):
    observation_id: str
    project_id: str
    round_id: str
    user_id: str
    atomic_skill_id: str
    context: str
    stage: Stage
    assistance_used: bool
    finding: Finding
    created_at: str

class ProjectView(Model):
    project: LearningProject

class ProjectList(Model):
    projects: list[LearningProject]
