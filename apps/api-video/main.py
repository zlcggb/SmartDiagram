"""FastAPI 入口：视频学习助手（解析 / 下载 / AI 总结 / 导图 / 测验 / 问答 / 学习库 / 管理）。"""
import os
import uuid
from typing import Optional

from env_loader import load_local_env

load_local_env()

import logging
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from auth_service import bootstrap_initial_admin
from db import close_pool, db_cursor, run_migrations
from downloader import classify_error, download_video, get_video_info
from url_normalize import extract_url_from_text
from proxy_config import ensure_proxy_env
from tasks import create_task, get_task, request_cancel, request_pause, request_resume
from ai_routes import router as ai_router
from media_routes import router as media_router
from auth_routes import router as auth_router
from admin_routes import router as admin_router
from library_routes import router as library_router
from docs_routes import router as docs_router

logger = logging.getLogger(__name__)
ensure_proxy_env()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        logger.info("正在执行视频助手 PostgreSQL 数据库迁移...")
        run_migrations()
        logger.info("数据库迁移已完成")
        admin_user = bootstrap_initial_admin()
        if admin_user:
            logger.info("超级管理员就绪: %s (%s)", admin_user.get("email"), admin_user.get("role"))
        try:
            with db_cursor() as cur:
                cur.execute(
                    """
                    UPDATE analyses
                    SET status = 'error', error = '服务异常重启，任务中断', finished_at = now()
                    WHERE status IN ('queued', 'transcribing', 'local_asr', 'analyzing_frames', 'summarizing')
                    """
                )
        except Exception as e:
            logger.debug("清理中断任务跳过: %s", e)
    except Exception as e:
        logger.error("数据库初始化启动失败: %s", e)

    yield

    close_pool()


app = FastAPI(title="SmartDiagram Video Assistant API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ai_router)
app.include_router(media_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(library_router)
app.include_router(docs_router)


ALLOWED_BROWSERS = {
    "brave",
    "chrome",
    "chromium",
    "edge",
    "firefox",
    "opera",
    "safari",
    "vivaldi",
}


def _normalize_browser(browser: Optional[str]) -> Optional[str]:
    if not browser:
        return None
    b = browser.strip().lower()
    if b not in ALLOWED_BROWSERS:
        raise HTTPException(status_code=400, detail=f"不支持的浏览器：{browser}")
    return b


class InfoRequest(BaseModel):
    url: str
    browser: Optional[str] = None


class DownloadRequest(BaseModel):
    url: str
    format_id: Optional[str] = None
    title: Optional[str] = None
    browser: Optional[str] = None


@app.get("/api/health")
def health():
    from cloud_asr import get_asr_provider, is_cloud_asr_available
    from llm_client import get_llm_model, get_llm_provider, is_configured
    from proxy_config import get_overseas_proxy
    from x_twmd import resolve_twmd_path
    from auth_service import is_auth_configured
    from db import is_app_db_configured, is_db_ready

    return {
        "status": "ok",
        "llm_configured": is_configured(),
        "llm_provider": get_llm_provider(),
        "llm_model": get_llm_model(),
        "cloud_asr_available": is_cloud_asr_available(),
        "asr_provider": get_asr_provider(),
        "overseas_proxy": get_overseas_proxy(),
        "twmd": resolve_twmd_path(),
        "auth_configured": is_auth_configured(),
        "app_db_configured": is_app_db_configured(),
        "db_ready": is_db_ready(),
        "database_type": "postgresql",
    }


@app.post("/api/info")
def api_info(req: InfoRequest):
    raw_url = (req.url or "").strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="URL 不能为空")
    extracted = extract_url_from_text(raw_url)
    if extracted:
        url = extracted
    elif raw_url.lower().startswith(("http://", "https://")):
        url = raw_url
    else:
        raise HTTPException(status_code=400, detail="请输入合法的视频链接")
    browser = _normalize_browser(req.browser)
    try:
        return get_video_info(url, browser=browser)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=classify_error(e))


@app.post("/api/download")
def api_download(req: DownloadRequest, background: BackgroundTasks):
    raw_url = (req.url or "").strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="URL 不能为空")
    extracted = extract_url_from_text(raw_url)
    url = extracted if extracted else raw_url
    browser = _normalize_browser(req.browser)
    task_id = uuid.uuid4().hex
    create_task(task_id, url, title=req.title)
    background.add_task(
        download_video, url, req.format_id, task_id, req.title, browser
    )
    return {"task_id": task_id}


@app.get("/api/progress/{task_id}")
def api_progress(task_id: str):
    t = get_task(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {
        "status": t["status"],
        "percent": t["percent"],
        "speed": t["speed"],
        "eta": t["eta"],
        "error": t["error"],
        "error_code": t.get("error_code"),
        "filename": t["filename"],
    }


_ACTIVE = {"queued", "downloading", "paused", "processing"}


def _require_active_task(task_id: str) -> dict:
    t = get_task(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    if t["status"] not in _ACTIVE:
        raise HTTPException(status_code=409, detail="任务已结束，无法操作")
    return t


@app.post("/api/cancel/{task_id}")
def api_cancel(task_id: str):
    _require_active_task(task_id)
    request_cancel(task_id)
    return {"ok": True}


@app.post("/api/pause/{task_id}")
def api_pause(task_id: str):
    t = _require_active_task(task_id)
    if t["status"] not in ("downloading", "paused"):
        raise HTTPException(status_code=409, detail="仅下载阶段可暂停")
    request_pause(task_id)
    return {"ok": True}


@app.post("/api/resume/{task_id}")
def api_resume(task_id: str):
    t = _require_active_task(task_id)
    if t["status"] != "paused":
        raise HTTPException(status_code=409, detail="任务未处于暂停状态")
    request_resume(task_id)
    return {"ok": True}


@app.get("/api/file/{task_id}")
def api_file(task_id: str):
    t = get_task(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    if t["status"] != "finished" or not t["filepath"]:
        raise HTTPException(status_code=409, detail="文件尚未就绪")
    if not os.path.exists(t["filepath"]):
        raise HTTPException(status_code=404, detail="文件已失效")
    return FileResponse(
        t["filepath"],
        filename=t["filename"] or "video.mp4",
        media_type="application/octet-stream",
    )
