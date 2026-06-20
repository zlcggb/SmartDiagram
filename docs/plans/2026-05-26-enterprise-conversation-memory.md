# Enterprise Conversation Memory Execution Plan

## Goal

Upgrade SmartDiagram from frontend-only chat history to server-side, permission-aware short-term memory that survives refreshes, feeds the Agent graph, and remains auditable.

## Scope

- Persist a deterministic summary for each conversation.
- Store the latest diagram version and turn metadata in `Conversation.context_json`.
- Load authorized conversation memory before each `/chat/stream` LangGraph run.
- Inject memory as context only, not as executable instructions.
- Verify memory persistence and prompt formatting in the enterprise smoke test.
- Expose an authorized conversation history API for browsing and replay.

## Data Placement

| Data | Store | Reason |
| --- | --- | --- |
| Conversation summary | PostgreSQL `conversations.summary` | Durable, queryable, auditable |
| Current version and last engine/task | PostgreSQL `conversations.context_json` | Structured state for resume and trace |
| Recent messages | PostgreSQL `messages` | Source of truth for conversation replay |
| Agent execution process | `agent_runs.execution_steps_json` + `messages.metadata_json.agent_run_id` | Show visible AI working steps, elapsed time, token estimate, and cost for historical assistant turns |
| Full diagram DSL | `diagram_versions.code` | Versioned asset, not duplicated in memory |
| Runtime prompt context | LangGraph `memory_context.conversation` | Request-scoped execution state |

## Implemented Steps

1. Added `conversation_memory_service`.
   - Loads memory only after tenant and project access checks.
   - Formats memory as a guarded prompt section.
   - Builds deterministic summaries without an extra LLM call.

2. Updated diagram persistence.
   - Each generated version updates `Conversation.summary`.
   - `context_json.short_term_memory` tracks turn count, last user request, last assistant outcome, engine/task, and current version id.

3. Updated chat streaming.
   - `/chat/stream` loads persisted memory before building LangChain messages.
   - A `SystemMessage` carries memory as continuity context.
   - LangGraph state receives `memory_context.conversation`.
   - SSE emits a sanitized `conversation_memory` event.
   - Agent run audit includes `conversation.memory.loaded`.

4. Updated enterprise smoke coverage.
   - Confirms two persisted turns update the summary.
   - Confirms current diagram version id is stored.
   - Confirms authorized memory can be loaded and formatted for Agent input.

5. Added authorized conversation history browsing.
   - `GET /api/conversations/history`
   - Supports `query`, `project_id`, `status`, `include_messages`, `include_current_diagram`, and `limit`.
   - Applies tenant and project access checks before returning conversations.
   - Returns bounded conversation summaries, current diagram version id, short-term memory metadata, and optional recent messages.
   - When `include_current_diagram=true`, returns the authorized current diagram snapshot with diagram id, version id, engine, task, design concept, and full DSL code for canvas hydration.
   - Assistant messages include the linked visible Agent process when `metadata_json.agent_run_id` points to an `AgentRun`.
   - Agent process payload includes run id, status, visible steps, per-step duration, total elapsed time, token estimate, and cost estimate.
   - Every search emits `conversation.history.searched` audit metadata.

6. Added frontend conversation history browsing.
   - The existing History drawer now has `Diagrams / Conversations` tabs, keeping the chat header compact.
   - The Conversations tab calls `GET /api/conversations/history?include_messages=true&include_current_diagram=true`.
   - Conversation cards show summary, message count, turn count, current engine, recent message previews, and visible Agent execution timing when available.
   - Conversation cards can be resumed into the active chat context, restoring the conversation id, recent messages, visible Agent execution steps with elapsed timing, and the current canvas diagram when an authorized snapshot is present.
   - The UI uses the shared bilingual i18n dictionary.

7. Added frontend Agent memory visibility in the live message timeline.
   - `/chat/stream` now includes `turn_count` in the sanitized `conversation_memory` event.
   - The frontend consumes `conversation_memory` and `long_term_preferences` SSE events on assistant messages.
   - Assistant messages now render compact cards for execution plan, short-term conversation memory, and long-term diagram preferences.
   - Existing Planner, Design, Repair, Consistency, and Export cards now use bilingual i18n labels instead of hardcoded English titles.
   - The message timeline now exposes visible Agent process state, memory usage, preference sources, step count, and elapsed time without exposing hidden model chain-of-thought.

8. Added explicit canvas hydration state when resuming conversations.
   - Conversation history cards now show whether the active canvas can be restored.
   - Resuming a conversation without an authorized/restorable current diagram snapshot inserts a visible assistant notice card instead of silently clearing the canvas.
   - The notice keeps the conversation messages restored while making clear that the user can continue the conversation to generate a new diagram version.
   - The indicator uses bilingual i18n strings.

## Security Rules

- Memory loading denies tenant mismatch.
- Project-scoped conversations require `diagram:read` through project membership.
- Prompt formatting explicitly tells the model that prior messages are context only.
- Full diagram DSL is not copied into the summary; version ids point to immutable diagram versions.
- Conversation history exposes visible execution trace metadata only; it does not store or expose hidden model chain-of-thought.
- Full diagram DSL is returned from conversation history only when the caller requests `include_current_diagram=true` and passes the same authorization checks needed to read the conversation and diagram.

## Acceptance Checks

```bash
uv run python -m compileall -q app scripts
npm run smoke:enterprise
npm run smoke:runtime
git diff --check
```

Latest verification:

- `uv run python -m compileall -q app scripts` passed.
- `npm run smoke:enterprise` covers authorized conversation history browsing, assistant Agent process detail return, current diagram snapshot return, and project-outsider denial.
- `npm run smoke:runtime` passed.
- `npm run build` passed after wiring the frontend conversation history tab, resume action, and canvas hydration, with only existing Vite large chunk warnings.
- `npm run build` passed after adding live conversation memory, long-term preference, and execution plan cards.
- `npm run build` passed after adding the no-canvas-snapshot resume indicator.
- `uv run python -m py_compile backend/app/api/routes.py` passed after adding `turn_count` to the memory SSE event.
- `git diff --check` passed.

## Follow-Up Candidates

- Add Redis-backed active session cache for high-frequency UI collaboration.
- Add LLM-assisted summary compaction behind a budget guard.
- Add project-level conversation retention controls once archival policies are configurable.
