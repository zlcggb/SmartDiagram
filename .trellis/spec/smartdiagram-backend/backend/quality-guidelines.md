# smartdiagram-backend — Quality Guidelines

## Code Standards

### Python Style

- Python 3.10+ features: `match`, `|` union types, `from __future__ import annotations`
- Type hints on all function signatures
- Docstrings for modules and complex functions
- Module-level docstrings at file top

### Naming

| Entity | Convention | Example |
|--------|-----------|---------|
| Routes file | `routes_*.py` | `routes_auth.py` |
| Service file | `*_service.py` | `budget_service.py` |
| Model file | singular noun | `conversation.py` |
| Agent file | `*_agent.py` | `drawio_agent.py` |
| Config | `core/config.py` | `Settings` class |

### Import Style

```python
# ✅ Correct: grouped imports
from fastapi import APIRouter, HTTPException, Request
from app.core.config import settings
from app.core.logger import logger
from app.services.identity_service import require_request_identity
```

## Forbidden Patterns

| Pattern | Why | Alternative |
|---------|-----|-------------|
| `os.getenv()` in service code | Config scattered | `settings.X` from `core/config.py` |
| Sync DB calls | Blocks event loop | `async with async_session()` |
| `print()` | No structured logging | `logger.info()` |
| Hardcoded secrets | Security risk | Environment variables |
| `import *` | Namespace pollution | Explicit imports |

## Testing

- Test files in same directory: `*_test.py` or `test_*.py`
- Use `pytest` with `pytest-asyncio` for async tests
- Mock external services (LLM, database) in unit tests

## Agent Development

When adding a new diagram engine:
1. Add Task↔Engine mapping in `agents/catalog.py`
2. Create `agents/new_engine_agent.py`
3. Add Canvas component in `apps/web/src/features/diagram/ui/`
4. Register in `CanvasPanel.tsx` routing
