# smartdiagram-backend — Logging Guidelines

## Logger

The project uses a single module-level logger:

```python
# core/logger.py
import logging
logger = logging.getLogger("smartdiagram")
logger.setLevel(logging.INFO)
```

### Usage

```python
# ✅ Correct: import the shared logger
from app.core.logger import logger

logger.info("Starting operation...")
logger.error("Failed: %s", error_msg)
logger.warning("Deprecation: use new_func instead")
```

### Conventions

- **One logger**: always `from app.core.logger import logger`, never create new loggers
- **Format**: `%(asctime)s | %(levelname)s | %(message)s`
- **Levels**: `INFO` for normal flow, `WARNING` for recoverable issues, `ERROR` for failures
- **No `print()`**: use `logger.*` in all production code

### Forbidden

- ❌ `print()` for debugging in committed code
- ❌ `logging.getLogger(__name__)` — use the shared `smartdiagram` logger
- ❌ Logging sensitive data (API keys, user credentials, .env values)
