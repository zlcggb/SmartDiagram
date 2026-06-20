# Agent Platform Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 SmartDiagram 从单次图表生成链路升级为企业级 Agent Harness 的可扩展基础架构。

**Architecture:** 保留当前可运行的 `Router -> diagram agent -> SSE -> canvas` 主链路，在其旁边逐步加入企业级执行状态、计划步骤、权限上下文、校验和审计能力。第一阶段只做兼容性增强，不强制切换到完整多 Agent 图，避免破坏现有 Demo。

**Tech Stack:** FastAPI、LangGraph、React、TypeScript、Zustand、PostgreSQL/Supabase、Redis、pgvector/Qdrant、S3/R2、Docker。

---

## Scope

本计划分为两个层级：

1. 第一批立即执行：文档、状态契约、运行时步骤计划、SSE 执行计划事件。
2. 后续阶段执行：权限、持久化、RAG、校验、导出、监控。

第一批完成后，系统仍然保持当前使用方式，但后端已经具备继续扩展成企业级 Agent Platform 的基础结构。

## Task 1: Record enterprise architecture

**Files:**

- Create: `docs/enterprise-agent-platform-architecture.md`

**Step 1: Write the architecture document**

记录项目定位、Agent 定义、分层架构、多 Agent 角色、记忆、权限、失败兜底、tradeoff、实施路线和面试讲述稿。

**Step 2: Verify document exists**

Run:

```bash
test -f docs/enterprise-agent-platform-architecture.md
```

Expected: exit code `0`.

## Task 2: Record executable implementation plan

**Files:**

- Create: `docs/plans/2026-05-26-agent-platform-upgrade.md`

**Step 1: Write this implementation plan**

计划必须按可验证任务拆解，并明确每个任务涉及文件、验证命令和完成标准。

**Step 2: Verify document exists**

Run:

```bash
test -f docs/plans/2026-05-26-agent-platform-upgrade.md
```

Expected: exit code `0`.

## Task 3: Add Agent Harness state contracts

**Files:**

- Modify: `backend/app/state/state.py`
- Create: `backend/app/state/agent_runtime.py`

**Step 1: Define execution status types**

Create enums and typed dictionaries for:

- execution status: `pending/running/succeeded/failed/skipped/needs_user_input`
- execution phase: `routing/planning/retrieving_context/generating_draft/designing/validating/exporting/completed`
- agent step metadata: id, label, agent, phase, status, started_at, ended_at, error
- permission context: tenant, user, team, project, roles, scopes

**Step 2: Extend `AgentState`**

Add optional fields for:

- `run_id`
- `conversation_id`
- `tenant_id`
- `user_id`
- `team_id`
- `project_id`
- `permission_context`
- `execution_plan`
- `execution_steps`
- `memory_context`
- `validation_errors`
- `audit_events`
- `tool_calls`
- `cost_estimate`
- `error_count`
- `max_retries`

Do not remove existing fields.

**Step 3: Verify Python compile**

Run:

```bash
cd backend && python3 -m py_compile app/state/state.py app/state/agent_runtime.py
```

Expected: no output and exit code `0`.

## Task 4: Add runtime execution plan builder

**Files:**

- Create: `backend/app/services/agent_runtime.py`

**Step 1: Implement default step builder**

Add a pure Python service that builds a default execution plan from `task_type` and `engine_type`:

```text
routing -> planning -> retrieving_context -> generating_draft -> validating -> rendering
```

For the current MVP, `planning`, `retrieving_context`, and `validating` can be marked as planned logical steps even if they are not yet backed by full agents.

**Step 2: Implement serialization**

Expose `step_to_event(step)` and `steps_to_events(steps)` helpers so API routes can emit stable SSE-compatible payloads.

**Step 3: Verify Python compile**

Run:

```bash
cd backend && python3 -m py_compile app/services/agent_runtime.py
```

Expected: no output and exit code `0`.

## Task 5: Emit execution plan events from SSE endpoint

**Files:**

- Modify: `backend/app/api/routes.py`

**Step 1: Import runtime helpers**

Import the default execution plan builder and serialization helper.

**Step 2: Emit plan after route decision**

When router finishes and route information is available, emit:

