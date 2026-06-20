# Enterprise Artifact Template Governance Plan

**Goal:** 将“通用生成 vs 企业模板约束”的 tradeoff 落成可执行能力：团队可以沉淀标准图表和办公产物模板，Agent 在生成前按租户、团队、项目和权限选择模板作为结构化起点。

## Scope

- 团队模板：团队常用流程、架构、报价、审批、数据图表、HTML 邮件和网页分析稿骨架。
- 项目模板：项目内专用流程、业务图表和办公产物模板。
- 租户模板：企业级通用规范模板。
- Agent 应用：Knowledge Agent 在 RAG 检索阶段优先选择有权限模板，并将模板注入给生成 Agent。

## Data Model

新增 `diagram_templates`：

```text
tenant_id
team_id
project_id
name
description
engine_type
task_type
visibility
status
priority
tags_json
template_code
style_json
acl_json
metadata_json
usage_count
created_by
created_at
updated_at
```

## API

```text
POST /api/knowledge/templates
GET  /api/knowledge/templates
```

## Permission Rules

- `template:read` 控制模板读取；为了兼容知识库检索链路，`knowledge:read` 也允许读模板。
- `template:write` 控制模板创建；为了兼容知识库维护链路，`knowledge:write` 也允许写模板。
- 项目模板必须通过项目成员和 scope 校验。
- 团队模板只允许同团队或租户管理员访问。
- 图表模板选择结果写入审计事件 `diagram.template.selected`。
- 非图表办公产物模板选择结果写入审计事件 `artifact.template.selected`。

## Execution Update - 2026-05-26

Implemented:

- Added `DiagramTemplate` persistence model.
- Added `diagram_template_service` for creation, authorization, deterministic ranking, and selected-template usage counting.
- Added `POST /api/knowledge/templates` and `GET /api/knowledge/templates`.
- Added `template:read` and `template:write` to the default permission model and project role mapping.
- Knowledge Agent now retrieves authorized chunks and selects a governed template in the same retrieval phase.
- Diagram agent prompts now receive a `GOVERNED DIAGRAM TEMPLATE` section when a template is selected.
- Chat knowledge card now shows the selected template name and match score.
- `smoke:knowledge` verifies template create/list, ranking, permission denial, project isolation, and Knowledge Agent selection.

## Execution Update - 2026-05-28

Implemented artifact-compatible template governance without changing the existing table:

- `diagram_templates` now carries `metadata.artifact_family` and `metadata.artifact_type` for office templates such as `html_email` and `web_report_html`.
- `diagram_template_service` keeps the existing diagram functions for compatibility and adds artifact wrappers: `create_artifact_template`, `list_authorized_artifact_templates`, and `select_best_artifact_template`.
- Knowledge Agent now selects through the artifact wrapper, so diagrams and office artifacts share the same permission, ranking, usage-count, and audit path.
- Prompt context now renders `GOVERNED ARTIFACT TEMPLATE` for non-diagram templates while preserving `GOVERNED DIAGRAM TEMPLATE` for diagram engines.
- Office Artifact Agent explicitly treats the governed artifact template as the structural starting point.
- `smoke:office` verifies office template serialization and prompt injection semantics in addition to routing, validation, repair, rendering, and export.
