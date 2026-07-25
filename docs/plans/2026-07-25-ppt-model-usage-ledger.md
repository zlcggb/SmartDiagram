# PPT Model Usage Ledger Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `tdd-workflow` to implement this plan task-by-task.

**Goal:** Persist every PPT model request in the SmartDiagram billing database and show durable monthly/project summaries plus per-call details.

**Architecture:** Provider adapters emit exact per-request usage events. The PPT Node API enriches them from request-local identity/project context and posts them idempotently to an authenticated SmartDiagram billing endpoint. The unified backend calculates server-side cost, stores events, combines them with existing AgentRun usage, and serves the PPT dashboard.

**Tech Stack:** FastAPI, SQLModel/SQLAlchemy, PostgreSQL, Fastify, TypeScript, Undici, React, Zustand, Node test runner, pytest.

---

### Task 1: Add the backend ledger model and pricing service

**Files:**
- Create: `backend/app/models/model_usage.py`
- Create: `backend/app/services/model_usage_service.py`
- Create: `backend/tests/test_model_usage_service.py`
- Modify: `backend/app/core/db.py`
- Modify: `backend/app/core/config.py`

1. Write failing tests for token normalization, configured price lookup, unpriced models, event idempotency inputs, monthly/project aggregation, and safe summaries.
2. Run `cd backend && uv run pytest tests/test_model_usage_service.py -q`; expect failures because the model/service do not exist.
3. Add `ModelUsageEvent` with a unique external event ID and indexed tenant/user/project/time fields.
4. Add pure pricing and serialization helpers. Calculate cost only from server configuration or a trusted provider cost field.
5. Import the model module from `db.import_model_modules()`.
6. Re-run the focused tests; expect pass.

### Task 2: Add authenticated ingest and query APIs

**Files:**
- Create: `backend/app/api/routes_billing.py`
- Create: `backend/tests/test_model_usage_routes.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/routes_auth.py`
- Modify: `backend/app/services/budget_service.py`
- Modify: `backend/.env.example`
- Modify: `docker-compose.yml`

1. Write failing API tests proving that ingestion requires both a valid user and the PPT internal secret, derives identity from authentication, rejects oversized summaries, and treats duplicate `external_event_id` as idempotent success.
2. Write failing query tests for current-month totals, project filtering, pagination, empty history, and combined AgentRun + model-event budget totals.
3. Run `cd backend && uv run pytest tests/test_model_usage_routes.py tests/test_model_usage_service.py -q`; expect endpoint/aggregation failures.
4. Implement `POST /api/billing/model-usage-events` and `GET /api/billing/me/model-usage`.
5. Update budget aggregation to add ledger usage without double-counting AgentRun rows.
6. Register the router and configure the shared internal secret in local/Docker environments.
7. Re-run focused backend tests; expect pass.

### Task 3: Emit exact single-call events from provider adapters

**Files:**
- Modify: `ppt-agent-engine/packages/agents/src/types.ts`
- Modify: `ppt-agent-engine/packages/agents/src/openaiCompatibleAdapter.ts`
- Modify: `ppt-agent-engine/packages/agents/src/realGeminiAdapter.ts`
- Modify: `ppt-agent-engine/packages/agents/src/index.ts`
- Create: `ppt-agent-engine/packages/agents/src/modelUsage.test.ts`

1. Write failing tests for OpenAI JSON usage, OpenAI SSE usage, cached/reasoning tokens, missing usage, failed attempts, retry attempts, Gemini usage metadata, and two concurrent calls producing two unmixed events.
2. Run the new Node test file; expect missing reporter/event APIs.
3. Add a provider-neutral `ModelUsageEvent`/reporter contract.
4. Emit one event inside each actual provider HTTP attempt with model, stage, timing, status and exact usage.
5. Keep the legacy cumulative snapshot only as a compatibility view derived from emitted events.
6. Re-run adapter tests; expect pass.

### Task 4: Add request-local attribution and reliable backend reporting

**Files:**
- Create: `ppt-agent-engine/apps/api/src/lib/modelUsageContext.ts`
- Create: `ppt-agent-engine/apps/api/src/lib/modelUsageReporter.ts`
- Create: `ppt-agent-engine/apps/api/src/lib/modelUsageReporter.test.ts`
- Modify: `ppt-agent-engine/apps/api/src/lib/ai.ts`
- Modify: `ppt-agent-engine/apps/api/src/lib/aiUsage.ts`
- Modify: `ppt-agent-engine/apps/api/src/app.ts`
- Modify: `ppt-agent-engine/apps/api/src/lib/pptAuthorization.ts`
- Modify: `ppt-agent-engine/.env.example`

1. Write failing tests for request-local user/project/slide attribution, bearer forwarding, internal-secret forwarding, idempotent retry, bounded timeout, and parallel request isolation.
2. Run the focused Node tests; expect missing modules.
3. Introduce `AsyncLocalStorage` context after PPT authorization and enrich adapter events from it.
4. Implement a bounded, idempotent reporter to the SmartDiagram backend. Log failures without changing successful generation output.
5. Replace cumulative-delta accounting with aggregation of emitted individual events.
6. Re-run focused API tests; expect pass.

### Task 5: Replace inferred frontend statistics with ledger data

**Files:**
- Modify: `frontend/src/config/auth.ts`
- Modify: `frontend/src/ppt/lib/api.ts`
- Modify: `frontend/src/ppt/store/workbenchStore.ts`
- Modify: `frontend/src/ppt/components/studio/TokenDashboardModal.tsx`
- Create: `frontend/src/ppt/lib/modelUsage.test.ts`
- Mirror the same PPT package changes in `ppt-agent-engine/apps/web/src/` where that standalone package remains buildable.

1. Write failing parser tests for unified summary/events, legitimate zero usage, unavailable pricing, and API errors.
2. Run the focused frontend test; expect missing response types/parsers.
3. Add authenticated billing API helpers using the existing auth base URL rather than hardcoded hosts.
4. Make `refreshAiUsage` request the current project ledger summary.
5. Replace artifact-derived counts and browser-side pricing with backend values.
6. Add a recent-call table with time, stage/page, model, token split, cost, duration and status; add explicit loading/error/empty states.
7. Re-run focused tests and frontend typecheck; expect pass.

### Task 6: End-to-end verification

**Files:**
- Modify only if a discovered defect requires a narrowly scoped fix.

1. Run all new backend tests plus existing budget/auth tests.
2. Run all new adapter/API tests and existing security/typecheck suites.
3. Run unified frontend typecheck/build and standalone PPT web typecheck.
4. Initialize the database and verify the new table is created idempotently.
5. Start the three local services, generate one slide, and confirm exactly one or more provider-attempt rows matching the actual calls.
6. Refresh the browser and restart the PPT Node API; confirm totals and call history remain unchanged.
7. Confirm no prompt, API key, authorization token or full model output is present in the stored row or logs.

