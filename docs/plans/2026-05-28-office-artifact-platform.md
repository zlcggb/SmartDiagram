# Office Artifact Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 SmartDiagram 从“图表生成平台”扩展为可生成、预览、校验、版本化和导出 HTML 邮件、HTML 网页分析稿等常用办公产物的企业级 Artifact Platform。

**Architecture:** 保留现有 `Router -> Planner -> Knowledge -> Generator -> Design -> Validator -> Repair -> Consistency -> Export` 企业级 Agent Harness，把图表抽象为 Artifact 的一个产物族。第一阶段采用增量兼容：新增 Artifact catalog、office artifact agent、HTML renderer 和 ArtifactCanvas，不立即重命名现有 `Diagram` 表和图表 API；通过 `engine_type/task_type/metadata_json.artifact_type` 承载新办公产物，等能力稳定后再做通用 `Artifact` 表迁移。

**Tech Stack:** FastAPI、LangGraph、React、TypeScript、Zustand、PostgreSQL/SQLModel、对象存储 local/S3/R2、现有 RAG/模板/权限/审计/导出服务、前端 sandbox iframe 预览。

---

## Current Findings

现有系统已经具备扩展成办公产物平台的基础：

- `backend/app/agents/orchestrator.py` 已经是多节点 LangGraph：Router、Planner、Knowledge、各图表 Agent、Design、Validator、Repair、Consistency、Export。
- `backend/app/agents/catalog.py` 和 `frontend/src/types/diagram.ts` 当前把产物固定为图表任务和图表引擎。
- `backend/app/api/routes.py` 的 SSE parser 已经抽象为 `<design_concept>` 与 `<code>`，可继续传输非图表 Artifact DSL。
- `backend/app/models/diagram.py`、`backend/app/services/diagram_persistence_service.py` 当前用 `Diagram/DiagramVersion` 保存版本；短期可以兼容保存 HTML Artifact，长期再迁移到通用 `Artifact/ArtifactVersion`。
- `backend/app/services/output_validation.py` 是确定性校验入口，适合加入 HTML 邮件和网页稿的 schema/policy 校验。
- `backend/app/services/export_job_service.py`、`backend/app/services/export_renderers.py` 已经有导出任务和对象存储边界，但当前导出格式以图表为中心，缺少 `html`、`eml`、`markdown` 等办公格式。
- `backend/app/services/diagram_template_service.py` 和 `DiagramTemplate` 虽然命名为 diagram，但字段已经能按 `engine_type/task_type` 选择模板，第一阶段可复用并在 metadata 中标注 artifact family。

## Product Scope

第一批只做高频、低外部依赖的办公产物：

| Artifact | 用户说法 | 输出 | Preview | Export |
| --- | --- | --- | --- | --- |
| HTML Email | 写活动邀请邮件、客户跟进邮件、内部通知邮件 | JSON DSL -> deterministic email HTML | iframe sandbox | html、json，后续 eml |
| HTML Web Report | 写基础 HTML 网页分析稿、项目汇报页、竞品分析页 | JSON DSL -> deterministic static HTML | iframe sandbox | html、pdf、png、json |

明确不在第一批做：

- 直接发送邮件。发送属于高风险外发动作，需要单独 SMTP/ESP connector、审批和审计。
- 让模型自由输出任意 HTML+JS。第一批只允许结构化 DSL，经确定性 renderer 生成 HTML。
- 大规模重命名 `Diagram` 数据模型。先通过兼容层验证产品方向。

## Key Architecture Decision

选择 `Artifact DSL -> deterministic renderer -> preview/export`，不选择 “LLM 直接输出完整 HTML”。

原因：

- HTML 邮件兼容性脆弱，必须限制布局、CSS、图片、链接和脚本。
- 企业场景需要可校验、可审计、可复用模板；结构化 DSL 比任意 HTML 更容易做权限、diff、repair 和版本治理。
- 现有平台的强项是模板、RAG、版本、导出、人审和审计；Artifact DSL 可以复用这些能力。

核心 contract：