```json
{
  "type": "execution_plan",
  "steps": [...]
}
```

The existing frontend can ignore this event safely. Future UI can use it to display the full Agent plan.

**Step 3: Keep existing status events**

Do not remove existing `status`, `route`, `agent`, `design`, `code`, or `done` events.

**Step 4: Verify backend compile**

Run:

```bash
cd backend && python3 -m py_compile app/api/routes.py
```

Expected: no output and exit code `0`.

## Task 6: Frontend plan event support

**Files:**

- Modify: `frontend/src/store/chatStore.ts`
- Modify: `frontend/src/components/chat/ChatPanel.tsx`

**Step 1: Add optional execution plan state**

Add `executionPlan` to assistant messages. This can remain hidden initially or be shown later.

**Step 2: Parse `execution_plan` event**

When receiving the new event, store it on the latest assistant message.

**Step 3: Verify build**

Run:

```bash
npm run build
```

Expected: build succeeds.

## Task 7: Add output validation foundation

**Files:**

- Create: `backend/app/services/output_validation.py`

**Step 1: Add validation result type**

Define a common result with:

- `ok`
- `engine_type`
- `errors`
- `warnings`
- `repairable`

**Step 2: Add basic validators**

Start with local deterministic checks:

- ECharts: valid JSON object, no JavaScript function strings.
- React Flow: JSON object has `nodes` and `edges`.
- Excalidraw: JSON array or object with `elements`.
- Mermaid: non-empty text.
- Draw.io: contains `<mxfile`.

**Step 3: Verify compile**

Run:

```bash
cd backend && python3 -m py_compile app/services/output_validation.py
```

Expected: no output and exit code `0`.

## Task 8: Wire validation after code completion

**Files:**

- Modify: `backend/app/api/routes.py`

**Step 1: Validate final code before emitting `code_complete`**

When `code_complete` appears, run the output validator for the current engine.

**Step 2: Emit validation event**

Emit:

```json
{
  "type": "validation",
  "ok": true,
  "errors": [],
  "warnings": []
}
```

If validation fails, still emit the original code in MVP mode, but attach warnings. Later phases can block invalid output.

**Step 3: Verify compile**

Run:

```bash
cd backend && python3 -m py_compile app/api/routes.py app/services/output_validation.py
```

Expected: no output and exit code `0`.

## Task 9: Add persistence schema

**Files:**

- Create: `backend/app/models/tenant.py`
- Create: `backend/app/models/project.py`
- Create: `backend/app/models/conversation.py`
- Create: `backend/app/models/diagram.py`
- Create: `backend/app/models/audit.py`

**Step 1: Add SQLModel tables**

Add tables for tenants, users, teams, projects, conversations, messages, diagram versions, agent runs, tool calls, and audit events.

**Step 2: Import models during DB init**

Ensure `SQLModel.metadata.create_all` sees all model definitions.

**Step 3: Verify compile**

Run:

```bash
cd backend && python3 -m py_compile app/models/*.py app/core/db.py
```

Expected: no output and exit code `0`.

## Task 10: Add permission context foundation

**Files:**

- Create: `backend/app/services/permission_service.py`
- Modify: `backend/app/api/routes.py`

**Step 1: Parse permission context**

For local MVP, accept optional request fields:

- `tenant_id`
- `user_id`
- `team_id`
- `project_id`
- `roles`
- `scopes`

**Step 2: Build request-scoped permission context**

Attach it to `input_state`.

**Step 3: Verify compile**

Run:

```bash
cd backend && python3 -m py_compile app/services/permission_service.py app/api/routes.py
```

Expected: no output and exit code `0`.

## Task 11: Add RAG and knowledge plan

**Files:**

- Create: `docs/plans/2026-05-26-enterprise-rag-permissions.md`

**Step 1: Define ingestion pipeline**

Document upload, parse, chunk, embedding, metadata and ACL.

**Step 2: Define retrieval policy**

Document tenant filter, project filter, ACL second check and prompt injection rules.

**Step 3: Verify document exists**

Run:

```bash
test -f docs/plans/2026-05-26-enterprise-rag-permissions.md
```

Expected: exit code `0`.

## Task 12: Add export system plan

**Files:**

