# smartdiagram-backend — Backend Development Guidelines

> 图表后端：FastAPI + LangGraph + SQLAlchemy async + PostgreSQL

---

## Pre-Development Checklist

Before writing backend code, verify:

1. [ ] Read the route prefix rules: all routes mount under `settings.API_PREFIX` (`/api`)
2. [ ] Check `app/agents/catalog.py` for Task↔Engine mapping
3. [ ] Database models go in `app/models/`, services in `app/services/`
4. [ ] New routes go in `app/api/routes_*.py` and register in `app/main.py`

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | Filled |
| [Error Handling](./error-handling.md) | Error types, handling strategies | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | Filled |

---

## Quality Check

After completing backend changes, verify:

1. [ ] New routes registered in `app/main.py` with `settings.API_PREFIX`
2. [ ] Database models imported in `app/core/db.py:import_model_modules()`
3. [ ] Services follow `*_service.py` naming convention
4. [ ] No hardcoded API keys or secrets
5. [ ] Async patterns: `async def` + `await` throughout (no sync DB calls)
6. [ ] Agent changes reflected in both `catalog.py` and frontend `CanvasPanel.tsx`

---

**Language**: English for code, 中文 for comments is acceptable.
