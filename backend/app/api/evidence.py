from typing import Annotated
from fastapi import APIRouter, Depends, Request
from ..application.evidence import EvidenceService
from ..domain.models import LearningRecommendations
from ..domain.evidence_views import EvidenceDashboard

router = APIRouter(prefix="/api/v2", tags=["evidence"])


def evidence_service(request: Request) -> EvidenceService:
    return request.app.state.services.evidence


Evidence = Annotated[EvidenceService, Depends(evidence_service)]


@router.get("/evidence/{user_id}", response_model=EvidenceDashboard)
def dashboard(user_id: str, service: Evidence) -> EvidenceDashboard:
    return service.dashboard(user_id)


@router.get("/recommendations/{user_id}", response_model=LearningRecommendations)
def recommendations(user_id: str, service: Evidence) -> LearningRecommendations:
    return service.recommendations(user_id)