- Create: `docs/plans/2026-05-26-enterprise-export-system.md`

**Step 1: Define export pipeline**

Document PNG, SVG, PDF, PPTX and JSON export flow.

**Step 2: Define object storage policy**

Document S3/R2 keys, ACL, signed URL and audit records.

**Step 3: Verify document exists**

Run:

```bash
test -f docs/plans/2026-05-26-enterprise-export-system.md
```

Expected: exit code `0`.

## First batch acceptance criteria

The first execution batch is complete when:

- Architecture document exists.
- Implementation plan exists.
- Agent state includes enterprise execution fields.
- Runtime plan builder exists.
- SSE endpoint emits a backward-compatible `execution_plan` event.
- Python compile checks pass.
- Git diff only includes docs and scoped Agent Harness foundation changes.

## Execution Progress - 2026-05-26

Completed beyond the first batch:

- Added permission context parsing and enterprise Agent state fields.
- Added Knowledge Agent and permission-aware retrieval foundation.
- Added SQLModel persistence for tenants, users, teams, projects, conversations, messages, diagrams, diagram versions, agent runs, audit events, knowledge records, and exports.
- Added non-blocking audit and diagram persistence services.
- Added version-aware export API and frontend export integration.
- Added Docker PostgreSQL smoke command for the enterprise persistence/export loop.
- Added project membership enforcement for project-scoped knowledge retrieval and export access.
- Added audit/observability APIs for project-scoped audit events and Agent runs.
- Added runtime guardrails for rate limiting, token/cost estimation, request degradation, and Agent loop protection.

Latest verification:

```bash
python3 -m compileall -q app scripts
npm run build
npm run smoke:runtime
npm run smoke:enterprise
npm run smoke:knowledge
git diff --check
```

Result:

- Backend compile passed.
- Frontend build passed, with only existing large Vite chunk warnings.
- Runtime guard smoke passed for rate limiting, token budget denial, degradation, and loop protection.
- Enterprise smoke passed against Docker PostgreSQL for JSON, SVG, PNG, PDF, PPTX exports, project-member export access, outsider denial, and audit event query.
- Knowledge smoke passed against Docker PostgreSQL for upload, chunking, citation, tenant/project/member/role/scope isolation.
- Diff whitespace check passed.

## Execution Update - 2026-05-26 Export Agent Planning Node

Implemented:

- Replaced the Export Agent placeholder with a permission-aware export planning node.
- Diagram agents now route through `export_agent` before graph completion; general chat still exits directly.
- Export Agent computes allowed and denied formats from request scopes, picks a preferred format, and recommends `sync` or `queued` mode per format.
- Chat streaming now emits an `export_plan` SSE event and persists `export.plan.created` audit metadata.
- Frontend chat messages store and display the export plan summary.
- `smoke:runtime` verifies the execution plan includes the export step and the Export Agent enforces format permissions without external LLM calls.

## Execution Update - 2026-05-26 Validator Agent Node

Implemented:

- Added `validator_agent` as a real LangGraph node between diagram generation and Export Agent planning.
- Validator Agent extracts the final `<code>` block from the latest diagram Agent response and runs deterministic output validation.
- Validation results are written into `memory_context.validation`, `validation_errors`, `tool_calls`, and `validator.output.checked` audit metadata.
- Chat streaming now emits a `validation_agent` SSE event while keeping the existing streaming `validation` event for immediate UI feedback.
- Diagram Agent topology is now `Knowledge Agent -> Diagram Agent -> Validator Agent -> Export Agent`.
- `smoke:runtime` verifies graph topology and Validator Agent pass/fail behavior without external LLM calls.

## Execution Update - 2026-05-26 Planner Agent Node

Implemented:

- Added `planner_agent` as a deterministic LangGraph node between Router and Knowledge Agent.
- Planner Agent decomposes diagram requests into auditable subtasks, output contracts, quality gates, assumptions, knowledge requirements, and fallback strategy without making an LLM call.
- Planner results are written into `memory_context.planning`, `execution_plan`, `tool_calls`, and `planner.plan.created` audit metadata.
- Chat streaming now emits a sanitized `planner_plan` SSE event and refreshes the `execution_plan` event after the planner marks its step complete.
- The frontend stores and displays a compact Plan card on assistant messages.
- Diagram Agent topology is now `Router -> Planner Agent -> Knowledge Agent -> Diagram Agent -> Validator Agent -> Export Agent`.
- `smoke:runtime` verifies graph topology and Planner Agent behavior without external LLM calls.

