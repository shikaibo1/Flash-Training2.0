"""Retired global-progress endpoints; v2 evidence is scoped by context."""
from fastapi import APIRouter
from ..errors import AppError
from .responses import ErrorResponse

router = APIRouter(prefix="/api/v1", tags=["learning-progress-retired"])


@router.get("/atomic/users/{user_id}/skills", status_code=410, response_model=ErrorResponse)
@router.get("/atomic/users/{user_id}/skills/{atomic_skill_id}/score", status_code=410, response_model=ErrorResponse)
@router.post("/atomic/users/{user_id}/skills/{atomic_skill_id}/score", status_code=410, response_model=ErrorResponse)
@router.post("/knowledge-tracing/update-mastery", status_code=410, response_model=ErrorResponse)
@router.get("/knowledge-tracing/mastery/all/{user_id}", status_code=410, response_model=ErrorResponse)
@router.get("/knowledge-tracing/mastery/{user_id}/{atomic_skill_id}", status_code=410, response_model=ErrorResponse)
@router.get("/knowledge-tracing/predict/{user_id}/{atomic_skill_id}", status_code=410, response_model=ErrorResponse)
@router.get("/knowledge-tracing/learning-curve/{user_id}/{atomic_skill_id}", status_code=410, response_model=ErrorResponse)
@router.get("/knowledge-tracing/recommendations/{user_id}", status_code=410, response_model=ErrorResponse)
@router.post("/atomic/optimize", status_code=410, response_model=ErrorResponse)
def retired_progress():
    raise AppError(
        "v1 全局得分、掌握度、预测、自评与优化接口已停用，不能用于职业行动证据。"
        "请登录后使用 /api/v2/evidence 查看场景证据，"
        "使用 /api/v2/recommendations 获取练习建议。",
        410,
        "global_progress_retired",
    )