```json
{
  "artifact_type": "html_email",
  "title": "客户续费提醒邮件",
  "language": "zh-CN",
  "audience": "企业客户采购负责人",
  "tone": "professional",
  "email": {
    "subject": "续费提醒与服务权益说明",
    "preheader": "请在到期前完成续费以保持服务连续"
  },
  "style": {
    "brand_color": "#2563eb",
    "max_width": 640
  },
  "sections": [
    {
      "type": "hero",
      "heading": "服务即将到期",
      "body": "这里是邮件正文摘要。"
    },
    {
      "type": "cta",
      "label": "查看续费方案",
      "href": "https://example.com/renewal"
    }
  ],
  "citations": []
}
```

## 2026-06-01 Email Template UX Addendum

本轮对标了主流开源邮件工具的设计思路：

- React Email templates：把邮件拆成可组合组件和模板，不让用户直接面对一整串 HTML。
- MJML：强调邮件客户端兼容性，用结构化组件生成 table/inline-style HTML。
- Maizzle：强调内容与模板皮肤分离，便于同一内容切换不同品牌样式。
- EmailBuilder.js / GrapesJS newsletter：强调块级编辑、模板切换和最终 HTML 导出。

落到 SmartDiagram 的实现原则：

- 内容层继续保持 JSON DSL，模型只生成结构化内容，不生成任意 HTML。
- 模板层负责视觉皮肤，用户可在 `商务简报 / 资讯简报 / 产品推广` 间切换，同一内容不重写。
- 邮件正文优先使用 `metric_grid`、`bar_chart`、`timeline`、`comparison`、`list-as-insight-cards` 等办公场景模块，避免模型把内容退化成 `1/2/3/4` 编号清单。
- 编辑态必须面向内容块，而不是让用户手改一长串压缩 HTML；HTML tab 只作为可复制、可精修的最终源码视图。
- HTML 源码展示需要格式化和语法高亮，便于用户复制到邮件系统前做最后调整。
- 渲染器必须保持邮件客户端安全边界：table-based layout、inline style、无脚本、无 iframe、链接白名单。

新增 DSL 类型：

```json
[
  {"type": "metric_grid", "heading": "核心指标", "metrics": [{"label": "转化率", "value": "36%", "delta": "+8%", "note": "较上周提升"}]},
  {"type": "bar_chart", "heading": "关注度分布", "data": [{"label": "自动化报告", "value": 84, "display": "84%"}]},
  {"type": "timeline", "heading": "跟进节奏", "items": [{"phase": "Day 1", "title": "发送邮件", "body": "突出价值与适用人群"}]},
  {"type": "comparison", "heading": "方案对比", "items": [{"label": "传统邮件", "body": "正文堆叠，读者难以抓重点"}]}
]
```

## Task 1: Record Architecture Extension

**Files:**

- Modify: `docs/enterprise-agent-platform-architecture.md`
- Modify: `docs/plans/2026-05-26-agent-platform-upgrade.md`

**Step 1: Add Artifact Platform section**

在企业级架构文档中新增一节，说明平台定位从 `Diagram Agent Platform` 扩展为 `Artifact Agent Platform`：

- Diagram 是 `artifact_family=diagram`。
- HTML Email 是 `artifact_family=office`、`artifact_type=html_email`。
- Web Report 是 `artifact_family=office`、`artifact_type=web_report_html`。
- 所有 Artifact 共享权限、RAG、模板、版本、导出、审计和人审。

**Step 2: Add migration note to original upgrade plan**

在 `2026-05-26-agent-platform-upgrade.md` 的后续阶段追加说明：

- 不立即重命名 `Diagram` 表。
- 新产物先走兼容字段。
- 后续再迁移到通用 `artifacts/artifact_versions`。

**Step 3: Verify docs**

Run:

```bash
rg -n "Artifact|html_email|web_report_html" docs/enterprise-agent-platform-architecture.md docs/plans/2026-05-26-agent-platform-upgrade.md
```

Expected: both files contain the new Artifact extension language.

## Task 2: Add Backend Artifact Catalog

**Files:**

- Create: `backend/app/artifacts/__init__.py`
- Create: `backend/app/artifacts/catalog.py`
- Modify: `backend/app/agents/catalog.py`

**Step 1: Create generic artifact catalog**

Add a stable registry for current diagrams and new office artifacts:

