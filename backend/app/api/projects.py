from typing import Annotated
from fastapi import APIRouter, Depends, Request
from ..application.projects import ProjectService
from ..domain.project_commands import (ProjectCreate, ProjectAction, ProjectDraft,
                                      ProjectCreateInput, ProjectActionInput, ProjectDraftInput)
from .auth import CurrentAccount
from ..domain.projects import ProjectView, ProjectList

router = APIRouter(prefix="/api/v3/projects", tags=["learning-projects"])


def project_service(request: Request) -> ProjectService:
    return request.app.state.services.projects


Projects = Annotated[ProjectService, Depends(project_service)]


@router.post("", response_model=ProjectView, status_code=201)
def create(body: ProjectCreateInput, svc: Projects, account: CurrentAccount) -> ProjectView:
    return ProjectView(project=svc.create(ProjectCreate(**body.model_dump(), user_id=account.user_id)))


@router.get("", response_model=ProjectList)
def list_projects(svc: Projects, account: CurrentAccount) -> ProjectList:
    return ProjectList(projects=svc.list(account.user_id))


@router.get("/{project_id}", response_model=ProjectView)
def get(project_id: str, svc: Projects, account: CurrentAccount) -> ProjectView:
    return ProjectView(project=svc.get(project_id, account.user_id))


@router.post("/{project_id}/actions", response_model=ProjectView)
def action(project_id: str, body: ProjectActionInput, svc: Projects, account: CurrentAccount) -> ProjectView:
    return ProjectView(project=svc.act(project_id, ProjectAction(**body.model_dump(), user_id=account.user_id)))


@router.post("/{project_id}/draft", response_model=ProjectView)
def draft(project_id: str, body: ProjectDraftInput, svc: Projects, account: CurrentAccount) -> ProjectView:
    return ProjectView(project=svc.draft(project_id, ProjectDraft(**body.model_dump(), user_id=account.user_id)))
