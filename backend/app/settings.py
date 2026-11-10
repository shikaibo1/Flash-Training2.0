"""Configuration is resolved relative to backend/, never the shell's directory."""
import os
from dataclasses import dataclass, field
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    database_path: Path = BACKEND_DIR / "data" / "flash_training_v2.sqlite3"
    catalog_path: Path = BACKEND_DIR / "data" / "career_catalog.json"
    ai_api_key: str = field(default="", repr=False)
    ai_base_url: str = "https://api.openai.com/v1"
    ai_model: str = ""
    ai_api_style: str = "responses"
    ai_timeout: float = 60.0
    auth_cookie_secure: bool = False
    cors_origins: tuple[str, ...] = ("http://127.0.0.1:5173", "http://localhost:5173")

    @classmethod
    def from_env(cls):
        # EDIT GPT CONFIG HERE: backend/.env.ai; secrets never belong in frontend/.
        load_dotenv(BACKEND_DIR / ".env.ai", override=False)
        path = Path(os.getenv("FLASH_DATABASE_PATH", "data/flash_training_v2.sqlite3"))
        if not path.is_absolute():
            path = BACKEND_DIR / path
        style = os.getenv("AI_API_STYLE", "responses")
        if style not in {"responses", "chat_completions"}:
            raise ValueError("AI_API_STYLE must be responses or chat_completions")
        timeout = float(os.getenv("AI_TIMEOUT_SECONDS", "60"))
        if not 1 <= timeout <= 300:
            raise ValueError("AI_TIMEOUT_SECONDS must be between 1 and 300")
        return cls(database_path=path.resolve(),
                   ai_api_key=os.getenv("OPENAI_API_KEY", ""),
                   ai_base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
                   ai_model=os.getenv("OPENAI_MODEL", ""), ai_api_style=style,
                   ai_timeout=timeout,
                   auth_cookie_secure=os.getenv("FLASH_AUTH_COOKIE_SECURE", "false").lower() == "true",
                   cors_origins=tuple(x.strip() for x in os.getenv(
                       "FLASH_CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
                   ).split(",") if x.strip()))