```python
ARTIFACT_TYPES = {
    "html_email": {
        "family": "office",
        "engine_type": "html_email",
        "task_type": "html_email",
        "agent_node": "office_artifact_agent",
        "output_format": "office_artifact_dsl",
        "validator": "html_email_artifact",
        "default_exports": ["html", "json"],
    },
    "web_report_html": {
        "family": "office",
        "engine_type": "web_report_html",
        "task_type": "web_report_html",
        "agent_node": "office_artifact_agent",
        "output_format": "office_artifact_dsl",
        "validator": "web_report_artifact",
        "default_exports": ["html", "pdf", "png", "json"],
    },
}
```

Keep diagram entries in the same catalog or adapt them through helper functions.

**Step 2: Preserve diagram compatibility**

`backend/app/agents/catalog.py` should continue exporting `TaskType`, `EngineType`, `TASK_TO_ENGINE`, `ENGINE_TO_TASK`, `get_task_for_engine`, and `get_default_engine_for_task`.

Add the new task/engine strings without changing existing ones:

```python
"html_email"
"web_report_html"
```

**Step 3: Verify compile**

Run:

```bash
cd backend && python3 -m py_compile app/artifacts/catalog.py app/agents/catalog.py
```

Expected: no output and exit code `0`.

## Task 3: Extend Router for Office Artifacts

**Files:**

- Modify: `backend/app/agents/router.py`
- Test: `backend/scripts/smoke_enterprise_flow.py`

**Step 1: Add engine descriptions**

Add router descriptions:

- `html_email`: responsive, email-client-safe HTML email drafts, internal notices, customer follow-ups.
- `web_report_html`: static HTML analysis pages, project reports, competitive analysis pages, executive brief pages.

**Step 2: Add keyword routing**

Add routing hints for Chinese and English:

```python
"html_email": ["html邮件", "邮件模板", "edm", "newsletter", "email template", "客户邮件", "活动邀请邮件"],
"web_report_html": ["html网页", "网页分析稿", "分析页面", "报告页", "web report", "html report", "竞品分析页"]
```

**Step 3: Add explicit tags**

Add:

```python
"@email": "html_email",
"@html-email": "html_email",
"@web-report": "web_report_html",
"@html-report": "web_report_html"
```

**Step 4: Verify routing smoke**

Add a lightweight assertion to the existing smoke script or create a narrow helper in that script:

```python
assert detect_task_from_keywords("帮我写一个客户续费 HTML 邮件", "") == "html_email"
assert detect_task_from_keywords("生成一个基础 HTML 网页分析稿", "") == "web_report_html"
```

Run:

```bash
cd backend && python3 -m py_compile app/agents/router.py scripts/smoke_enterprise_flow.py
```

Expected: no output and exit code `0`.

## Task 4: Add Office Artifact Agent Node

**Files:**

- Create: `backend/app/agents/office_artifact_agent.py`
- Modify: `backend/app/agents/orchestrator.py`
- Modify: `backend/app/agents/context.py`

**Step 1: Implement agent prompt**

The agent must output:

```text
<design_concept>
Explain audience, structure, compliance assumptions, and how authorized knowledge was used.
</design_concept>
<code>
{office_artifact_json}
</code>
```

The system prompt must require:

- valid JSON only inside `<code>`;
- no JavaScript;
- no tracking pixels unless user explicitly asks and export scope allows it;
- links kept as text or safe HTTPS URLs;
- citations kept as source ids, not copied confidential blocks.

**Step 2: Add LangGraph node**

Register `office_artifact_agent` in `orchestrator.py`.

Route both `html_email` and `web_report_html` from `route_decision` to `office_artifact_agent`.

**Step 3: Preserve downstream flow**

Connect:

```text
office_artifact_agent -> design_agent -> validator_agent -> repair_agent -> consistency_agent -> export_agent
```

**Step 4: Verify compile**

Run:

```bash
cd backend && python3 -m py_compile app/agents/office_artifact_agent.py app/agents/orchestrator.py app/agents/context.py
```

Expected: no output and exit code `0`.

## Task 5: Add Office Output Contracts to Planner

**Files:**

- Modify: `backend/app/agents/planner_agent.py`
- Modify: `backend/app/services/agent_runtime.py`

**Step 1: Add output contracts**

Add planner contracts:

```python
"html_email": {
    "format": "office_artifact_dsl",
    "required": ["artifact_type", "email.subject", "sections"],
    "validator": "html_email_artifact",
},
"web_report_html": {
    "format": "office_artifact_dsl",
    "required": ["artifact_type", "title", "sections"],
    "validator": "web_report_artifact",
},
```

