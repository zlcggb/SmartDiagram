# smartdiagram-backend — Error Handling

## HTTP Error Pattern

```python
# ✅ Correct: FastAPI HTTPException
from fastapi import HTTPException

raise HTTPException(status_code=403, detail="Insufficient permissions")
raise HTTPException(status_code=404, detail="Conversation not found")
```

## SSE Stream Errors

In the SSE streaming endpoint, errors are sent as events, not HTTP status codes:

```python
# routes.py — SSE error event
yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"
```

## Service Layer Errors

Services raise domain-specific exceptions or return None/error objects:

```python
# ✅ Budget service returns evaluation result, not exception
result = await evaluate_tenant_budget(tenant_id)
if not result.allowed:
    yield error_event(result.reason)
    return
```

## Runtime Guards

`RuntimeGuardError` and `RuntimeRateLimitBackendError` in `runtime_guard_service.py` handle rate limiting and loop detection:

```python
try:
    await evaluate_runtime_request_async(...)
except RuntimeGuardError as e:
    yield error_event(str(e))
except RuntimeRateLimitBackendError as e:
    yield error_event(f"Rate limited: {e}")
```

## Forbidden

- ❌ Bare `except:` (always catch specific exceptions)
- ❌ Swallowing exceptions silently (always log)
- ❌ Returning raw exception messages to client (may leak internals)
- ❌ Using HTTP 500 for business logic errors (use 4xx)
