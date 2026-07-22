from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict


APP_ROOT = Path(__file__).resolve().parents[4]
load_dotenv(APP_ROOT / ".env", override=False)


class Settings(BaseSettings):
    """Runtime configuration shared by the gateway and graph runtime."""

    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    api_host: str = "127.0.0.1"
    api_port: int = 4000
    legacy_api_url: str = "http://127.0.0.1:4010"
    legacy_api_timeout_seconds: float = 600.0
    graph_max_concurrency: int = 3
    graph_recursion_limit: int = 32
    graph_checkpoint_path: str = str(APP_ROOT / "storage" / "langgraph" / "checkpoints.sqlite")
    progress_heartbeat_seconds: float = 15.0
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