**Step 2: Generalize labels**

In `build_default_execution_plan`, avoid hardcoded “图表” for office engines. Use:

- diagrams: `生成 ... 结构化图表`
- office artifacts: `生成 ... 办公产物草稿`

**Step 3: Verify planner output**

Run:

```bash
cd backend && python3 -m py_compile app/agents/planner_agent.py app/services/agent_runtime.py
```

Expected: no output and exit code `0`.

## Task 6: Add HTML Artifact Renderer

**Files:**

- Create: `backend/app/services/html_artifact_renderer.py`
- Create: `backend/app/services/html_policy.py`
- Test: `backend/scripts/smoke_office_artifacts.py`

**Step 1: Render email HTML deterministically**

Implement:

```python
def render_html_email_artifact(payload: dict) -> str:
    ...
```

Rules:

- table-based outer layout;
- max width defaults to `640`;
- inline CSS only for MVP;
- subject/preheader returned in metadata, not hidden in visible body only;
- buttons render as safe `<a>` elements;
- unsupported sections become plain text blocks instead of failing.

**Step 2: Render web report HTML deterministically**

Implement:

```python
def render_web_report_artifact(payload: dict) -> str:
    ...
```

Rules:

- static HTML only;
- no script tags;
- no inline event handlers;
- no external JS;
- charts can be rendered as static tables or SVG placeholders in first batch.

**Step 3: Add policy helper**

Implement:

```python
BLOCKED_HTML_TAGS = {"script", "iframe", "object", "embed", "form"}
BLOCKED_ATTR_PREFIXES = ("on",)
```

Check rendered HTML for blocked tags, blocked attributes, `javascript:` URLs, and oversized output.

**Step 4: Add smoke script**

The smoke script should render one email and one report, then assert:

- output contains `<html`;
- output does not contain `<script`;
- email output contains subject metadata in renderer result;
- report output contains the requested heading.

Run:

```bash
cd backend && python3 -m py_compile app/services/html_artifact_renderer.py app/services/html_policy.py scripts/smoke_office_artifacts.py
cd backend && uv run python scripts/smoke_office_artifacts.py
```

Expected: smoke prints `OK: office artifact renderers passed`.

## Task 7: Add Office Artifact Validation and Repair

**Files:**

- Modify: `backend/app/services/output_validation.py`
- Modify: `backend/app/services/output_repair.py`
- Test: `backend/scripts/smoke_office_artifacts.py`

**Step 1: Validate office DSL**

Add validation for:

- JSON parse success.
- `artifact_type` is `html_email` or `web_report_html`.
- `sections` is a non-empty list.
- HTML email has `email.subject`.
- CTA links must be `https://`, `mailto:`, relative, or empty.
- rendered HTML passes `html_policy`.

**Step 2: Repair common issues**

Add deterministic repairs:

- strip markdown code fences;
- coerce missing `sections` from `body` text;
- remove blocked section types;
- normalize unsafe links to plain text;
- add missing `artifact_type` from current engine.

**Step 3: Verify validation**

Run:

```bash
cd backend && uv run python scripts/smoke_office_artifacts.py
```

Expected: valid examples pass, unsafe examples fail or repair deterministically.

## Task 8: Persist Office Artifacts Through Compatibility Layer

**Files:**

- Modify: `backend/app/services/diagram_persistence_service.py`
- Modify: `backend/app/models/diagram.py`
- Modify: `backend/app/services/diagram_history_service.py`

**Step 1: Add compatibility metadata**

When `engine_type` is `html_email` or `web_report_html`, persist into existing tables with:

```python
Diagram.metadata_json["artifact_family"] = "office"
Diagram.metadata_json["artifact_type"] = engine_type
DiagramVersion.validation_json["artifact_type"] = engine_type
```

Do not change table names in this task.

**Step 2: Generalize titles**

For office artifacts, default titles should be:

- `html_email`: email subject or user message.
- `web_report_html`: report title or user message.

**Step 3: Make history filters work**

Allow history search by the new `engine_type/task_type` strings. Keep existing diagram history UI compatible.

**Step 4: Verify compile**

Run:

```bash
cd backend && python3 -m py_compile app/services/diagram_persistence_service.py app/models/diagram.py app/services/diagram_history_service.py
```

