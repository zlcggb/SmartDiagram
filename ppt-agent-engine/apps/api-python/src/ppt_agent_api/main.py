from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from starlette.background import BackgroundTask

from .legacy import LegacyApiClient, LegacyApiError
from .locks import project_run_locks
from .progress import progress_hub
from .schemas import PipelineRequest, ProgressEvent, fail, ok
from .settings import get_settings
from .workflows.project_pipeline import GRAPH_DESCRIPTION, build_project_pipeline


settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = LegacyApiClient(
        settings.legacy_api_url,
        settings.legacy_api_timeout_seconds,
        internal_secret=settings.ppt_internal_api_secret,
    )
    checkpoint_path = Path(settings.graph_checkpoint_path).expanduser().resolve()
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(checkpoint_path)) as checkpointer:
        await checkpointer.setup()
        app.state.legacy = client
        app.state.checkpointer = checkpointer
        app.state.pipeline = build_project_pipeline(client, checkpointer)
        app.state.checkpoint_path = str(checkpoint_path)
        yield
    await client.close()


app = FastAPI(
    title="PPT Agent API",
    version="0.1.0",
    description="FastAPI gateway with a LangGraph orchestration runtime.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def legacy(request: Request) -> LegacyApiClient:
    return request.app.state.legacy


@app.exception_handler(LegacyApiError)
async def legacy_error_handler(_: Request, error: LegacyApiError) -> JSONResponse:
    status = error.status_code if 400 <= error.status_code < 600 else 502
    return JSONResponse(status_code=status, content=fail(str(error), error.data))


@app.exception_handler(HTTPException)
async def http_error_handler(_: Request, error: HTTPException) -> JSONResponse:
    message = error.detail if isinstance(error.detail, str) else "请求处理失败"
    return JSONResponse(status_code=error.status_code, content=fail(message))


@app.get("/api/health")
async def health(request: Request) -> Response:
    try:
        response = await legacy(request).raw_request("GET", "/api/health")
        payload = response.json()
        payload.update({"gateway": "fastapi", "orchestration": "langgraph", "legacy": "connected"})
        return JSONResponse(status_code=response.status_code, content=payload)
    except Exception as error:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "gateway": "fastapi",
                "orchestration": "langgraph",
                "legacy": "disconnected",
                "message": str(error),
            },
        )


@app.get("/api/ai/status")
async def ai_status(request: Request) -> Response:
    response = await legacy(request).raw_request("GET", "/api/ai/status")
    payload = response.json()
    payload.update({"apiBackend": "fastapi", "orchestrationBackend": "langgraph"})
    return JSONResponse(status_code=response.status_code, content=payload)


@app.get("/api/orchestration/graph")
async def graph_description() -> dict[str, Any]:
    return ok({**GRAPH_DESCRIPTION, "checkpoint": "sqlite"}, "LangGraph 编排拓扑")


async def _merged_progress_stream(request: Request, project_id: str) -> AsyncIterator[bytes]:
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=1024)

    async def pump_graph() -> None:
        async for event in progress_hub.subscribe(project_id):
            await queue.put(event.model_dump_json(exclude_none=True))

    async def pump_legacy() -> None:
        while True:
            try:
                async for raw in legacy(request).stream_progress(project_id):
                    await queue.put(raw)
                return
            except (httpx.HTTPError, OSError):
                await asyncio.sleep(1.0)

    tasks = [asyncio.create_task(pump_graph()), asyncio.create_task(pump_legacy())]
    try:
        yield b": connected\n\n"
        while not await request.is_disconnected():
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=settings.progress_heartbeat_seconds)
                yield f"data: {payload}\n\n".encode()
            except TimeoutError:
                yield b": heartbeat\n\n"
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task


