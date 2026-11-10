from typing import Annotated
from fastapi import APIRouter, Depends, Request, Response
from ..application.auth import AuthService, SESSION_SECONDS
from ..domain.accounts import Account, LoginRequest, RegisterRequest
from ..errors import AppError
from .responses import MessageResponse

COOKIE_NAME = "flash_session"


def auth_service(request: Request) -> AuthService:
    return request.app.state.services.auth


Auth = Annotated[AuthService, Depends(auth_service)]


def browser_request(request: Request) -> None:
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if request.headers.get("x-requested-with") != "FlashTrain" or (
            origin and origin not in request.app.state.settings.cors_origins
        ):
            raise AppError("请求来源无效，请从学习页面重新操作。", 403, "invalid_origin")


def current_account(request: Request, service: Auth) -> Account:
    browser_request(request)
    account = service.current(request.cookies.get(COOKIE_NAME))
    expected = request.headers.get("x-account-id")
    # A tab opened under account A must not write to B after another tab logs in.
    if expected and expected != account.user_id:
        raise AppError("账号已在其他窗口切换，请重新进入学习空间。", 401, "account_changed")
    return account


CurrentAccount = Annotated[Account, Depends(current_account)]
router = APIRouter(prefix="/api/auth", tags=["accounts"], dependencies=[Depends(browser_request)])


def set_session(response: Response, request: Request, token: str) -> None:
    response.set_cookie(COOKIE_NAME, token, max_age=SESSION_SECONDS, httponly=True,
        secure=request.app.state.settings.auth_cookie_secure, samesite="lax", path="/api")
    response.headers["Cache-Control"] = "no-store"


@router.post("/register", response_model=Account, status_code=201)
def register(body: RegisterRequest, request: Request, response: Response, service: Auth) -> Account:
    service.limit_attempts(request.client.host if request.client else "unknown")
    account, token = service.register(body, request.cookies.get(COOKIE_NAME))
    set_session(response, request, token)
    return account


@router.post("/login", response_model=Account)
def login(body: LoginRequest, request: Request, response: Response, service: Auth) -> Account:
    service.limit_attempts(request.client.host if request.client else "unknown")
    account, token = service.login(body, request.cookies.get(COOKIE_NAME))
    set_session(response, request, token)
    return account


@router.get("/me", response_model=Account)
def me(account: CurrentAccount, response: Response) -> Account:
    response.headers["Cache-Control"] = "no-store"
    return account


@router.post("/logout", response_model=MessageResponse)
def logout(request: Request, response: Response, service: Auth) -> MessageResponse:
    token = request.cookies.get(COOKIE_NAME)
    expected = request.headers.get("x-account-id")
    if token and expected:
        try:
            account = service.current(token)
        except AppError as error:
            if error.code != "authentication_required":
                raise
        else:
            if account.user_id != expected:
                raise AppError("账号已在其他窗口切换，请刷新页面。", 401, "account_changed")
    service.logout(token)
    response.delete_cookie(COOKIE_NAME, path="/api", httponly=True,
        secure=request.app.state.settings.auth_cookie_secure, samesite="lax")
    response.headers["Cache-Control"] = "no-store"
    return MessageResponse(message="已退出登录")
