"""Read contracts join legacy evidence and the richer learning-project observations."""
from pydantic import Field
from .models import Model, AtomicEvidenceSummary, EvidenceRecord
from .projects import ProjectObservation


class EvidenceDashboard(Model):
    atomic_skills: list[AtomicEvidenceSummary]
    recent_evidence: list[EvidenceRecord]
    project_observations: list[ProjectObservation] = Field(default_factory=list)
