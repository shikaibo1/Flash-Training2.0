from typing import Annotated
from fastapi import APIRouter, Depends, Request, Query
from ..application.evidence import EvidenceService
from ..domain.models import LearningRecommendations
from ..domain.evidence_views import EvidenceDashboard
from .auth import CurrentAccount
from ..application.evidence_timeline import EvidenceTimelineService
from ..domain.goal_graph import EvidenceTimeline

router = APIRouter(prefix="/api/v2", tags=["evidence"])


def evidence_service(request: Request) -> EvidenceService:
    return request.app.state.services.evidence


Evidence = Annotated[EvidenceService, Depends(evidence_service)]


@router.get("/evidence", response_model=EvidenceDashboard)
def dashboard(service: Evidence, account: CurrentAccount) -> EvidenceDashboard:
    return service.dashboard(account.user_id)


@router.get("/recommendations", response_model=LearningRecommendations)
def recommendations(service: Evidence, account: CurrentAccount) -> LearningRecommendations:
    return service.recommendations(account.user_id)


def timeline_service(request: Request) -> EvidenceTimelineService:
    return request.app.state.services.timeline


@router.get('/evidence/atoms/{atom_id}/timeline', response_model=EvidenceTimeline)
def timeline(atom_id: str, account: CurrentAccount,
             service: Annotated[EvidenceTimelineService, Depends(timeline_service)],
             context: str | None = Query(default=None, max_length=200),
             project_id: str | None = Query(default=None, min_length=1, max_length=200),
             offset: int = Query(default=0, ge=0), limit: int = Query(default=20, ge=1, le=100)) -> EvidenceTimeline:
    return service.timeline(account.user_id, atom_id, context, project_id, offset, limit)
