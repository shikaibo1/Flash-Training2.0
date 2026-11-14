from typing import Annotated
from fastapi import APIRouter, Depends, Request
from ..application.graph import GraphService
from ..domain.catalog import GraphResponse
from ..domain.goal_graph import ProjectGraphPlan
from .auth import CurrentAccount

router = APIRouter(prefix="/api/v2", tags=["graph"])


def graph_service(request: Request) -> GraphService:
    return request.app.state.services.graph


@router.get("/graph", response_model=GraphResponse)
def graph(service: Annotated[GraphService, Depends(graph_service)]) -> GraphResponse:
    return service.graph()


@router.get('/graph/projects/{project_id}', response_model=ProjectGraphPlan)
def project_graph(project_id: str, account: CurrentAccount,
                  service: Annotated[GraphService, Depends(graph_service)]) -> ProjectGraphPlan:
    return service.project_plan(account.user_id, project_id)
