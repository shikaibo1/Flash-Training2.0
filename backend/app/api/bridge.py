from __future__ import annotations
from typing import Annotated
from fastapi import APIRouter, Depends, Request
from pydantic import Field
from ..application.bridge import BridgeService
from ..domain.commands import Identifier, RequestModel
from ..domain.models import JsonObject
from .responses import Success

router = APIRouter(prefix="/api/v2/bridge", tags=["learning-bridge"])


class DiagnosisRequest(RequestModel):
    user_id: Identifier
    answers: dict[str, Annotated[str, Field(min_length=1, max_length=100)]] = Field(min_length=3, max_length=3)


def bridge_service(request: Request) -> BridgeService:
    return request.app.state.services.bridge


Bridge = Annotated[BridgeService, Depends(bridge_service)]


@router.get("/catalog", response_model=Success[JsonObject])
def get_catalog(svc: Bridge) -> Success[JsonObject]:
    return Success(data=svc.catalog())


@router.get("/sessions/{session_id}", response_model=Success[JsonObject])
def details(session_id: str, user_id: str, svc: Bridge) -> Success[JsonObject]:
    return Success(data=svc.details(user_id, session_id))


@router.post("/sessions/{session_id}/diagnosis", response_model=Success[JsonObject])
def diagnose(session_id: str, body: DiagnosisRequest, svc: Bridge) -> Success[JsonObject]:
    return Success(data=svc.diagnose(body.user_id, session_id, body.answers))