Expected: no output and exit code `0`.

## Task 9: Add Export Formats for Office Artifacts

**Files:**

- Modify: `backend/app/agents/export_agent.py`
- Modify: `backend/app/services/export_renderers.py`
- Modify: `backend/app/services/export_job_service.py`
- Modify: `backend/app/services/permission_service.py`

**Step 1: Add formats**

Add:

- `html`: basic export scope.
- `eml`: future email export scope; first batch may return unsupported unless implemented.
- `markdown`: optional report fallback.

**Step 2: Render HTML exports**

If `version.engine_type` is `html_email` or `web_report_html`, parse the stored DSL and call `html_artifact_renderer`.

Return:

```python
{
    "mime_type": "text/html; charset=utf-8",
    "extension": "html",
    "metadata": {"renderer": "office-artifact-html", "artifact_type": version.engine_type}
}
```

**Step 3: Keep PDF/PNG scoped**

For `web_report_html`, PDF/PNG can remain queued and rendered later by a browser renderer. For first batch, if browser rendering is unavailable, return a clear `RenderUnsupported`.

**Step 4: Verify export smoke**

Add to `smoke_office_artifacts.py`:

- create a fake `DiagramVersion` for `html_email`;
- call `render_result_for_format(..., "html")`;
- assert MIME type starts with `text/html`.

Run:

```bash
cd backend && uv run python scripts/smoke_office_artifacts.py
```

Expected: HTML export smoke passes.

## Task 10: Add Frontend Artifact Types and Agent Picker Entries

**Files:**

- Create: `frontend/src/types/artifact.ts`
- Modify: `frontend/src/types/diagram.ts`
- Modify: `frontend/src/config/diagramAgents.ts`
- Modify: `frontend/src/i18n.ts`

**Step 1: Add generic artifact types**

Create:

```ts
export type ArtifactEngineType =
  | DiagramEngineType
  | 'html_email'
  | 'web_report_html';

export type ArtifactTaskType =
  | DiagramTaskType
  | 'html_email'
  | 'web_report_html';
```

**Step 2: Keep diagram types compatible**

Do not remove existing `DiagramEngineType` and `DiagramTaskType`. Existing canvas components should still compile.

**Step 3: Add picker metadata**

Add two entries:

- label `HTML 邮件`
- label `网页分析稿`

Use icons from `lucide-react`, such as `Mail` and `FileText`.

**Step 4: Add i18n text**

Add Chinese and English labels for new artifact types, statuses, preview tabs, and export names.

**Step 5: Verify frontend compile**

Run:

```bash
cd frontend && npm run build
```

Expected: build succeeds.

## Task 11: Add Artifact Canvas Preview

**Files:**

- Create: `frontend/src/components/canvas/ArtifactCanvas.tsx`
- Create: `frontend/src/components/canvas/htmlArtifactRenderer.ts`
- Modify: `frontend/src/components/layout/CanvasPanel.tsx`
- Modify: `frontend/src/store/chatStore.ts`

**Step 1: Implement frontend renderer**

The frontend renderer should parse office DSL and generate a safe preview HTML string.

For MVP, duplicate only the minimal renderer behavior needed for live preview:

- heading;
- text block;
- bullet list;
- CTA;
- summary/table section.

Backend remains source of truth for export.

**Step 2: Use sandbox iframe**

Render with:

```tsx
<iframe
  sandbox=""
  srcDoc={html}
  title="Artifact preview"
/>
```

No `allow-scripts`.

**Step 3: Add preview/source tabs**

The canvas should offer:

- Preview
- DSL
- Rendered HTML

Do not put long instructions inside the app UI; use compact labels only.

**Step 4: Wire CanvasPanel**

Route:

```tsx
case 'html_email':
case 'web_report_html':
  return <ArtifactCanvas />;
```

**Step 5: Verify frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: build succeeds.

## Task 12: Extend SSE Handling for Office Artifacts

**Files:**

- Modify: `frontend/src/components/chat/ChatPanel.tsx`
- Modify: `frontend/src/store/chatStore.ts`
- Modify: `backend/app/api/routes.py`

**Step 1: Accept new route events**

Frontend must accept `engine: "html_email"` and `engine: "web_report_html"` without falling back to general text.

**Step 2: Preserve current code streaming**

