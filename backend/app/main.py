"""SmartDiagram API — FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router as api_router
from app.api.routes_approvals import router as approvals_router
from app.api.routes_audit import router as audit_router
from app.api.routes_conversations import router as conversations_router
from app.api.routes_diagrams import router as diagrams_router
from app.api.routes_exports import router as exports_router
from app.api.routes_knowledge import router as knowledge_router
from app.api.routes_preferences import router as preferences_router
from app.core.config import settings
from app.core.logger import logger

app = FastAPI(title="SmartDiagram API", version="0.1.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_PREFIX)
app.include_router(knowledge_router, prefix=settings.API_PREFIX)
app.include_router(preferences_router, prefix=settings.API_PREFIX)
app.include_router(conversations_router, prefix=settings.API_PREFIX)
app.include_router(diagrams_router, prefix=settings.API_PREFIX)
app.include_router(exports_router, prefix=settings.API_PREFIX)
app.include_router(approvals_router, prefix=settings.API_PREFIX)
app.include_router(audit_router, prefix=settings.API_PREFIX)


@app.on_event("startup")
async def on_startup():
    logger.info("SmartDiagram API starting up...")
    # Database is optional for MVP, but when configured it should initialize in
    # both local Docker and deployed environments.
    database_ready = False
    if settings.DATABASE_URL:
        try:
            from app.core.db import init_db

            await init_db()
            database_ready = True
            logger.info("Database initialized.")
        except Exception as e:
            logger.warning(f"Database init skipped: {e}")
    else:
        logger.info("Database not configured — running in stateless mode.")

    if database_ready:
        from app.services.usage_rollup_scheduler import (
            run_usage_rollup_startup_refresh,
            start_usage_rollup_scheduler,
        )

        startup_summary = await run_usage_rollup_startup_refresh()
        if startup_summary:
            logger.info(
                "Startup usage rollup refresh completed: "
                f"period={startup_summary.get('period')} "
                f"rollups={startup_summary.get('rollup_count')}"
            )
        start_usage_rollup_scheduler()


@app.on_event("shutdown")
async def on_shutdown():
    from app.services.usage_rollup_scheduler import stop_usage_rollup_scheduler

    await stop_usage_rollup_scheduler()


@app.get("/")
async def root():
    return {"message": "SmartDiagram API is running", "version": "0.1.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
