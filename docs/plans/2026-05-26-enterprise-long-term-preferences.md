# Enterprise Long-Term Preference Memory Execution Plan

## Goal

Add a durable long-term memory layer for diagram style preferences so SmartDiagram can remember tenant, team, user, and project defaults without relying on frontend state or prompt history.

## Scope

- Store diagram and office artifact preferences in existing identity tables.
- Expose read/write API endpoints with explicit preference scopes.
- Merge tenant, team, user, and project preferences deterministically.
- Inject authorized preferences into Agent prompts.
- Let Design Agent apply selected preferences deterministically for supported engines and office artifacts.
- Verify permission denial and Agent behavior in smoke tests.

## Data Placement

| Data | Store | Reason |
| --- | --- | --- |
| Tenant defaults | `tenants.settings_json.diagram_preferences` | Organization-wide defaults, including artifact preferences |
| Team defaults | `teams.settings_json.diagram_preferences` | Shared workspace style |
| User defaults | `users.preferences_json.diagram_preferences` | Personal preference |
| Project overrides | `projects.settings_json.diagram_preferences` | Project-specific style pack |
| Runtime merged memory | `memory_context.long_term_preferences` | Request-scoped Agent context |
| Audit trail | `audit_events` | Enterprise traceability |

## Implemented Steps

1. Added preference permissions.
   - `preference:read`
   - `preference:write`
   - Project role scope defaults include preference read/write where appropriate.

2. Added `long_term_memory_service`.
   - Sanitizes bounded JSON preference payloads.
   - Supports user, team, project, and tenant scopes.
   - Merges preferences as tenant -> team -> user -> project.
   - Formats preferences as guarded Agent context.
   - Writes `preference.diagram.updated` audit events.

3. Added preference API.
   - `GET /api/preferences/diagram`
   - `PATCH /api/preferences/diagram`
   - `GET /api/preferences/artifact`
   - `PATCH /api/preferences/artifact`
   - Missing write scope returns `403`.

4. Integrated Agent execution.
   - `/chat/stream` loads long-term preferences into `memory_context.long_term_preferences`.
   - Stream emits a sanitized `long_term_preferences` event.
   - Agent run audit records `preference.memory.loaded`.
   - Agent prompts receive an `AUTHORIZED LONG-TERM ARTIFACT PREFERENCES` section.

5. Integrated Design Agent.
   - Flow diagrams can consume persisted edge color, edge width, node radius, node padding, node font size, and node width.
   - ECharts diagrams can consume persisted palette and background preferences.

6. Added frontend preference settings UI.
   - Chat header includes a diagram preference panel.
   - Users can load and save user, team, or project diagram preferences.
   - The panel writes flow and chart preferences through `PATCH /api/preferences/diagram`.
   - Chat, approval, history, and preference calls share the same local enterprise tenant/team/role/scope context.

7. Added project-level preference overrides.
   - Project preferences are stored in `projects.settings_json.diagram_preferences`.
   - Project reads require `preference:read` plus project access.
   - Project writes require `preference:write` plus project access.
   - Project overrides are applied after tenant, team, and user defaults so a project style pack can keep diagrams consistent inside a project.
   - Frontend preference sources and scopes are bilingual and include project labels.

## Security Rules

- Read requires `preference:read`.
- Write requires `preference:write`.
- Tenant preference writes require tenant admin-like role.
- Team preference writes require the current team context.
- Project preference reads and writes require access to the current project.
- Stored preference JSON is bounded, sanitized, and limited to supported diagram and office artifact preference domains.

## Execution Update - 2026-05-28 Office Artifact Preferences

Implemented:

- `diagram_preferences` now accepts an `artifact_preferences` object with `html_email` and `web_report_html` keys while preserving the existing diagram keys.
- Long-term preference prompt context is now labeled `AUTHORIZED LONG-TERM ARTIFACT PREFERENCES` and includes office artifact preferences when present.
- Design Agent applies deterministic office artifact preferences:
  - `html_email`: `brand_color`, `tone`, `language`.
  - `web_report_html`: `brand_color`, `tone`, `layout_density`, `include_summary`.
- Frontend preference settings now expose office artifact controls for email tone/language/brand color and report tone/brand color/density/summary.
- `/api/preferences/artifact` is now the preferred route; `/api/preferences/diagram` remains as a backward-compatible alias.
- `smoke:office` covers sanitization, prompt formatting, and deterministic office preference application.
- Preferences never override system instructions, safety rules, permissions, or explicit user requests.

## Acceptance Checks

```bash
uv run python -m compileall -q app scripts
npm run build
npm run smoke:enterprise
npm run smoke:runtime
git diff --check
```

## Follow-Up Candidates

- Add preference import/export for design-system migration.
- Add LLM-assisted preference extraction from repeated user edits behind explicit confirmation.
