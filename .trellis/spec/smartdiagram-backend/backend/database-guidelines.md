# smartdiagram-backend — Database Guidelines

## ORM: SQLAlchemy async + SQLModel

### Connection Pattern

```python
# core/db.py — singleton engine + session factory
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

engine = create_async_engine(settings.DATABASE_URL, echo=False)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
```

### Using Sessions

```python
# ✅ Correct: import async_session, use as context manager
from app.core.db import async_session

async def my_service_function():
    async with async_session() as session:
        result = await session.execute(select(MyModel).where(...))
        await session.commit()
```

### Model Registration

Every new model file MUST be imported in `core/db.py:import_model_modules()`:

```python
def import_model_modules() -> None:
    from app.models import my_new_model  # noqa: F401
```

This ensures SQLModel metadata is complete before `create_all()`.

### Database Configuration

- **图表库**: `DIAGRAM_DATABASE_URL` → database `smartdiagram`
- **PPT 库**: `DATABASE_URL` → database `ppt_agent`
- **切勿混库**: 图表后端只用 `DIAGRAM_DATABASE_URL`

### Forbidden

- ❌ Sync database calls (use `async` throughout)
- ❌ Raw SQL strings (use SQLAlchemy expressions)
- ❌ `os.getenv("DATABASE_URL")` in service code (use `settings.DATABASE_URL`)
- ❌ Creating new engines outside `core/db.py`