## Execution Update - 2026-05-26 Design Agent Node

Implemented:

- Added `design_agent` as a deterministic LangGraph node between diagram generation and Validator Agent.
- Design Agent applies safe readability/style normalization without extra LLM calls:
  - React Flow: default positions, node style defaults, edge style defaults, no rotation/transform.
  - ECharts: transparent background, semantic palette, tooltip, toolbox, legend and grid defaults.
  - Excalidraw: roughness/opacity/angle defaults, rounded shapes, text line-height/font defaults.
  - Mermaid/Mindmap: code fence cleanup and mindmap root heading fallback.
  - Infographic: default theme when missing.
- Optimized output is appended as the latest diagram message so Validator Agent validates the designed version.
- Chat streaming emits a `design_agent` SSE event, then overrides the final canvas code when deterministic design changes were applied.
- Frontend messages now show a compact Design card listing applied normalization rules.
- Diagram Agent topology is now `Router -> Planner Agent -> Knowledge Agent -> Diagram Agent -> Design Agent -> Validator Agent -> Export Agent`.
- `smoke:runtime` verifies graph topology and Design Agent behavior without external LLM calls.

## Execution Update - 2026-05-26 Repair Agent Node

Implemented:

- Added `repair_agent` as a deterministic LangGraph node after Validator Agent and before Export Agent.
- Repair Agent attempts common non-LLM output corrections:
  - React Flow: add missing `nodes` / `edges` arrays.
  - ECharts: strip code fences and add missing `series`.
  - Excalidraw: wrap a single element object or add an empty `elements` array.
  - Mermaid/Mindmap: strip code fences and add a mindmap root heading when needed.
  - Draw.io: add a missing closing `</mxfile>` tag when the root exists.
  - Infographic: wrap non-object JSON into a JSON object.
- Repair results are written into `memory_context.repair`, `tool_calls`, and `repair.output.checked` audit metadata.
- Repaired code is appended as the latest diagram message so downstream export planning and final persistence can use the corrected payload.
- Chat streaming emits a sanitized `repair_agent` SSE event and overrides the final canvas code when repair succeeds.
- Frontend messages now show a compact Repair card for successful repairs or unrepaired validation failures.
- Diagram Agent topology is now `Router -> Planner Agent -> Knowledge Agent -> Diagram Agent -> Design Agent -> Validator Agent -> Repair Agent -> Export Agent`.
- `smoke:runtime` verifies graph topology and Repair Agent behavior without external LLM calls.

## Execution Update - 2026-05-26 Version Branch and Rollback

Implemented:

- Added append-only diagram version branching and rollback services.
- Added `GET /api/diagrams/{diagram_id}/versions`, `GET /api/diagrams/{diagram_id}/versions/{version_id}/diff`, `POST /api/diagrams/{diagram_id}/versions/{version_id}/branch`, and `POST /api/diagrams/{diagram_id}/versions/{version_id}/rollback`.
- Branching creates a separate diagram from a historical version and records lineage in metadata.
- Rollback appends a new current version copied from a historical version instead of overwriting history.
- Version diff explains line-level and structured graph changes without invoking an LLM.
- Branch and rollback require `diagram:write`, tenant/project access, and emit audit events.
- Diff requires `diagram:read`, tenant/project access, and emits audit events.
- Chat messages with persisted diagram versions now expose compare, branch, and rollback actions.
- `smoke:enterprise` verifies version branching, diff, rollback, outsider denial, and audit records.

## Execution Update - 2026-05-26 Version Diff UX

Implemented:

- Added a deterministic backend diff builder for immutable diagram versions.
- Added structured JSON diff summaries for React Flow-style nodes/edges and generic top-level JSON changes.
- Added chat-side `对比` action for persisted diagram messages.
- Comparison results are written back as a concise assistant message with line counts, node/edge counts, label changes, and preview lines.
- `smoke:enterprise` verifies the diff between a changed version and rollback version captures the expected node label reversal and records `diagram.version.diff.viewed`.

