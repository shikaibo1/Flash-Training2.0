from typing import Annotated
from fastapi import APIRouter, Depends, Request
from ..application.evidence import EvidenceService
from ..domain.models import LearningRecommendations
from ..domain.evidence_views import EvidenceDashboard
from .auth import CurrentAccount

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
