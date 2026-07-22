# 文章式 PPT Agent 工作室 — 完整设计说明

> 版本：2026-07-17  
> 状态：已落地（产品主轴 + Hybrid 导出嫁接）  
> 范围：对齐当前代码实现，而非仅复述计划稿

本文是 **产品 / 技术总览**：说明「文章式工作室」体验主轴如何与既有 **IR + 可编译 SVG Hybrid 导出** 嫁接，以及系统边界与成功标准。分阶段落地细节见各阶段目录 README 与 EXECUTION 文档。

---

## 1. 诊断与目标体验

### 1.1 旧体验问题

早期工作台是 **5 步表单向导**（资料 → 事实 → 大纲 → 设计 → 导出）。对业务用户来说，常见体感是：

| 症状 | 根因 |
|------|------|
| 像填表玩具，不像顾问工作室 | 入口先问字段，缺少需求对话与调研语境 |
| 大纲像扁平列表 | 缺少章节（`partTitle`）与可视化便利贴墙 |
| 策划与设计挤在一步 | 结构（初稿）与皮囊（设计稿）未分流 |
| 导出「好看但脆弱」 | 正式导出几乎强制 SVG，单页失败拖死整份 |

### 1.2 目标体验（一句话）

> 用户像在和 PPT 顾问协作：先澄清主题或粘贴资料 → 在便利贴墙上排叙事 → 在 Studio 里按「搜索 → 初稿 → 设计」推进每一页 → 用 Hybrid 模式导出可编辑 PPTX。

### 1.3 双入口、后半段汇合

```text
主题调研流                    粘贴资料流
   │                              │
   ▼                              ▼
 Brief（需求对话+调研）        Paste（资料+事实）
   │                              │
   └──────────┬───────────────────┘
              ▼
         Board（便利贴墙）
              ▼
         Studio（搜索｜初稿｜设计稿）
              ▼
         Export（draft / standard / visual）
```

---

## 2. 信息架构与路由

### 2.1 路由表（`apps/web/src/main.tsx`）

| 路径 | 页面 | 职责 |
|------|------|------|
| `/` | HomePage | 双入口：主题调研 / 粘贴资料 |
| `/p/:projectId/brief` | BriefPage | 需求澄清问答、调研摘要 |
| `/p/:projectId/paste` | PastePage | 粘贴资料、提取与确认事实 |
| `/p/:projectId/board` | BoardPage | 便利贴大纲、章节、拖拽排序 |
| `/p/:projectId/studio` | StudioPage | 三阶段工作室（核心制作面） |
| `/p/:projectId/export` | ExportPage | 导出模式、策略、warnings、等级 |
| `/projects/:id` | 重定向 | 兼容旧链接 → `/p/:id/board` |

壳层导航由 `ProjectShell` 提供：需求 / 资料 / 便利贴墙 / 工作室 / 导出。

### 2.2 页面信息架构原则

1. **一页一职**：Brief 只澄清需求，Board 只排结构，Studio 只管单页生产，Export 只管交付。
2. **三阶段显式分流**：搜索（材料）→ 初稿（结构）→ 设计稿（皮囊）。
3. **导出能力不回退**：工作室改 IA，不推倒 Hybrid 导出栈。

---

## 3. Studio 三阶段

Studio 布局：**左缩略图 · 中画布 · 右 Agent 日志**。阶段由 `studioPhase: "search" | "draft" | "design"` 驱动。

| 阶段 | 用户动作 | 后端能力 | 产物字段 |
|------|----------|----------|----------|
| **搜索** | 单页检索 / 全页检索 | `POST .../slides/:id/search`、`.../search-all` | `Slide.searchJson` |
| **初稿** | 生成策划 / 批量策划；可生成 IR | `generate-plan`、`generate-all-plans`、`generate-ir` | `planJson`、`irJson` |
| **设计稿** | 生成 SVG 设计；切换渲染策略 | `generate-design`、`generate-all-designs`；`PATCH renderStrategy` | `svgPreview`、`renderStrategy` |

一键流水线：`POST .../run-pipeline`，顶栏「全部自动生成」。进度写入前端 Agent 日志，避免黑盒。