Latest verification:

```bash
uv run python -m compileall -q app scripts
npm run build
npm run smoke:enterprise
npm run smoke:runtime
npm run smoke:ops
git diff --check
```

Result:

- Backend compile passed.
- Frontend build passed, with only existing large Vite chunk warnings.
- Enterprise smoke passed with version branch, diff, rollback, approval, export confirmation, async/queued export, storage, and audit coverage.
- Runtime guard smoke passed.
- Ops metrics smoke passed.
- Diff whitespace check passed.

## Execution Update - 2026-05-26 Consistency Agent Node

Implemented:

- Added `consistency_agent` after Repair Agent and before Export Agent.
- Consistency Agent checks the final generated DSL against explicit constraints from authorized knowledge chunks.
- Supported deterministic constraints:
  - metadata keys such as `required_terms`, `must_include_terms`, `forbidden_terms`, and `must_not_include_terms`
  - directive-like chunk text such as `required_terms: 客户询价, 销售核价` and `forbidden_terms: 私下折扣`
- When conflicts exist, the graph stops before Export Agent and marks the result as needing user confirmation.
- Chat streaming emits a sanitized `consistency_agent` SSE event and the frontend displays a compact Consistency card.
- Execution steps, trace aggregation, tool calls, audit events, and ops smoke coverage now include the `consistency` step.
- `smoke:runtime` verifies topology and conflict detection without external LLM calls.

## Execution Update - 2026-05-26 Human Approval Requests

Implemented:

- Added durable `human_approval_requests` persistence for Agent checkpoints that need explicit user or reviewer approval.
- Added approval APIs:
  - `POST /api/approvals`
  - `GET /api/approvals`
  - `GET /api/approvals/{approval_id}`
  - `POST /api/approvals/{approval_id}/decision`
- Added `approval:read` and `approval:write` scopes to the default permission model and project role mapping.
- When Consistency Agent marks a saved diagram as needing user input, the SSE route now persists an approval request and emits `human_approval_required`.
- Frontend chat messages now render an approval card with approve/reject actions backed by the approval API.
- Approval creation and decisions emit `human.approval.requested` and `human.approval.decided` audit events.
- `smoke:enterprise` verifies approval creation, approval decision, project outsider denial, and approval audit records against Docker PostgreSQL.

Latest verification:

```bash
DATABASE_URL=postgresql+asyncpg://postgres:smartdiagram_secret@localhost:5432/smartdiagram uv run python -c "import asyncio; from app.core.db import init_db; asyncio.run(init_db()); print('OK: database tables initialized')"
uv run python -m compileall -q app scripts
npm run build
npm run smoke:enterprise
npm run smoke:runtime
npm run smoke:ops
git diff --check
```

Result:

- Docker Postgres and Redis were already running; no native PostgreSQL install was needed.
- Database metadata was initialized successfully against the Docker database.
- Backend compile passed.
- Frontend build passed, with only existing large Vite chunk warnings.
- Enterprise smoke passed, including version branch/rollback, approval request, approval decision, outsider denial, export confirmation, async/queued export, storage, and audit metrics.
- Runtime and ops smokes passed.
- Diff whitespace check passed.

## Execution Update - 2026-05-26 Approval Observability

Implemented:

- Connected human approval checkpoints to the enterprise observability surface.
- `/api/audit/metrics` now reports approval request totals, pending count, status/type counts, and oldest pending age.
- `/api/audit/prometheus` now exposes approval request gauges.
- Agent Ops dashboard now shows pending approvals and supports approve/reject actions through the approval API.
- `smoke:ops` now creates a pending approval, verifies JSON metrics, approval list authorization, Prometheus approval metrics, and denial without `approval:read`.

Latest verification:

```bash
uv run python -m compileall -q app scripts
npm run build
npm run smoke:ops
npm run smoke:enterprise
git diff --check
```

Result:

- Backend compile passed.
- Frontend build passed, with only existing large Vite chunk warnings.
- Ops smoke passed with pending approval visibility and approval permission denial coverage.
- Enterprise smoke passed for versioning, approval decision, export confirmation, async/queued export, storage, and audit metrics.
- Diff whitespace check passed.

