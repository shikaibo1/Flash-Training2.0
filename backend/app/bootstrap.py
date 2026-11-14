"""The composition root is the only place connecting application and infrastructure."""
from dataclasses import dataclass
from .application.content import ContentService
from .application.skills import SkillService
from .application.practice import PracticeService
from .application.progress import ProgressService
from .application.records import RecordService
from .application.graph import GraphService
from .application.evidence import EvidenceService
from .application.bridge import BridgeService
from .application.projects import ProjectService
from .application.project_coach import ProjectCoach
from .application.auth import AuthService
from .application.evidence_timeline import EvidenceTimelineService
from .domain.ports import JSONClient, UnitOfWorkFactory


@dataclass(frozen=True)
class Services:
    auth: AuthService
    skills: SkillService
    practice: PracticeService
    progress: ProgressService
    records: RecordService
    graph: GraphService
    evidence: EvidenceService
    projects: ProjectService
    bridge: BridgeService
    timeline: EvidenceTimelineService


def build_services(work: UnitOfWorkFactory, client: JSONClient) -> Services:
    content = ContentService(client)
    return Services(AuthService(work), SkillService(work, content), PracticeService(work, content),
                    ProgressService(work), RecordService(work), GraphService(work), EvidenceService(work),
                    ProjectService(work, content, ProjectCoach(client)), BridgeService(work), EvidenceTimelineService(work))
