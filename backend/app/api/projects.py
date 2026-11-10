from typing import Annotated
from fastapi import APIRouter, Depends, Request
from ..application.projects import ProjectService
from ..domain.project_commands import ProjectCreate, ProjectAction, ProjectDraft
from ..domain.projects import ProjectView, ProjectList

router = APIRouter(prefix="/api/v3/projects", tags=["learning-projects"])


def project_service(request: Request) -> ProjectService:
    return request.app.state.services.projects


Projects = Annotated[ProjectService, Depends(project_service)]


@router.post("", response_model=ProjectView, status_code=201)
def create(body: ProjectCreate, svc: Projects) -> ProjectView:
    return ProjectView(project=svc.create(body))


@router.get("", response_model=ProjectList)
def list_projects(svc: Projects, user_id: str = "default_user") -> ProjectList:
    return ProjectList(projects=svc.list(user_id))


@router.get("/{project_id}", response_model=ProjectView)
def get(project_id: str, svc: Projects, user_id: str = "default_user") -> ProjectView:
    return ProjectView(project=svc.get(project_id, user_id))


@router.post("/{project_id}/actions", response_model=ProjectView)
def action(project_id: str, body: ProjectAction, svc: Projects) -> ProjectView:
    return ProjectView(project=svc.act(project_id, body))


@router.post("/{project_id}/draft", response_model=ProjectView)
def draft(project_id: str, body: ProjectDraft, svc: Projects) -> ProjectView:
    return ProjectView(project=svc.draft(project_id, body))
