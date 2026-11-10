import hashlib
import hmac
import secrets
import time
from uuid import uuid4
from ..domain.accounts import Account, AccountCredentials, LoginRequest, RegisterRequest
from ..domain.ports import UnitOfWorkFactory
from ..errors import AppError

SESSION_SECONDS = 30 * 24 * 60 * 60


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def password_digest(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 600_000).hex()


class AuthService:
    def __init__(self, work: UnitOfWorkFactory):
        self._work = work

    def limit_attempts(self, client_address: str) -> None:
        # The transaction commits even when the subsequent request is rejected.
        with self._work.write() as unit:
            allowed = unit.users.allow_auth_attempt(token_digest(client_address), int(time.time()))
        if not allowed:
            raise AppError("尝试过于频繁，请一分钟后再试。", 429, "auth_rate_limited")

    def register(self, command: RegisterRequest, old_token: str | None) -> tuple[Account, str]:
        account = Account(user_id=uuid4().hex, username=command.username, display_name=command.display_name)
        salt = secrets.token_hex(16)
        credentials = AccountCredentials(account, salt, password_digest(command.password, salt))
        token, now = secrets.token_urlsafe(32), int(time.time())
        with self._work.write() as unit:
            if unit.users.account(command.username):
                raise AppError("用户名已被使用，请换一个。", 409, "username_taken")
            unit.users.add_account(credentials)
            if old_token:
                unit.users.delete_session(token_digest(old_token))
            unit.users.add_session(token_digest(token), account.user_id, now + SESSION_SECONDS, now)
        return account, token

    def login(self, command: LoginRequest, old_token: str | None) -> tuple[Account, str]:
        with self._work.read() as unit:
            credentials = unit.users.account(command.username)
        # Unknown accounts still perform the password derivation.
        salt = credentials.salt if credentials else "00" * 16
        candidate = password_digest(command.password, salt)
        expected = credentials.password_hash if credentials else "00" * 32
        if not hmac.compare_digest(candidate, expected) or credentials is None:
            raise AppError("用户名或密码不正确。", 401, "invalid_credentials")
        token, now = secrets.token_urlsafe(32), int(time.time())
        with self._work.write() as unit:
            if old_token:
                unit.users.delete_session(token_digest(old_token))
            unit.users.add_session(token_digest(token), credentials.account.user_id, now + SESSION_SECONDS, now)
        return credentials.account, token

    def current(self, token: str | None) -> Account:
        if token and len(token) <= 128:
            with self._work.read() as unit:
                account = unit.users.session_account(token_digest(token), int(time.time()))
            if account:
                return account
        raise AppError("请先登录，或重新登录以继续学习。", 401, "authentication_required")

    def logout(self, token: str | None) -> None:
        if token:
            with self._work.write() as unit:
                unit.users.delete_session(token_digest(token))
