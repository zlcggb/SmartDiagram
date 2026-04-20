"""SmartDiagram API — FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router as api_router
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


@app.on_event("startup")
async def on_startup():
    logger.info("SmartDiagram API starting up...")
    # Database is optional for MVP — skip if not configured
    if settings.DATABASE_URL and "localhost" not in settings.DATABASE_URL:
        try:
            from app.core.db import init_db
            await init_db()
            logger.info("Database initialized.")
        except Exception as e:
            logger.warning(f"Database init skipped: {e}")
    else:
        logger.info("Database not configured — running in stateless mode.")


@app.get("/")
async def root():
    return {"message": "SmartDiagram API is running", "version": "0.1.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