The existing `code_start/code/code_complete/code_end` events should still update `streamingCode` and `canvasCode`.

**Step 3: Generalize status labels**

In backend route status labels, replace hardcoded `图表` wording for office agents:

- office: `生成办公产物`
- diagrams: existing labels.

**Step 4: Verify local flow**

Run dev server and submit:

```text
@email 帮我写一封客户续费提醒 HTML 邮件，语气专业，包含按钮
```

Expected:

- route event uses `html_email`;
- canvas switches to ArtifactCanvas;
- preview displays rendered email;
- saved version has `engine_type=html_email`.

## Task 13: Generalize Template Governance for Artifacts

**Files:**

- Modify: `backend/app/services/diagram_template_service.py`
- Modify: `backend/app/models/knowledge.py`
- Modify: `backend/app/agents/context.py`
- Modify: `docs/plans/2026-05-26-enterprise-template-governance.md`

**Step 1: Reuse existing template table in first batch**

Do not create a new table yet. Store office templates in `diagram_templates` with:

```json
{
  "metadata": {
    "artifact_family": "office",
    "artifact_type": "html_email"
  },
  "engine_type": "html_email",
  "task_type": "html_email"
}
```

**Step 2: Rename service language internally where safe**

Add wrapper functions:

```python
select_best_artifact_template(...)
list_authorized_artifact_templates(...)
```

These can call existing diagram template functions.

**Step 3: Update prompt context**

Change prompt text from `GOVERNED DIAGRAM TEMPLATE` to generic `GOVERNED ARTIFACT TEMPLATE` when the selected template is not a diagram.

**Step 4: Verify template selection**

Create a smoke template for `html_email`, route an email request, and assert Knowledge Agent can select it by `engine_type/task_type`.

## Task 14: Extend Preferences Beyond Diagrams

**Files:**

- Modify: `backend/app/services/long_term_memory_service.py`
- Modify: `frontend/src/components/settings/DiagramPreferencesPanel.tsx`
- Modify: `frontend/src/components/settings/SettingsModal.tsx`
- Modify: `docs/plans/2026-05-26-enterprise-long-term-preferences.md`

## Execution Update - 2026-05-28 Template Governance

Implemented Task 13 in the first-batch compatibility layer:

- Reused `diagram_templates` for office templates with `metadata.artifact_family=office` and `metadata.artifact_type`.
- Added artifact wrapper functions around the existing template service while preserving diagram API compatibility.
- Knowledge Agent now calls `select_best_artifact_template`, so office artifacts can use the same authorized template ranking path as diagrams.
- Prompt context switches to `GOVERNED ARTIFACT TEMPLATE` for office templates and keeps `GOVERNED DIAGRAM TEMPLATE` for diagram templates.
- Office Artifact Agent now instructs the model to preserve governed artifact template required fields and section intent.
- `smoke:office` verifies an `html_email` template serializes as `artifact_family=office` and is injected as an artifact template.

**Step 1: Add artifact preferences**

Add optional preferences:

```json
{
  "artifact_preferences": {
    "html_email": {
      "tone": "professional",
      "brand_color": "#2563eb",
      "default_cta_style": "button",
      "language": "zh-CN"
    },
    "web_report_html": {
      "tone": "analytical",
      "layout_density": "standard",
      "include_summary": true
    }
  }
}
```

**Step 2: Keep diagram preferences unchanged**

Do not break `diagram_preferences`. Artifact preferences should be loaded beside existing long-term preferences.

**Step 3: Apply deterministic design rules**

`Design Agent` should apply brand color and layout density to office DSL before validation.

**Step 4: Verify compile**

Run:

```bash
cd backend && python3 -m py_compile app/services/long_term_memory_service.py
cd frontend && npm run build
```

Expected: compile/build succeeds.

## Execution Update - 2026-05-28 Preferences

Implemented Task 14:

- Existing `diagram_preferences` storage remains compatible and now allows `artifact_preferences.html_email` and `artifact_preferences.web_report_html`.
- Long-term prompt context includes office artifact preferences under `AUTHORIZED LONG-TERM ARTIFACT PREFERENCES`.
- Design Agent deterministically applies office artifact preferences before validation:
  - email brand color, tone, and language;
  - web report brand color, tone, layout density, max width, and optional summary section.
