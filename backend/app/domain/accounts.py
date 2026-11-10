from dataclasses import dataclass
from pydantic import BaseModel, ConfigDict, Field, field_validator


class Account(BaseModel):
    user_id: str
    username: str
    display_name: str


@dataclass(frozen=True)
class AccountCredentials:
    account: Account
    salt: str
    password_hash: str


class LoginRequest(BaseModel):
    # Passwords must not be stripped or normalized.
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_]+$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.lower()


class RegisterRequest(LoginRequest):
    display_name: str = Field(min_length=1, max_length=40)

    @field_validator("display_name")
    @classmethod
    def check_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("昵称不能为空")
        return value