## Execution Update - 2026-05-26 Enterprise Template Governance

Implemented:

- Added `diagram_templates` persistence for governed team/project/tenant diagram templates.
- Added template permission scopes: `template:read` and `template:write`, with compatibility fallback to `knowledge:read` and `knowledge:write`.
- Added `diagram_template_service` with authorized create/list, deterministic ranking, usage counting, and audit events.
- Added `POST /api/knowledge/templates` and `GET /api/knowledge/templates`.
- Knowledge Agent now selects an authorized governed template during retrieval and stores it in `memory_context.knowledge.selected_template`.
- Diagram prompts now include a `GOVERNED DIAGRAM TEMPLATE` section when a template is selected.
- Frontend Knowledge card now surfaces selected template name and match score.
- `smoke:knowledge` verifies template creation, ranking, permission denial, project isolation, and Knowledge Agent selection.

Latest verification:

```bash
uv run python -m compileall -q app scripts
npm run build
npm run smoke:knowledge
npm run smoke:enterprise
npm run smoke:runtime
npm run smoke:ops
git diff --check
```

Result:

- Backend compile passed.
- Frontend build passed, with only existing large Vite chunk warnings.
- Knowledge smoke passed with template governance and RAG permission coverage.
- Enterprise, runtime, and ops smokes passed.
- Diff whitespace check passed.

## Execution Update - 2026-05-26 Enterprise Conversation Memory

Implemented:

- Added `conversation_memory_service` for deterministic short-term memory loading, formatting, and summary updates.
- Diagram persistence now updates `Conversation.summary` and `context_json.short_term_memory` whenever a new diagram version is saved.
- `/chat/stream` now loads authorized conversation memory before building LangChain messages, injects it as guarded context, stores it in `memory_context.conversation`, emits a sanitized `conversation_memory` SSE event, and writes `conversation.memory.loaded` audit metadata.
- Enterprise smoke coverage now verifies persisted summaries, turn counts, current version pointers, recent message loading, and Agent prompt formatting.
- Added detailed execution documentation in `docs/plans/2026-05-26-enterprise-conversation-memory.md`.

Latest verification:

```bash
uv run python -m compileall -q app scripts
npm run smoke:enterprise
npm run smoke:runtime
git diff --check
```

## Execution Update - 2026-05-26 Enterprise UI Dialogs and i18n

Implemented:

- Added a lightweight frontend i18n layer with Chinese and English dictionaries.
- Persisted the selected UI language in browser-local storage so refreshes keep the user's language choice.
- Added a chat-header language toggle.
- Added reusable `TextInputDialog`, `ConfirmDialog`, and `NoticeDialog` components.
- Replaced browser-native branch naming prompts with in-app dialogs.
- Replaced rollback and high-risk export browser confirmations with in-app confirmation dialogs.
- Replaced frontend `alert()` calls with product-owned notice dialogs.
- Moved history, preferences, export, approval, Agent Ops, settings, and primary canvas UI copy onto i18n keys.
- Moved ChatPanel empty-state examples, input toolbar copy, streaming status messages, thinking timeline, Knowledge/Consistency cards, and version diff/action labels onto i18n keys.
- Moved export failure messages and the React Flow inline-edit tooltip onto i18n keys.
- Moved Draw.io, Mermaid, Charts, Mindmap, and Infographic canvas loading, error, toolbar, theme, zoom, and pagination labels onto i18n keys.
- Moved the chat header subtitle and settings model configuration labels onto i18n keys.
- Moved Agent Ops metric labels, audit signal event types, run statuses, phases, engines, approval types, and trace metadata onto i18n keys while preserving raw audit keys in hover titles.
- Reduced the chat header to History and Settings, then grouped diagram preferences, Agent Ops, language, theme, and clear conversation inside the settings dialog.
- Reworked Settings into a left-navigation settings center and embedded Diagram Preferences and Agent Ops inside the same panel instead of opening secondary overlays.
- Verified no `window.prompt`, `window.confirm`, or `alert()` usage remains under `frontend/src`.
- Added detailed execution documentation in `docs/plans/2026-05-26-enterprise-ui-i18n-dialogs.md`.

