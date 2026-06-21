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
    LLM_REQUEST_TIMEOUT_SECONDS: int = int(os.getenv("LLM_REQUEST_TIMEOUT_SECONDS", "90"))
    LLM_DRAWIO_REQUEST_TIMEOUT_SECONDS: int = int(os.getenv("LLM_DRAWIO_REQUEST_TIMEOUT_SECONDS", "180"))
    LLM_MAX_RETRIES: int = int(os.getenv("LLM_MAX_RETRIES", "0"))

    # Runtime guardrails
    RUNTIME_RATE_LIMIT_PER_MINUTE: int = int(os.getenv("RUNTIME_RATE_LIMIT_PER_MINUTE", "30"))
    RUNTIME_RATE_LIMIT_BACKEND: str = os.getenv("RUNTIME_RATE_LIMIT_BACKEND", "memory")
    RUNTIME_RATE_LIMIT_REDIS_FAIL_OPEN: bool = os.getenv("RUNTIME_RATE_LIMIT_REDIS_FAIL_OPEN", "false").lower() == "true"
    RUNTIME_MAX_ESTIMATED_TOKENS: int = int(os.getenv("RUNTIME_MAX_ESTIMATED_TOKENS", "32000"))
    RUNTIME_DEGRADE_TOKEN_THRESHOLD: int = int(os.getenv("RUNTIME_DEGRADE_TOKEN_THRESHOLD", "18000"))
    RUNTIME_MAX_STREAM_EVENTS: int = int(os.getenv("RUNTIME_MAX_STREAM_EVENTS", "2500"))
    RUNTIME_MAX_AGENT_REPEATS: int = int(os.getenv("RUNTIME_MAX_AGENT_REPEATS", "12"))
    RUNTIME_INPUT_COST_PER_1K: float = float(os.getenv("RUNTIME_INPUT_COST_PER_1K", "0.0015"))   # Gemini 3.5 Flash: $1.50/M
    RUNTIME_OUTPUT_COST_PER_1K: float = float(os.getenv("RUNTIME_OUTPUT_COST_PER_1K", "0.009"))   # Gemini 3.5 Flash: $9.00/M
    TENANT_DEFAULT_MONTHLY_COST_LIMIT: float = float(os.getenv("TENANT_DEFAULT_MONTHLY_COST_LIMIT", "25.0"))
    TENANT_DEFAULT_MONTHLY_TOKEN_LIMIT: int = int(os.getenv("TENANT_DEFAULT_MONTHLY_TOKEN_LIMIT", "5000000"))
    TENANT_BUDGET_HARD_LIMIT: bool = os.getenv("TENANT_BUDGET_HARD_LIMIT", "true").lower() == "true"
    USAGE_ROLLUP_SCHEDULER_ENABLED: bool = os.getenv("USAGE_ROLLUP_SCHEDULER_ENABLED", "false").lower() == "true"
    USAGE_ROLLUP_REFRESH_ON_STARTUP: bool = os.getenv("USAGE_ROLLUP_REFRESH_ON_STARTUP", "false").lower() == "true"
    USAGE_ROLLUP_REFRESH_INTERVAL_SECONDS: int = int(os.getenv("USAGE_ROLLUP_REFRESH_INTERVAL_SECONDS", "900"))
    WORKER_STALE_JOB_TIMEOUT_SECONDS: int = int(os.getenv("WORKER_STALE_JOB_TIMEOUT_SECONDS", "1800"))
    WORKER_STALE_JOB_ACTION: str = os.getenv("WORKER_STALE_JOB_ACTION", "requeue")

    # Local auth gateway
    AUTH_LOCAL_LOGIN_ENABLED: bool = os.getenv("AUTH_LOCAL_LOGIN_ENABLED", "true").lower() == "true"
    AUTH_SESSION_SECRET: str = os.getenv(
        "AUTH_SESSION_SECRET",
        "smartdiagram-dev-session-secret-change-me",
    )
    AUTH_SESSION_TTL_SECONDS: int = int(os.getenv("AUTH_SESSION_TTL_SECONDS", "43200"))
    AUTH_DEMO_USER_EMAIL: str = os.getenv("AUTH_DEMO_USER_EMAIL", "user@smartdiagram.local")
    AUTH_DEMO_USER_PASSWORD: str = os.getenv("AUTH_DEMO_USER_PASSWORD", "user123456")
    AUTH_DEMO_ADMIN_EMAIL: str = os.getenv("AUTH_DEMO_ADMIN_EMAIL", "admin@smartdiagram.local")
    AUTH_DEMO_ADMIN_PASSWORD: str = os.getenv("AUTH_DEMO_ADMIN_PASSWORD", "admin123456")

    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:smartdiagram_secret@localhost:5432/smartdiagram",
    )
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # Object storage
    OBJECT_STORAGE_BACKEND: str = os.getenv("OBJECT_STORAGE_BACKEND", "local")
    OBJECT_STORAGE_LOCAL_ROOT: str = os.getenv("OBJECT_STORAGE_LOCAL_ROOT", "")
    OBJECT_STORAGE_HTTP_TIMEOUT_SECONDS: int = int(os.getenv("OBJECT_STORAGE_HTTP_TIMEOUT_SECONDS", "30"))
    S3_ENDPOINT_URL: str = os.getenv("S3_ENDPOINT_URL", "")
    S3_BUCKET: str = os.getenv("S3_BUCKET", "")
    S3_REGION: str = os.getenv("S3_REGION", "auto")
    S3_ACCESS_KEY_ID: str = os.getenv("S3_ACCESS_KEY_ID", "")
    S3_SECRET_ACCESS_KEY: str = os.getenv("S3_SECRET_ACCESS_KEY", "")
    S3_PUBLIC_BASE_URL: str = os.getenv("S3_PUBLIC_BASE_URL", "")
    EXPORT_CONFIRMATION_REQUIRED_FORMATS: str = os.getenv("EXPORT_CONFIRMATION_REQUIRED_FORMATS", "pdf,pptx")

    # Knowledge ingestion workers
    KNOWLEDGE_INGESTION_REDIS_QUEUE: str = os.getenv(
        "KNOWLEDGE_INGESTION_REDIS_QUEUE",
        "smartdiagram:knowledge:ingestion",
    )
    KNOWLEDGE_VECTOR_BACKEND: str = os.getenv("KNOWLEDGE_VECTOR_BACKEND", "local_db")
    KNOWLEDGE_VECTOR_DIMENSIONS: int = int(os.getenv("KNOWLEDGE_VECTOR_DIMENSIONS", "384"))
    KNOWLEDGE_VECTOR_FALLBACK_TO_LOCAL: bool = os.getenv("KNOWLEDGE_VECTOR_FALLBACK_TO_LOCAL", "true").lower() == "true"
    QDRANT_URL: str = os.getenv("QDRANT_URL", "")
    QDRANT_API_KEY: str = os.getenv("QDRANT_API_KEY", "")
    QDRANT_COLLECTION: str = os.getenv("QDRANT_COLLECTION", "smartdiagram_knowledge")
    QDRANT_TIMEOUT_SECONDS: int = int(os.getenv("QDRANT_TIMEOUT_SECONDS", "30"))
    KNOWLEDGE_SECURITY_POLICY_MODE: str = os.getenv("KNOWLEDGE_SECURITY_POLICY_MODE", "rule")
    KNOWLEDGE_SECURITY_BLOCK_SEVERITY: str = os.getenv("KNOWLEDGE_SECURITY_BLOCK_SEVERITY", "high")
    KNOWLEDGE_SECURITY_TRUSTED_TERMS: str = os.getenv(
        "KNOWLEDGE_SECURITY_TRUSTED_TERMS",
        "模板,示例,培训,规范,政策,流程,quote process",
    )

    # LangSmith (optional observability)
    LANGCHAIN_TRACING_V2: str = os.getenv("LANGCHAIN_TRACING_V2", "false")
    LANGCHAIN_API_KEY: str = os.getenv("LANGCHAIN_API_KEY", "")


settings = Settings()
