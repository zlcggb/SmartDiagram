# Enterprise Diagram Versioning and Branching Plan

**Goal:** 将“用户目标不断变化”的兜底策略落成企业级版本能力：历史版本不可变、回滚通过追加新版本实现、需求变化通过 task branch 保留原链路。

## Versioning Rules

- `diagram_versions` is append-only; never overwrite generated code.
- `diagrams.current_version_id` points to the active version.
- Rollback copies a historical version into a new immutable version and makes that new version current.
- Branching creates a new `diagram` from a source version and stores source lineage in metadata.
- Diff compares immutable versions without invoking an LLM, using line-level and structured JSON summaries where possible.
- Every branch and rollback requires `diagram:write`, project access, tenant isolation, and audit events.
- Every diff requires `diagram:read`, project access, tenant isolation, and audit events.

## API

```text
GET  /api/diagrams/{diagram_id}/versions
GET  /api/diagrams/{diagram_id}/versions/{version_id}/diff?target_version_id=...
POST /api/diagrams/{diagram_id}/versions/{version_id}/branch
POST /api/diagrams/{diagram_id}/versions/{version_id}/rollback
```

## Audit Events

| Event | Meaning |
| --- | --- |
| `diagram.branch.created` | Created a new task branch from a historical version |
| `diagram.version.rollback` | Appended a rollback version copied from a historical version |
| `diagram.version.diff.viewed` | Viewed a deterministic diff between two immutable versions |

## Execution Update - 2026-05-26

Implemented:

- Added `diagram_version_service` for authorized version listing, task branching, and append-only rollback.
- Added diagram routes for version list, branch, and rollback operations.
- Wired the routes into FastAPI.
- Added chat-side controls to branch from a generated chart message or rollback to a previous message version.
- Extended `smoke:enterprise` to verify:
  - a second version can be persisted for the same diagram,
  - a branch creates a separate diagram preserving source code,
  - rollback appends a new current version without overwriting history,
  - project outsiders cannot branch,
  - branch and rollback audit events are queryable.

## Execution Update - 2026-05-26 Version Diff

Implemented:

- Added deterministic version diff payloads with version metadata, code hashes, line delta, added/removed counts, changed block count, preview lines, and truncated unified diff output.
- Added structured JSON diff support for graph-like payloads, including node/edge added, removed, changed, and label-change summaries.
- Added `GET /api/diagrams/{diagram_id}/versions/{version_id}/diff`, defaulting the target to the diagram current version.
- Diff reads enforce `diagram:read`, tenant isolation, project membership, and emit `diagram.version.diff.viewed` audit events.
- Chat messages with persisted diagram versions now expose a `对比` action that compares the message version with the current canvas version and writes a readable summary back into the conversation.
- `smoke:enterprise` verifies rollback diff output, outsider denial, and diff audit visibility.