Latest verification:

```bash
npm run build
rg -n "window\\.prompt|window\\.confirm|alert\\(" frontend/src
npm run smoke:enterprise
npm run smoke:runtime
git diff --check
```

Result:

- Frontend build passed, with only existing large Vite chunk warnings.
- Browser-native prompt/confirm/alert source scan returned no matches.
- Targeted `ChatPanel.tsx` hardcoded Chinese scan now only reports comments, not user-facing literals.
- Targeted `ExportButton.tsx` and `FlowCanvas.tsx` hardcoded Chinese scan now only reports Flow comments, not user-facing literals.
- Targeted Draw.io, Mermaid, Charts, Mindmap, and Infographic canvas hardcoded Chinese scan now only reports comments, not user-facing literals.
- Browser verification confirmed Agent Ops signals display localized labels such as export download, export created, download link created, and diagram version created instead of raw event keys.
- Browser verification confirmed Settings left navigation switches Diagram Preferences and Agent Ops inside the same settings panel.
- Enterprise and runtime smokes passed after the dialog/i18n work.
- Diff whitespace check passed.

## Execution Update - 2026-05-26 Conversation History API

Implemented:

- Added `conversation_history_service` for permission-aware conversation browsing and replay metadata.
- Added `GET /api/conversations/history` with `query`, `project_id`, `status`, `include_messages`, `include_current_diagram`, and `limit`.
- Conversation history results include summary, current diagram version id, short-term memory metadata, optional bounded recent messages, and an optional authorized current diagram snapshot for canvas hydration.
- Assistant messages include linked visible Agent process metadata when a persisted `agent_run_id` exists: run id, step list, per-step duration, total elapsed time, token estimate, and cost estimate.
- Conversation history searches emit `conversation.history.searched` audit events.
- `smoke:enterprise` now verifies authorized conversation history retrieval, Agent process detail return, current diagram snapshot return, and project-outsider denial.
- The frontend History drawer now has `Diagrams / Conversations` tabs and renders conversation summaries, recent messages, turn count, and visible Agent timing metadata from the conversation history API.
- Conversation history cards now include a resume action that restores the conversation id, recent messages, visible Agent execution steps, and active canvas diagram into the current workspace without adding more header buttons.
- Live assistant messages now render execution plan, short-term conversation memory, and long-term preference cards so the current Agent process, memory usage, preference sources, step count, and elapsed time are visible in the chat timeline.
- The sanitized `conversation_memory` SSE event now includes `turn_count`, and the frontend consumes both `conversation_memory` and `long_term_preferences` events.
- Planner, Design, Repair, Consistency, and Export cards now use bilingual i18n labels instead of hardcoded English titles.
- Conversation history cards now show whether a canvas snapshot is restorable, and resuming a conversation without a restorable current diagram snapshot inserts a visible assistant notice card instead of silently clearing the canvas.

Latest verification:

```bash
uv run python -m compileall -q app scripts
uv run python -m py_compile backend/app/api/routes.py
npm run smoke:enterprise
npm run smoke:runtime
npm run build
git diff --check
```

Result:

- Backend compile passed.
- Enterprise smoke passed with authorized conversation history retrieval, assistant Agent process details, current diagram snapshot hydration data, and project-outsider denial.
- Runtime guard smoke passed.
- Route compile passed after adding `turn_count` to the memory SSE event.
- Frontend build passed after adding the conversation history tab, resume action, canvas hydration, live memory cards, and no-canvas-snapshot indicator, with only existing Vite large chunk warnings.
- Diff whitespace check passed.

## Execution Update - 2026-05-26 Enterprise Diagram History Memory

Implemented:

