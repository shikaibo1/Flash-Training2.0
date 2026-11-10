from __future__ import annotations
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

JsonObject = dict[str, JsonValue]
Score10 = Annotated[float, Field(ge=0, le=10, allow_inf_nan=False, strict=True)]
FeedbackText = Annotated[str, Field(min_length=1, max_length=5000)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AtomicSkill(Model):
    atomic_skill_id: str
    name: str
    description: str
    categories: list[str] = Field(default_factory=list)
    action: str = Field(min_length=1, max_length=2000)
    input_spec: str = Field(min_length=1, max_length=4000)
    output_spec: str = Field(min_length=1, max_length=4000)
    boundary: str = Field(min_length=1, max_length=4000)
    rubric: list[FeedbackText] = Field(min_length=1, max_length=10)
    knowledge_ids: list[str] = Field(default_factory=list)
    prerequisite_ids: list[str] = Field(default_factory=list)
    contexts: list[str] = Field(min_length=1, max_length=20)
    # Empty lists mean this older/custom definition has no authored conditions yet.
    trigger_conditions: list[FeedbackText] = Field(default_factory=list, max_length=10)
    applicability_conditions: list[FeedbackText] = Field(default_factory=list, max_length=10)
    common_misuses: list[FeedbackText] = Field(default_factory=list, max_length=10)
    clarification_conditions: list[FeedbackText] = Field(default_factory=list, max_length=10)
    version: int = Field(default=1, ge=1)


class Skill(Model):
    skill_id: str
    name: str
    display_name: str
    description: str
    generate_prompt: str = ""
    evaluate_prompt: str = ""
    enabled: bool = True
    default_params: JsonObject = Field(default_factory=dict)
    atomic_skills: list[str] = Field(default_factory=list)
    role_id: str = ""
    context: str = Field(default="通用", min_length=1, max_length=200)
    task_brief: str = ""
    deliverable: str = ""


class AgentStep(Model):
    agent: str
    method: Literal["model", "rule"]
    summary: str


class AtomEvidence(Model):
    atomic_skill_id: str
    status: Literal["observed", "not_observable"]
    score: Score10 | None = None
    quote: str = Field(default="", max_length=10000)
    reason: FeedbackText
    next_action: FeedbackText

    @model_validator(mode="after")
    def consistent_score(self):
        if (self.status == "observed") != (self.score is not None):
            raise ValueError("Observed evidence requires a score; unobservable evidence must have no score")
        return self


class EvidenceRecord(AtomEvidence):
    session_id: str
    context: str
    mode: Literal["guided", "independent", "transfer"]
    assistance_used: bool
    created_at: str


class ContextEvidence(Model):
    context: str
    status: Literal["unmeasured", "developing", "assisted", "independent", "uncertain"]
    evidence_count: int = 0
    independent_count: int = 0
    last_score: Score10 | None = None
    last_practice_time: str | None = None


class AtomicEvidenceSummary(Model):
    atomic_skill_id: str
    name: str
    contexts: list[ContextEvidence]
    transfer_observed: bool = False


class LearningRecommendation(Model):
    skill_id: str
    title: str
    context: str
    reason: str
    target_atomic_ids: list[str]


class LearningRecommendations(Model):
    recommendations: list[LearningRecommendation]
    agent_trace: list[AgentStep] = Field(default_factory=list)


class PracticeContent(Model):
    model_config = ConfigDict(extra="ignore", frozen=True, str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(min_length=1, max_length=20000)
    hint: str = Field(default="", max_length=10000)
    example_answer: str = Field(default="", max_length=30000)
    category: str = "通用"
    difficulty: str = "入门"
    materials: str = Field(min_length=1, max_length=30000)
    target_atomic_ids: list[str] = Field(min_length=1, max_length=10)
    agent_trace: list[AgentStep] = Field(default_factory=list)


class Evaluation(Model):
    model_config = ConfigDict(extra="ignore", frozen=True, str_strip_whitespace=True)
    score: Score10
    strengths: list[FeedbackText] = Field(min_length=1, max_length=20)
    improvements: list[FeedbackText] = Field(min_length=1, max_length=20)
    aiComment: str = Field(min_length=1, max_length=10000)
    atomic_skill_scores: dict[str, Score10] = Field(default_factory=dict)
    evidence: list[AtomEvidence] = Field(min_length=1, max_length=50)
    agent_trace: list[AgentStep] = Field(default_factory=list)


class PracticeSession(Model):
    session_id: str
    user_id: str
    skill_id: str
    content: PracticeContent
    skill_snapshot: Skill
    atom_snapshot: list[AtomicSkill]
    params: JsonObject = Field(default_factory=dict)
    status: Literal["active", "completed"] = "active"
    started_at: str
    completed_at: str | None = None
    result: Evaluation | None = None
    provenance: str = "live"


class PracticeRecord(Model):
    """Replay snapshot of the task, answer and contextual evidence."""
    record_id: str
    user_id: str
    skill_id: str
    score: float = Field(ge=0, le=100, allow_inf_nan=False)
    start_time: str
    end_time: str
    session_id: str | None = None
    skill_name: str = ""
    title: str = ""
    description: str = ""
    hint: str = ""
    example_answer: str = ""
    category: str = ""
    difficulty: str = ""
    materials: str = ""
    target_atomic_ids: list[str] = Field(default_factory=list)
    input_type: str = "text"
    transcript: str = ""
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    ai_comment: str = ""
    atomic_skill_scores: dict[str, float] | None = None
    atomic_skill_names: dict[str, str] | None = None
    provenance: str = "live"
    evidence: list[AtomEvidence] = Field(default_factory=list)
    agent_trace: list[AgentStep] = Field(default_factory=list)
    mode: str = "guided"
    context: str = "通用"
    assistance_used: bool = False
    bridge_case_id: str | None = None
    source_session_id: str | None = None


class AtomScore(AtomicSkill):
    score: Score10 | None = None
    current_score: Score10 | None = None


class SessionStarted(Model):
    session_id: str
    skill_id: str
    question: str
    content: PracticeContent
    start_time: str
    status: Literal["active"] = "active"
    atomic_skill_names: dict[str, str]
    mode: Literal["guided", "independent", "transfer"]
    atom_snapshot: list[AtomicSkill]
    agent_trace: list[AgentStep]
    bridge_case_id: str | None = None
    source_session_id: str | None = None


class Submission(Model):
    session_id: str
    evaluation_result: Evaluation
    record_id: str | None
    status: Literal["completed"] = "completed"


class SessionDetails(Model):
    session_id: str
    skill_id: str
    status: Literal["active", "completed"]
    content: PracticeContent
    start_time: str
    atomic_skill_names: dict[str, str]
    evaluation_result: Evaluation | None = None
    record_id: str | None = None
    answer: str | None = None
    mode: Literal["guided", "independent", "transfer"]
    atom_snapshot: list[AtomicSkill]
    agent_trace: list[AgentStep]
    bridge_case_id: str | None = None
    source_session_id: str | None = None


class SessionHistory(Model):
    session_id: str
    user_id: str
    skill_id: str
    content: PracticeContent
    question: str
    status: Literal["active", "completed"]
    start_time: str
    end_time: str | None
    final_result: Evaluation | None
    mode: Literal["guided", "independent", "transfer"]
    bridge_case_id: str | None = None
    source_session_id: str | None = None


class SkillStatistics(Model):
    practice_count: int = 0
    avg_score: float = 0.0
    last_score: float
    last_practice_time: str


class UserProfile(Model):
    user_id: str
    skills: dict[str, SkillStatistics]
    score_scale: Literal["0-100"] = "0-100"


class SkillProgress(Model):
    user_id: str
    skill_id: str
    practice_count: int
    avg_score: float
    score_scale: Literal["0-100"] = "0-100"


class SkillMapping(Model):
    skill_id: str
    skill_name: str
    atomic_skills: list[AtomScore]
