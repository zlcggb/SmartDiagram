# ppt-agent-api — Backend Development Guidelines

> PPT 编排 FastAPI 服务：LangGraph 工作流，调度 Node 侧车

---

## Pre-Development Checklist

1. [ ] Read `settings.py` for env var naming (`get_settings()`)
2. [ ] Understand the LegacyApiClient → Node 侧车通信模式
3. [ ] Workflows go in `workflows/` directory
4. [ ] Schemas defined in `schemas.py`

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization | Filled |
| [Database Guidelines](./database-guidelines.md) | ORM patterns | N/A (delegated to Node) |
| [Error Handling](./error-handling.md) | Error types | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Logging patterns | To fill |

---

## Architecture

```
apps/api-ppt/src/ppt_agent_api/
├── main.py           # FastAPI app with lifespan (httpx client, LangGraph saver)
├── settings.py       # Pydantic Settings — env var 读取
├── schemas.py        # Pydantic request/response models
├── progress.py       # SSE progress hub
├── locks.py          # Per-project run locks (防重入)
├── legacy.py         # LegacyApiClient → Node 侧车 HTTP 调用
└── workflows/
    └── project_pipeline.py  # LangGraph 主编排图
```

### Key Patterns

- **LegacyApiClient**: 所有对 Node 侧车的 HTTP 调用走这个 client，封装了 timeout 和 `PPT_INTERNAL_API_SECRET` 认证
- **Project Run Locks**: `project_run_locks` 防止同一项目并发运行 pipeline
- **Progress Hub**: SSE 进度推送，`progress_hub.emit()` 广播事件
- **Settings**: 使用 `get_settings()` 单例，不直接 `os.getenv()`

### Forbidden

- ❌ 直接操作数据库（所有持久化通过 Node 侧车 API）
- ❌ 在 workflow 中硬编码 Node 侧车 URL（用 `settings.legacy_api_url`）
- ❌ 忽略 project run lock 直接调 pipeline

---

## Quality Check

1. [ ] New workflows registered in `build_project_pipeline()`
2. [ ] LegacyApiClient 调用有 error handling
3. [ ] Progress events 有对应的前端 `progressStream.ts` 处理
4. [ ] Schemas 类型与 `@ppt-agent/shared` DTO 保持一致