设计稿 Tab 仍可按页切换 `ir` / `svg` / `hybrid`，与 Export 页的 `draft` / `standard` / `visual` 模式配合。

---

## 4. 后端阶段与 API

### 4.1 项目与内容主链

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects` | 创建项目（含 `mode`：`topic` / `paste`） |
| GET | `/api/projects/:id` | 项目详情 |
| PATCH | `/api/projects/:id` | 更新元数据 |
| POST | `.../source-text` | 粘贴资料 |
| POST | `.../extract-facts` | 事实提取 |
| POST/PATCH/DELETE | `.../facts` | 事实 CRUD / 确认 |
| POST | `.../generate-outline` | 大纲（含 `partTitle`） |
| PATCH | `.../slides/:id` | 更新页（含 `renderStrategy` → 锁定） |
| POST | `.../slides/reorder` | 重排 |
| POST/DELETE | `.../slides` | 增删页 |

### 4.2 Brief / Research / Search / Pipeline

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `.../brief/start` | 生成澄清问题 |
| POST | `.../brief/answer` | 汇总需求 → 写 `briefJson`，可改 audience/purpose/pageCount |
| POST | `.../research` | 主题调研 → `researchJson` |
| POST | `.../slides/:id/search` | 单页资料卡 → `searchJson`（可走 ResearchAdapter） |
| POST | `.../search-all` | 全页检索 |
| POST | `.../run-pipeline` | 检索 → 初稿 →（可选）设计 流水线 |

### 4.3 策划 / IR / 设计 / 导出

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `.../slides/:id/generate-plan` | 单页策划 |
| POST | `.../generate-all-plans` | 批量策划 |
| POST | `.../slides/:id/generate-ir` | Slide IR |
| POST | `.../generate-all-ir` | 批量 IR |
| POST | `.../slides/:id/generate-design` | SVG 设计（`theme` + `mode`） |
| POST | `.../generate-all-designs` | 批量设计 |
| POST | `.../export-pptx` | Hybrid 导出：`{ theme, mode, draft }` |
| GET | `/api/ai/status` | AI 提供方状态 |
| GET | `/api/ai/usage` | 用量与可编辑等级汇总 |

AI 提供方：`mock` / `gemini` / `openai-compatible`（见 `.env.example`）。

---

## 5. Prisma 字段（相对旧版的扩展）

### 5.1 Project

| 字段 | 用途 |
|------|------|
| `mode` | `paste`（默认）或主题流标识 |
| `topic` | 主题调研入口主题 |
| `briefJson` | Brief 问答与需求摘要 |
| `researchJson` | 主题调研摘要 |

### 5.2 Slide

| 字段 | 用途 |
|------|------|
| `planJson` / `irJson` / `svgPreview` | 初稿 / IR / 设计稿 |
| `searchJson` | 页级资料卡 |
| `partTitle` | 章节标签（便利贴墙分组） |
| `generationStatus` | 生成状态机辅助 |
| `renderStrategy` | `ir` \| `svg` \| `hybrid`；空则 format 时 `inferRenderStrategy` |
| `strategyLocked` | 手动改策略后，大纲重生成（非 force）保留策略 |

迁移见：

- `prisma/migrations/20260717000000_slide_render_strategy`
- `prisma/migrations/20260717010000_slide_strategy_locked`
- `prisma/migrations/20260717020000_topic_studio_fields`

旧数据兼容：format 层对缺失字段给默认（如 `mode=paste`）。

---

## 6. 提示词分层

实现位置：`packages/agents/src/prompts.ts`。

| 层级 | System / Builder | 角色 |
|------|------------------|------|
| 事实 | `extractFactsSystemPrompt` | 只抽资料内事实，防幻觉 |
| Brief | `briefSystemPrompt` + `buildBriefStart/Finalize` | 需求澄清与摘要 |
| 调研 | `researchSystemPrompt` + `buildResearchPrompt` | 主题背景摘要 |
| 页检索 | `pageSearchSystemPrompt` + `buildPageSearchPrompt` | query + 资料卡 |
| 大纲 | `outlineSystemPrompt` + `buildOutlinePrompt` | Outline Architect + `partTitle` + **版式角色枚举** |
| 初稿策划 | `slidePlanSystemPrompt` + `buildSlidePlanPrompt` | 信息架构；`contentBlocks` 对齐 layout blueprint |
| Slide IR | `slideIrSystemPrompt` + `buildSlideIrPrompt` | 1280×720 可编辑骨架（角色骨架内 Bento） |
| SVG 设计 | `svgPreviewSystemPrompt` + `buildSvgPreviewPrompt` | 可编译 SVG + ThemePack token + 硬门禁 |

**ThemePack / 版式角色（Dashi 启发、自研落地）**：`packages/shared` 的 `themePacks` + `layoutRoles`；Home/Studio 选主题；禁止引入 AGPL 版式库或专有 HTML→PPTX。详见 [`04-article-studio-redesign/EXECUTION_dashi-inspired-integration.md`](./04-article-studio-redesign/EXECUTION_dashi-inspired-integration.md)。

原则：

1. **业务正文权威在事实库 → Plan → IR**，SVG 只做视觉编排，禁止虚构数字/日期。
2. **可编译 SVG 硬规则**与 `docs/00-architecture/COMPILABLE_SVG.md`、导出前校验对齐。
3. 设计模型可与结构化模型分离（`GEMINI_DESIGN_MODEL` / `OPENAI_COMPATIBLE_DESIGN_MODEL`）。
4. **`recommendedLayout` 从角色模版枚举选择**，禁止自由发明版式名；主题为有限 ThemePack。

---

## 7. Hybrid 导出嫁接

### 7.1 分工（已选型）

| 层 | 职责 |
|----|------|
| **Slide IR** | 内容契约、可编辑骨架、质检、降级兜底 |
| **可编译 SVG** | 布局创意、Bento 剪影、预览与高视觉编译源 |
| **原生 PPTX** | 唯一交付物（pptxgenjs → 文本框/形状/表格） |

详见 [`00-architecture/HYBRID_IR_SVG_STRATEGY.md`](./00-architecture/HYBRID_IR_SVG_STRATEGY.md)。

### 7.2 导出模式（产品按钮）

| mode | 行为 | 用户感知 |
|------|------|----------|
| `draft` | 优先 IR/主题模板，不强制 SVG | 快、能改、省成本 |
| `standard`（推荐） | 按页 `renderStrategy`；失败降级 | 平衡 |
| `visual` | 尽量 SVG；失败再降级并告警 | 更好看、更慢 |

前端：`apps/web/src/lib/exportMode.ts`；渲染：`packages/ppt-renderer`（`exportTypes` + 按页策略）。

### 7.3 按页策略与反馈

- 推断：`inferRenderStrategy(slide)`（布局类型启发）。
- 覆盖：`PATCH .../slides/:id` 写 `renderStrategy` 并 `strategyLocked=true`。
- 导出响应：`warnings`、`pageResults`（含 `path`、`editableGrade` A/B/C）。
- 用量：`/api/ai/usage` 汇总等级分布。

### 7.4 与工作室的关系

工作室 **不替换** 导出栈，只把「何时生成 plan/ir/svg」产品化：

- 搜索 Tab 喂 `searchJson` → 初稿更稳；
- 初稿 Tab 保证导出 draft/standard 有 IR 可降级；
- 设计稿 Tab + Export 页共享策略与 mode。

---

## 8. 搜索适配器

第一期默认 **LLM 模拟检索**（`generatePageSearch` / `generateResearch`），产出可编辑资料卡，不绑商业搜索供应商。

```ts
import { setResearchAdapter, getResearchAdapter } from "@ppt-agent/agents";
setResearchAdapter(myRealAdapter); // 注入后 search / search-all 优先走适配器
setResearchAdapter(null);          // 回退 LLM 模拟
```

接口与接线说明见 [`04-article-studio-redesign/SEARCH_ADAPTER.md`](./04-article-studio-redesign/SEARCH_ADAPTER.md)。

升级路径：`TavilyResearchAdapter` / 内网 KB，启动时按环境变量注入；保持 `SlideSearchJson` 形状不变，前端无需改 Tab。

---

## 9. 明确不做 / 成功标准

### 9.1 明确不做（当前阶段）

| 非目标 | 原因 |
|--------|------|
| 完整在线 PPT 画布编辑器 / 模板商城 / 多人协作 | 超出原型护城河 |
| 整仓迁入 Python `svg2pptx-skill` 产品流 | 多运行时；仅作契约参考 |
| 放弃 pptxgenjs 全面改写 OOXML | ROI 低；先契约与降级 |
| 文档 / PDF / 网页导入流水线 | PRD Non-Goals |
| 生产鉴权、Postgres、完整 CI 平台 | 运维线，不阻塞产品主轴 |
| 第一期绑定真实搜索供应商 | 用 ResearchAdapter 预留即可 |

### 9.2 成功标准

| # | 标准 | 验收线索 |
|---|------|----------|
| 1 | 双入口可走通到导出 | 主题流 Brief→Board→Studio→Export；粘贴流 Paste→Board→… |
| 2 | Studio 三阶段可感知 | 搜索有资料卡；初稿有 plan；设计有 SVG；日志有进度 |
| 3 | 一键流水线可观测 | `run-pipeline` + Agent 日志，非黑盒 |
| 4 | Hybrid 导出不回退 | `standard` 缺 SVG 可降级；有 `warnings` / `pageResults` |
| 5 | 按页策略可覆盖 | UI 切换 ir/svg/hybrid，`strategyLocked` 生效 |
| 6 | 可编辑等级可见 | A/B/C + `/api/ai/usage` |
| 7 | 旧链接不碎 | `/projects/:id` → board |

---

## 10. 分阶段落地时间线（2026-07-17）

同一自然日内完成架构底座 → Hybrid P0–P2 → 文章式工作室重设计。按「阶段查阅」请用 [`README.md`](./README.md) 与各子目录 README。

| 阶段 | 目录 | 做了什么 |
|------|------|----------|
| **架构底座** | [`00-architecture/`](./00-architecture/) | 架构评审、Hybrid 策略、可编译 SVG 契约、优化总计划、svg2pptx 对照 |
| **P0 导出模式** | [`01-p0-export-mode/`](./01-p0-export-mode/) | `draft/standard/visual`；硬门禁；按页降级入口；前端三模式 |
| **P1 SVG 策略** | [`02-p1-svg-strategy/`](./02-p1-svg-strategy/) | `renderStrategy` 入库；`svgCompile` 增强；warnings UI |
| **P2 等级与用量** | [`03-p2-grade-usage/`](./03-p2-grade-usage/) | 策略锁定、editableGrade、AI usage、SVG 回归脚本 |
| **文章式工作室** | [`04-article-studio-redesign/`](./04-article-studio-redesign/) | 路由拆页、Brief/Board/Studio、ResearchAdapter、run-pipeline |

### 建议阅读顺序

1. 本文（总览）  
2. `00-architecture/HYBRID_IR_SVG_STRATEGY.md` + `OPTIMIZATION_PLAN.md`  
3. P0 → P1 → P2 各目录 `EXECUTION_*-integration.md`  
4. `04-article-studio-redesign/EXECUTION_article-studio-redesign.md`  

---

## 11. 包边界（实现地图）

| 包 / 应用 | 职责 |
|-----------|------|
| `apps/web` | 路由页、Zustand workbench、导出 UI |
| `apps/api` | 编排、校验、导出、AI usage |
| `packages/agents` | 提示词、Gemini/OpenAI/Mock、ResearchAdapter |
| `packages/ppt-renderer` | IR/SVG → PPTX、回归脚本 |
| `packages/shared` | Zod schema、ExportMode、RenderStrategy、DTO |
| `prisma` | SQLite 本地项目库 |

---

## 附录：相关文档入口

- 文档总目录：[`README.md`](./README.md)
- PRD：[`prd/editable-ppt-agent-engine-prd.md`](./prd/editable-ppt-agent-engine-prd.md)
- 本次文档整理执行记录：[`EXECUTION_docs-reorg-2026-07-17.md`](./EXECUTION_docs-reorg-2026-07-17.md)
