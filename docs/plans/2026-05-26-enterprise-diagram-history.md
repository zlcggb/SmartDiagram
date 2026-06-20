# Enterprise Diagram History Memory Execution Plan

## Goal

Add an authorized historical diagram discovery layer so SmartDiagram can reuse prior project diagrams as long-term enterprise memory, not only the current conversation state.

## Scope

- Search historical diagrams by tenant/project permission boundary.
- Support filters for query text, engine type, and task type.
- Return current version metadata, conversation summary, code hash, and optional code.
- Return the persisted Agent execution process for the current version, including run id, steps, durations, assistant outcome, token estimate, and cost estimate.
- Audit every historical search.
- Verify authorized retrieval and cross-project denial in enterprise smoke tests.
- Provide a frontend browser for loading historical diagrams back onto the canvas.

## Data Placement

| Data | Store | Reason |
| --- | --- | --- |
| Logical diagram metadata | `diagrams` | Searchable long-lived diagram asset |
| Immutable versions | `diagram_versions` | Current version and historical code |
| Conversation summary | `conversations.summary` | Lightweight context for reuse |
| Agent execution process | `agent_runs.execution_steps_json` + `messages.metadata_json.agent_run_id` | Reconstruct visible AI thinking/working timeline without storing hidden chain-of-thought |
| Access checks | project membership + tenant boundary | Prevent cross-project leakage |
| Search audit | `audit_events` | Trace reuse of enterprise history |

## Implemented Steps

1. Added `diagram_history_service`.
   - Searches tenant-scoped diagrams.
   - Resolves project scope from request or permission context.
   - Checks `diagram:read`.
   - Applies project membership checks before returning project diagrams.
   - Restricts unprojected private diagrams to owners and tenant admins.
   - Returns current version metadata and bounded previews by default.
   - Resolves the original `AgentRun` through the version's assistant message and returns `agent_process`.
   - Branch and rollback versions can trace back to the source version's original Agent run.

2. Added API endpoint.
   - `GET /api/diagrams/history`
   - Query params: `query`, `project_id`, `engine_type`, `task_type`, `include_code`, `limit`.

3. Added audit trail.
   - Emits `diagram.history.searched` with filters and result count.

4. Integrated Knowledge Agent.
   - Knowledge Agent now retrieves up to three authorized historical diagrams alongside RAG chunks and governed templates.
   - Historical diagrams are stored in `memory_context.knowledge.historical_diagrams`.
   - Diagram prompts receive an `AUTHORIZED HISTORICAL DIAGRAMS` section with bounded previews.
   - The chat Knowledge card surfaces historical diagram references.

5. Added frontend reuse entry.
   - Chat header includes a historical diagrams panel.
   - The panel searches `/api/diagrams/history?include_code=true`.
   - History cards show the saved AI thinking/execution process summary and total elapsed time.
   - Users can load a historical diagram directly into the current canvas.
   - Loading preserves diagram id, version id, engine, task, code, and design concept.
   - Loading restores the saved thinking step timeline when process metadata is available.
   - Users can also create a new branch from a historical version; the branch is loaded onto the canvas without overwriting the source diagram.

6. Updated enterprise smoke.
   - Confirms project owner can find the generated sales quote diagram.
   - Confirms current version id and optional code are returned.
   - Confirms current history item includes Agent process details, step timing, Planner step, run id, and token estimate.
   - Confirms project outsider receives `403`.
   - Confirms Knowledge Agent can retrieve the generated diagram as historical context.

## Security Rules

- Caller must have `diagram:read`.
- Tenant ids must match.
- Project diagrams require `diagram:read` through project membership.
- Unprojected private diagrams are visible only to owner or tenant admin.
- Team-visible diagrams require matching team context.
- Full code is returned only when `include_code=true`; otherwise a bounded preview and code hash are returned.
- History returns visible execution trace metadata only; it does not store or expose hidden model chain-of-thought.
- Frontend branch reuse calls the existing immutable-version branch API, so historical reuse creates a new diagram lineage instead of mutating the source.

## Acceptance Checks

```bash
uv run python -m compileall -q app scripts
npm run build
npm run smoke:enterprise
npm run smoke:runtime
git diff --check
```

## Follow-Up Candidates

- Add SQL full-text indexes or pg_trgm when history volume grows.
- Add project-level retention and archival policies.