- Settings UI now exposes office artifact preference controls alongside flow and chart controls.
- `/api/preferences/artifact` is the preferred preference endpoint for the generalized platform; `/api/preferences/diagram` remains compatible for existing callers.
- `smoke:office` verifies preference sanitization, prompt formatting, and office design optimization.

## Task 15: Add Office Artifact Smoke Tests

**Files:**

- Create: `backend/scripts/smoke_office_artifacts.py`
- Modify: `package.json`

**Step 1: Add script**

Add root script:

```json
"smoke:office": "cd backend && uv run python scripts/smoke_office_artifacts.py"
```

**Step 2: Cover pure functions first**

Smoke should cover:

- keyword routing;
- planner contracts;
- email DSL validation;
- report DSL validation;
- renderer policy;
- HTML export renderer.

**Step 3: Add DB smoke later**

After persistence is wired, add optional `--require-db` to verify:

- generated office artifact persists;
- history can find it;
- export job writes HTML asset;
- audit event records `artifact_type`.

**Step 4: Run**

```bash
npm run smoke:office
```

Expected: smoke passes without requiring DB.

## Task 16: Future Migration to Generic Artifact Tables

**Files:**

- Create later: `backend/app/models/artifact.py`
- Create later: `backend/app/services/artifact_persistence_service.py`
- Modify later: `backend/app/api/routes_diagrams.py`
- Modify later: `backend/app/api/routes_exports.py`

**Step 1: Add generic models after office MVP stabilizes**

Target model:

```python
class Artifact(SQLModel, table=True):
    __tablename__ = "artifacts"
    id: str
    tenant_id: str
    project_id: str | None
    conversation_id: str | None
    owner_user_id: str | None
    title: str
    artifact_family: str
    artifact_type: str
    engine_type: str
    task_type: str
    visibility: str
    current_version_id: str | None
    metadata_json: dict

class ArtifactVersion(SQLModel, table=True):
    __tablename__ = "artifact_versions"
    id: str
    tenant_id: str
    artifact_id: str
    version_number: int
    artifact_type: str
    engine_type: str
    task_type: str
    code: str
    rendered_preview_json: dict
    validation_json: dict
```

**Step 2: Migrate diagrams**

Copy existing `diagrams/diagram_versions` into `artifacts/artifact_versions` with `artifact_family=diagram`.

**Step 3: Keep API aliases**

Keep `/api/diagrams/...` working as an alias for diagram artifacts. Add `/api/artifacts/...` for generic clients.

**Step 4: Only migrate after acceptance**

Do this after:

- office MVP works end-to-end;
- export assets are stable;
- frontend no longer assumes all canvas content is a diagram.

## Recommended Execution Order

1. Tasks 1-5: architecture, catalog, router, office agent, planner contracts.
2. Tasks 6-9: renderer, validation, persistence metadata, export formats.
3. Tasks 10-12: frontend types, ArtifactCanvas, SSE support.
4. Tasks 13-15: templates, preferences, smoke coverage.
5. Task 16: later migration to generic Artifact tables.

## Acceptance Criteria

Minimum viable completion:

- User can type `@email 帮我写一封客户续费提醒 HTML 邮件`.
- Router selects `html_email`.
- Planner shows office artifact output contract.
- Knowledge/template path still works with permissions.
- Agent returns office artifact JSON DSL.
- Validator rejects unsafe HTML/links and repair handles common issues.
- Frontend previews the email in a sandbox iframe.
- Version is persisted with `metadata_json.artifact_type=html_email`.
- Export API can create an `html` asset.
- Audit run records route, planner, validation, export and artifact metadata.

Second scenario:

- User can type `生成一个基础 HTML 网页分析稿，主题是竞品对比`.
- Router selects `web_report_html`.
- Frontend previews a static report page.
- Export to `html` succeeds.

## Risk Notes

- HTML email compatibility is a product surface, not just rendering. Keep renderer constrained and add template tests before supporting real email sending.
- `Diagram` naming will become increasingly misleading. Use compatibility only for first batch; do the generic `Artifact` migration once office artifacts prove useful.
- Browser-based PDF/PNG export for HTML should be a separate worker capability. Do not block first batch on pixel-perfect PDF.
- External links and tracking pixels are governance concerns. Treat sending and tracking as approval-gated tools, not default generation behavior.
