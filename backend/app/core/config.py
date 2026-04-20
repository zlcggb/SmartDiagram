import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    PROJECT_NAME: str = "SmartDiagram"
    API_PREFIX: str = "/api"

    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    # LLM - OpenAI compatible
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    MODEL_ID: str = os.getenv("MODEL_ID", "gpt-4o")
    MAX_TOKENS: int = int(os.getenv("MAX_TOKENS", "16384"))
    TEMPERATURE: float = float(os.getenv("TEMPERATURE", "0.3"))

    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/smartdiagram",
    )

    # LangSmith (optional observability)
    LANGCHAIN_TRACING_V2: str = os.getenv("LANGCHAIN_TRACING_V2", "false")
    LANGCHAIN_API_KEY: str = os.getenv("LANGCHAIN_API_KEY", "")


settings = Settings()
