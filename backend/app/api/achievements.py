from typing import Annotated
from fastapi import APIRouter, Depends, Request
from ..application.achievements import AchievementService
from ..domain.achievements import AchievementDashboard, AchievementSeen
from .auth import CurrentAccount


def achievement_service(request: Request) -> AchievementService:
    return request.app.state.services.achievements


Achievements = Annotated[AchievementService, Depends(achievement_service)]
router = APIRouter(prefix='/api/v2/achievements', tags=['achievements'])


@router.get('', response_model=AchievementDashboard)
def dashboard(account: CurrentAccount, service: Achievements) -> AchievementDashboard:
    return service.get(account.user_id)


@router.post('/sync', response_model=AchievementDashboard)
def sync(account: CurrentAccount, service: Achievements) -> AchievementDashboard:
    return service.sync(account.user_id)


@router.post('/seen', response_model=AchievementDashboard)
def seen(body: AchievementSeen, account: CurrentAccount, service: Achievements) -> AchievementDashboard:
    return service.seen(account.user_id, body.ids)