@app.get("/api/projects/{project_id}/progress")
async def project_progress(request: Request, project_id: str) -> StreamingResponse:
    await _authorize_project(request, project_id)
    return StreamingResponse(
        _merged_progress_stream(request, project_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@app.post("/api/projects/{project_id}/run-pipeline")
async def run_pipeline(request: Request, project_id: str, body: PipelineRequest) -> JSONResponse:
    await _authorize_project(request, project_id)
    lock = project_run_locks.for_project(project_id)
    if lock.locked():
        return JSONResponse(status_code=409, content=fail("该项目已有一条流水线正在执行，请等待完成"))

    identity_material = request.headers.get("authorization") or request.headers.get("x-ppt-guest-token") or "missing"
    identity_scope = hashlib.sha256(identity_material.encode("utf-8")).hexdigest()[:20]
    requested_thread = body.threadId.strip() if body.threadId else f"run:{uuid4().hex}"
    thread_id = f"ppt:{identity_scope}:project:{project_id}:{requested_thread[:120]}"
    config = {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": settings.graph_recursion_limit,
        "max_concurrency": settings.graph_max_concurrency,
    }
    initial_state = {
        "project_id": project_id,
        "theme": body.theme or "",
        "accent_id": body.accentId or "",
        "surface_id": body.surfaceId or "",
        "mode": body.mode,
        "skip_design": body.skipDesign,
        "force": body.force,
        "logs": [],
        "errors": [],
        "search_failures": [],
    }

    async with lock:
        try:
            async for part in request.app.state.pipeline.astream(
                initial_state,
                config=config,
                stream_mode=["updates", "custom"],
                version="v2",
            ):
                if part.get("type") == "custom":
                    event = ProgressEvent.model_validate(part["data"])
                    await progress_hub.publish(project_id, event)

            snapshot = await request.app.state.pipeline.aget_state(config)
            values = snapshot.values
            errors = values.get("errors", [])
            message = "LangGraph 流水线已完成" if not errors else f"流水线完成，但有 {len(errors)} 个步骤错误"
            return JSONResponse(
                content=ok(
                    {
                        "detail": values.get("final_detail") or values.get("project_detail"),
                        "logs": values.get("logs", []),
                        "errors": errors,
                        "threadId": thread_id,
                    },
                    message,
                )
            )
        except LegacyApiError:
            raise
        except Exception as error:
            await progress_hub.publish(
                project_id,
                ProgressEvent(stage="pipeline", status="error", message=f"流水线失败：{error}", node="runtime"),
            )
            raise HTTPException(status_code=502, detail=f"LangGraph 流水线失败：{error}") from error


HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

UNTRUSTED_INTERNAL_HEADERS = {
    "x-ppt-internal-secret",
    "x-user-id",
    "x-tenant-id",
    "x-team-id",
    "x-roles",
    "x-scopes",
}


def _forward_headers(request: Request) -> dict[str, str]:
    return {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
        and key.lower() not in UNTRUSTED_INTERNAL_HEADERS
        and key.lower() not in {"host", "content-length"}
    }


async def _authorize_project(request: Request, project_id: str) -> None:
    response = await legacy(request).raw_request(
        "GET",
        f"/api/projects/{project_id}",
        headers=_forward_headers(request),
        internal=False,
    )
    if not response.is_error:
        return
    try:
        payload = response.json()
        message = payload.get("message") or "未找到项目"
        data = payload.get("data")
    except (json.JSONDecodeError, TypeError):
        message = "项目访问验证失败"
        data = None
    raise LegacyApiError(message, response.status_code, data)


async def _proxy(request: Request, upstream_path: str) -> Response:
    headers = _forward_headers(request)
    response = await legacy(request).stream_request(
        request.method,
        upstream_path,
        content=request.stream(),
        params=request.query_params.multi_items(),
        headers=headers,
    )
    response_headers = {
        key: value for key, value in response.headers.items() if key.lower() not in HOP_BY_HOP_HEADERS
    }
    return StreamingResponse(
        response.aiter_raw(),
        status_code=response.status_code,
        headers=response_headers,
        background=BackgroundTask(response.aclose),
    )


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_api(request: Request, path: str) -> Response:
    return await _proxy(request, f"/api/{path}")


@app.get("/exports/{path:path}")
async def proxy_exports(request: Request, path: str) -> Response:
    return await _proxy(request, f"/exports/{path}")
