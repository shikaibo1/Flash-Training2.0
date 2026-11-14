from typing import Literal
from .models import Model, ContextEvidence, LearningRecommendation
from .catalog import GraphResponse


class GoalAtomState(ContextEvidence):
    atomic_skill_id: str


class ProjectGraphPlan(Model):
    project_id: str
    goal: str
    context: str | None
    task_id: str | None
    status: str
    scope_note: str
    graph: GraphResponse
    target_atom_ids: list[str]
    prerequisite_atom_ids: list[str]
    states: list[GoalAtomState]
    recommendations: list[LearningRecommendation]
    warnings: list[str]


class EvidenceTimelineItem(Model):
    id: str
    source: Literal['practice', 'project']
    context: str
    stage: Literal['practice', 'initial', 'probe', 'verification']
    mode: str | None
    assistance_used: bool
    status: Literal['unmeasured', 'developing', 'assisted', 'independent', 'uncertain']
    quote: str
    reason: str
    next_action: str
    created_at: str
    score: float | None
    session_id: str | None = None
    skill_id: str | None = None
    project_id: str | None = None
    round_id: str | None = None
    title: str
    definition_version: int | None = None


class EvidenceTimeline(Model):
    atomic_skill_id: str
    items: list[EvidenceTimelineItem]
    contexts: list[str]
    total: int
    offset: int
    limit: int