- Added `diagram_history_service` for authorized historical diagram discovery.
- Added `GET /api/diagrams/history` with query, project, engine, task, include-code, and limit controls.
- Search results include diagram metadata, current version metadata, conversation summary, code hash, and bounded code preview by default.
- Project-scoped diagrams are filtered through `diagram:read` project membership; unprojected private diagrams are limited to owners and tenant admins.
- Each search writes `diagram.history.searched` audit metadata.
- Knowledge Agent now retrieves up to three authorized historical diagrams and stores them in `memory_context.knowledge.historical_diagrams`.
- Diagram prompts now include an `AUTHORIZED HISTORICAL DIAGRAMS` section with bounded previews.
- Frontend Knowledge cards now show referenced historical diagrams.
- Chat header now includes a historical diagram browser with search, one-click canvas loading, and branch creation from historical versions.
- Historical diagram records now include the saved Agent execution process: run id, assistant outcome, visible steps, per-step duration, total elapsed time, token estimate, and cost estimate.
- Branch and rollback versions trace the process back to the source generated version when available.
- Frontend history cards show the AI thinking/execution process summary; loading a history item restores the step timeline in the chat message.
- `smoke:enterprise` verifies authorized history retrieval, current-version/code return, Agent process detail return, Knowledge Agent historical recall, and outsider project denial.
- Added detailed execution documentation in `docs/plans/2026-05-26-enterprise-diagram-history.md`.

Latest verification target:

```bash
uv run python -m compileall -q app scripts
npm run build
npm run smoke:enterprise
npm run smoke:runtime
git diff --check
```

## Execution Update - 2026-05-26 Enterprise Long-Term Preferences

Implemented:

- Added long-term diagram preference memory using existing tenant, team, and user JSON fields.
- Added preference scopes: `preference:read` and `preference:write`.
- Added `GET /api/preferences/diagram` and `PATCH /api/preferences/diagram`.
- Added deterministic preference sanitization, tenant -> team -> user merge, and `preference.diagram.updated` audit events.
- `/chat/stream` now loads authorized long-term preferences into `memory_context.long_term_preferences`, emits a sanitized `long_term_preferences` SSE event, and records `preference.memory.loaded` audit metadata.
- Diagram agent prompts now receive an `AUTHORIZED LONG-TERM DIAGRAM PREFERENCES` section.
- Design Agent can apply flow and chart style preferences deterministically.
- Frontend chat header now includes a diagram preference panel for user/team style preferences.
- Frontend Agent, history, approval, and preference calls now share a local enterprise tenant/team/role/scope context.
- `smoke:enterprise` verifies preference write/read, prompt formatting, Design Agent style application, and write-scope denial.
- Added detailed execution documentation in `docs/plans/2026-05-26-enterprise-long-term-preferences.md`.

Follow-up implementation:

- Added project-level diagram preference overrides backed by `projects.settings_json.diagram_preferences`.
- Preference merge order is now tenant -> team -> user -> project, allowing project style packs to keep project diagrams consistent while explicit user requests still take precedence at runtime.
- Project preference reads and writes require preference scope plus project access; smoke tests cover project override application and outsider denial.
- The settings preference panel now exposes a bilingual Project scope without forcing global history/export calls into project filtering.

Latest verification target:

```bash
uv run python -m compileall -q app scripts
npm run smoke:enterprise
npm run smoke:runtime
git diff --check
```

## Execution Update - 2026-05-28 Office Artifact Platform Planning

Planned:

- Extended the enterprise architecture direction from diagram-only generation toward a generic Artifact Agent Platform.
- Kept diagrams as the first artifact family, while adding a path for HTML email and HTML web report artifacts.
- Chose a controlled `Artifact DSL -> deterministic renderer -> preview/export` architecture instead of letting the LLM emit arbitrary HTML.
- Preserved the existing Agent Harness: Router, Planner, Knowledge, Generator, Design, Validator, Repair, Consistency, Export, permissions, memory, templates, versioning, audit, and export remain the shared platform path.
- Recommended an incremental compatibility layer first: store office artifacts through existing `Diagram/DiagramVersion` with `metadata_json.artifact_type`, then migrate to generic `Artifact/ArtifactVersion` tables after the office MVP is stable.
- Added the detailed execution plan in `docs/plans/2026-05-28-office-artifact-platform.md`.

Latest verification target:

```bash
test -f docs/plans/2026-05-28-office-artifact-platform.md
rg -n "Artifact|html_email|web_report_html" docs/enterprise-agent-platform-architecture.md docs/plans/2026-05-28-office-artifact-platform.md docs/plans/2026-05-26-agent-platform-upgrade.md
git diff --check
```
