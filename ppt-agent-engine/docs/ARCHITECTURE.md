# PPT-Agent Engine 架构文档

> 版本：2026-07-19
> 范围：面向开发者的系统架构、数据流与扩展指南

---

## 1. 总体架构

```text
┌─────────────────────────────────────────────────────────────────────┐
│                            前端 apps/web                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │  IntentSpace │ │StructureSpace│ │  StudioSpace │ │ExportsSpace │ │
│  │  Brief/Source│ │ StickyBoard  │ │Search/Draft/ │ │ draft/std/  │ │
│  │   Visual     │ │              │ │   Design     │ │   visual    │ │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬──────┘ │
│         │                │                │                │        │
│         └────────────────┴───────┬────────┴────────────────┘        │
│                                  │                                   │
│                    workbenchStore (Zustand)                          │
│                                  │                                   │
└──────────────────────────────────┼───────────────────────────────────┘
                                   │ REST / SSE
┌──────────────────────────────────┼───────────────────────────────────┐
│                           后端 apps/api                              │
│  ┌───────────────────────────────┴───────────────────────────────┐   │
│  │                    Fastify REST API                            │   │
│  │  projects.ts │ health.ts │ ai.ts │ static exports               │   │
│  └───────────────────────┬───────────────────────────────────────┘   │
│                          │                                           │
│              ┌───────────┴───────────┐                               │
│              ▼                       ▼                               │
│  ┌─────────────────────┐  ┌─────────────────────┐                   │
│  │ @ppt-agent/agents   │  │ @ppt-agent/shared   │                   │
│  │ adapter / prompts   │  │ schemas / themes    │                   │
│  │ stageGraph / mapPages│  │ render strategy     │                   │
│  └──────────┬──────────┘  └─────────────────────┘                   │
│             │                                                        │
│             ▼                                                        │
│  ┌─────────────────────┐                                             │
│  │ @ppt-agent/ppt-renderer                                            │
│  │ svgCompile / IR render / theme templates / export orchestration    │
│  └─────────────────────┘                                             │
│             │                                                        │
│             ▼                                                        │
│  ┌─────────────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │     AI Provider     │   │   SQLite     │   │ storage/exports  │  │
│  │ openai-compatible   │   │   Prisma 6   │   │   .pptx files    │  │
│  │ gemini / mock       │   │              │   │                  │  │
│  └─────────────────────┘   └──────────────┘   └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Monorepo 包边界

### `apps/api`

- **框架**：Fastify 5 + TypeScript。
- **入口**：`src/index.ts` 注册插件、CORS、静态文件、Prisma 客户端与路由。
- **核心路由**：`src/routes/projects.ts`，约 1200 行，集中了项目主链、事实、大纲、页面、生成、导出所有接口。
- **进度推送**：`src/lib/progressEmitter.ts` 维护 `EventEmitter`，`/api/projects/:id/progress` 通过 SSE 推送生成阶段。
- **静态文件**：`@fastify/static` 暴露 `storage/exports/` 为 `/exports/*`。

### `apps/web`

- **构建**：Vite 6 + React 18 + Tailwind CSS。
- **路由**：`src/main.tsx`，按 `/p/:projectId/:space` 组织四个空间。
- **状态**：`src/store/workbenchStore.ts`（Zustand），持有当前项目、slides、facts、exports、studio phase、进度日志。
- **壳层**：`src/components/project-shell/` 提供项目切换器、工作区导航、整体布局。
- **空间组件**：
  - `src/pages/IntentSpace.tsx` + `src/components/intent/`
  - `src/pages/StructureSpace.tsx` + `src/components/structure/StickyBoard.tsx`
  - `src/pages/StudioSpace.tsx` + `src/components/studio/`
  - `src/pages/ExportsSpace.tsx`

### `packages/shared`

共享 DTO、Zod schema、主题与工具函数。核心模块：

| 文件 | 职责 |
|------|------|
| `src/index.ts` | Zod schema、DTO 类型、`formatProject` / `formatSlide` 等 |
| `src/themePacks.ts` | 主题包定义、`normalizePptExportTheme`、`getThemePack` |
| `src/layoutRoles.ts` | 版式角色枚举与推断规则 |
| `src/svgTextFit.ts` | SVG 文字边界检查与自适应 |
| `src/themeRecolor.ts` | SVG 按主题重着色 |
| `src/themeSurfacePresets.ts` | 质感预设、CSS filter、recolor 提示 |
| `src/skeletons/` | IR 骨架模板注册表 |

### `packages/agents`

AI 适配器与编排层：

| 文件 | 职责 |
|------|------|
| `src/types.ts` | `GeminiAdapter` 接口定义 |
| `src/openaiCompatibleAdapter.ts` | 默认实现，基于 OpenAI-Compatible 协议 |
| `src/realGeminiAdapter.ts` | Google Gemini 官方 API 实现 |
| `src/mockGeminiAdapter.ts` | 本地演示用假数据 |
| `src/prompts.ts` | 所有 system prompt 与 prompt builder |
| `src/researchAdapter.ts` | `ResearchAdapter` 抽象与默认 LLM 模拟实现 |
| `src/stageGraph.ts` | 阶段状态机 |
| `src/parallelMap.ts` | 页级并发 map |
| `src/orchestration/` | `native` / `grok-sidecar` 编排后端 |
| `src/studioHelpers.ts` | Studio 流水线辅助 |

### `packages/ppt-renderer`

PPTX 渲染与导出：

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 主导出函数 `exportProjectToPptx` |
| `src/exportTypes.ts` | 导出参数、模式、结果类型 |
| `src/svgCompile.ts` | SVG → PPT 原生对象编译 |
| `src/svgPathGeometry.ts` | SVG 路径几何解析 |
| `src/pptxPostprocess.ts` | 导出后几何/布局微调 |
| `scripts/svg-compile-regression.ts` | SVG 编译回归测试 |

---

## 3. 数据模型

完整 schema 见 `prisma/schema.prisma`。

### `Project`

```prisma
id           String   @id @default(cuid())
name         String
reportType   String
audience     String
purpose      String
pageCount    Int      @default(6)
theme        String   @default("unilumin-blue")
mode         String   @default("paste")   // topic | paste
topic        String?
briefJson    String?                      // Brief 问答摘要
researchJson String?                      // 主题调研摘要
createdAt    DateTime @default(now())
updatedAt    DateTime @updatedAt
```

### `Fact`

```prisma
id             String  @id @default(cuid())
projectId      String
category       String
content        String
status         String
confidence     Float
sourceText     String
sourceLocation String
canUseInPpt    Boolean @default(true)
```

### `Slide`

```prisma
id                String  @id @default(cuid())
projectId         String
sortOrder         Int
title             String
slideGoal         String
keyMessage        String
contentPoints     String  @default("[]")
recommendedLayout String
status            String  @default("draft")
isContentLocked   Boolean @default(false)
isLayoutLocked    Boolean @default(false)
planJson          String?
irJson            String?
svgPreview        String?
searchJson        String?
partTitle         String?
generationStatus  String  @default("draft")
renderStrategy    String? // ir | svg | hybrid
strategyLocked    Boolean @default(false)
```

### `SlideSource`

Slide 与 Fact 的多对多关联表，支持 `usageType`（如 `supporting`）。

### `Export`

```prisma
id          String
projectId   String
versionName String
pptxPath    String
createdAt   DateTime
```

---

## 4. 核心数据流

### 4.1 创建项目 → 生成大纲

```text
POST /api/projects
    │
    ▼
IntentSpace 填写 Brief / 粘贴资料
    │
    ▼
POST /api/projects/:id/extract-facts
    │
    ▼
POST /api/projects/:id/generate-outline
    │
    ├── adapter.generateOutline(project, facts)
    ├── 返回带 partTitle 的 slide 数组
    └── 写入 Slide 表（按 sortOrder；推断 renderStrategy；保留已锁定策略）
```

### 4.2 Studio 单页生成

```text
StudioSpace 选择一页
    │
    ├── 搜索阶段 ──▶ POST .../slides/:id/search
    │                 └── adapter.generatePageSearch(slide, facts/research)
    │
    ├── 初稿阶段 ──▶ POST .../slides/:id/generate-plan
    │                 └── adapter.generateSlidePlan(slide, facts)
    │
    ├── IR 阶段 ────▶ POST .../slides/:id/generate-ir
    │                 └── adapter.generateSlideIr(slide, facts, theme)
    │
    └── 设计阶段 ──▶ POST .../slides/:id/generate-design
                      ├── adapter.generateSlidePlan（若缺 plan）
                      ├── adapter.generateSlideIr（降级兜底）
                      ├── adapter.generateSvgPreview
                      ├── sanitizeSvgPreviewText / fitSvgTextToBounds
                      ├── validateSvgPreview（硬门禁）
                      └── 写入 svgPreview / renderStrategy
```

### 4.3 一键流水线

```text
POST /api/projects/:id/run-pipeline
    │
    ├── 阶段 1：search-all（页级并发）
    ├── 阶段 2：generate-all-plans（页级并发）
    ├── 阶段 3：generate-all-ir（可选）
    └── 阶段 4：generate-all-designs（可选）

每个阶段通过 progressEmitter 推送 SSE：
{ stage, status: "start" | "done" | "error", message }
```

### 4.4 Hybrid 导出

```text
POST /api/projects/:id/export-pptx
    │
    ├── 读取 project + slides + facts
    ├── normalizePptExportTheme(theme)
    ├── prepareSlidesForExport(slides, facts, theme, mode)
    │   ├── draft 模式：全部补齐 IR，不强制 SVG
    │   ├── standard 模式：按 renderStrategy，缺 SVG 降级 IR
    │   └── visual 模式：尽量 SVG，失败降级并记录 warning
    │
    ├── 按页渲染：
    │   ├── strategy === "ir"        → IR 主题模板渲染
    │   ├── strategy === "svg"       → svgCompile → PPT 原生对象（失败降级）
    │   └── strategy === "hybrid"    → IR + SVG 元素混合
    │
    ├── 计算 editableGrade（A/B/C）
    ├── 生成 Export 记录
    └── 返回 { url, versionName, warnings, pageResults }
```

---

## 5. AI 适配器层

### 5.1 接口 `GeminiAdapter`

```ts
interface GeminiAdapter {
  extractFacts(text: string): Promise<ExtractFactsResult>;
  startBrief(project: ProjectInput): Promise<BriefStartResult>;
  finalizeBrief(...): Promise<BriefFinalizeResult>;
  generateResearch(project: ProjectInput): Promise<ResearchResult>;
  generateOutline(project, facts, onToken?): Promise<OutlineSlide[]>;
  generatePageSearch(slide, facts, research?): Promise<SearchResult>;
  generateSlidePlan(slide, facts, theme?): Promise<PlanJson>;
  generateSlideIr(slide, facts, theme?): Promise<SlideIr>;
  generateSvgPreview(slide, facts, theme?): Promise<string>;
  // ... 状态 / 用量
}
```

### 5.2 实现切换

`packages/agents/src/index.ts` 根据环境变量 `AI_PROVIDER` 创建对应适配器：

- `mock`：`MockGeminiAdapter`
- `gemini`：`RealGeminiAdapter`
- `openai-compatible`（默认）：`OpenAiCompatibleAdapter`

`OpenAiCompatibleAdapter` 使用 `undici` 直接请求 OpenAI-Compatible 协议，支持：

- 双模型角色：`MODEL`（检索 / 策划 / 大纲）与 `DESIGN_MODEL`（IR / SVG）。
- `reasoning_effort` / `effort` 字段可配置。
- 阶段专用 effort 覆盖（`_RESEARCH_EFFORT`、`_OUTLINE_EFFORT` 等）。
- 兼容旧变量名 `TRADINGAGENTS_*`。

### 5.3 编排后端

`ORCHESTRATION_BACKEND` 控制页级 fan-out：

- `native`（默认）：本仓 `stageGraph.ts` + `parallelMap.ts`，进程内并发。
- `grok-sidecar`（实验）：通过外部二进制分发 map，当前未强制启用。

并发数：`SEARCH_CONCURRENCY`、`PLAN_CONCURRENCY`，默认 3，最大 8。

---

## 6. 渲染策略系统

### 6.1 推断 `inferRenderStrategy`

根据标题与 `recommendedLayout` 启发式推断：

| 布局 / 标题特征 | 策略 |
|----------------|------|
| 表格、行动项、风险、目录、列表密集 | `ir` |
| 封面、流程、对比、架构图、时间轴 | `svg` |
| 其他 | `hybrid` |

### 6.2 模式生效 `effectiveRenderStrategy`

```ts
draft    → 强制 ir
standard → 保持原策略
visual   → 非 ir 提升为 svg
```

### 6.3 策略锁定

- 用户在 Studio 手动切换 `renderStrategy` 后，`strategyLocked = true`。
- 重新生成大纲（非 `force`）时，会按 `sortOrder` 保留已锁定策略。
- 这避免了「一刷新大纲，所有手动调过的策略全部丢失」。

---

## 7. SVG 编译与可编译契约

### 7.1 为什么需要硬门禁

SVG 是自由的矢量格式，但 pptxgenjs 能渲染成 PPT 原生对象的子集非常有限。如果放任 AI 生成任意 SVG，导出时会出现文字丢失、样式错乱、整页变图等问题。因此系统对 AI 生成的 SVG 有严格契约。

### 7.2 禁止特性

`getBannedSvgFeatures` 检查并拒绝：

- `<style>` 标签与 `class` 属性
- `mask`、`filter`、`pattern`、`symbol`、`use`
- `foreignObject`、`textPath`
- `@font-face`、CSS animation、`<animate>`、`<script>`、iframe

### 7.3 内容检查

`validateSvgPreview` 要求：

- `viewBox="0 0 1280 720"`
- 至少 3 个 `rect` 或主视觉区
- 至少 4 段文字
- 无溢出文本（`getSvgTextBoxIssues`）
- 无重复事实

### 7.4 文字适配

`fitSvgTextToBounds` 检测文本是否超出容器，必要时尝试缩小字号或换行；无法修复则返回 issues 触发降级。

### 7.5 编译路径

```text
AI 生成 SVG
    │
    ├── sanitizeSvgPreviewText（去除幻觉文本）
    ├── fitSvgTextToBounds（文字适配）
    ├── validateSvgPreview（硬门禁）
    │   └── 失败 → 降级 IR/主题模板
    │
    └── svgCompile.ts
        ├── 解析 viewBox、尺寸
        ├── 遍历 rect / text / line / circle / path 等
        ├── 转换为 pptxgenjs 原生对象
        └── postprocessEditableSvgGeometry（几何微调）
```

---

## 8. 导出结果与可编辑等级

### 8.1 `ExportResult`

```ts
{
  url: string;              // /exports/xxx.pptx
  versionName: string;
  warnings: string[];       // 用户可见告警，如某页 SVG 失败降级
  pageResults: PageResult[];
}
```

### 8.2 `PageResult`

```ts
{
  slideId: string;
  title: string;
  strategy: "ir" | "svg" | "hybrid";
  path: "ir-theme" | "svg-compile" | "svg-fidelity" | "fallback";
  editableGrade: "A" | "B" | "C";
}
```

### 8.3 等级定义

- **A**：整页文字 / 形状基本可编辑（IR 或成功 svgCompile）。
- **B**：主体可编辑，少量装饰为 PNG 或不可编辑图形。
- **C**：整页或大部分为保真图 / 主题模板兜底。

---

## 9. 前端状态管理

`apps/web/src/store/workbenchStore.ts` 核心状态：

```ts
interface WorkbenchState {
  project: ProjectDto | null;
  slides: SlideDto[];
  facts: FactDto[];
  exports: ExportDto[];
  space: "intent" | "structure" | "studio" | "exports";
  studioPhase: "search" | "draft" | "design";
  progress: ProgressEvent[];
  loading: Record<string, boolean>;
  // actions
  loadProject(id): Promise<void>;
  updateSlide(id, patch): Promise<void>;
  runPipeline(options): Promise<void>;
  exportPptx(theme, mode): Promise<ExportResult>;
  // ...
}
```

- 进入 `ProjectWorkspace` 时自动 `loadProject`。
- 每个空间通过 selector 订阅自己关心的字段。
- SSE 进度通过 `addProgress` 追加到日志数组。

---

## 10. 扩展指南

### 10.1 新增 AI Provider

1. 在 `packages/agents/src/types.ts` 确认 `GeminiAdapter` 接口。
2. 新增 `src/myProviderAdapter.ts` 实现接口。
3. 在 `packages/agents/src/index.ts` 的 `createAdapter()` 里按 `AI_PROVIDER=my-provider` 返回新实例。
4. 在 `.env.example` 增加对应变量。

### 10.2 新增搜索适配器

1. 实现 `ResearchAdapter` 接口：

```ts
interface ResearchAdapter {
  search(slide, context): Promise<SlideSearchJson>;
  research(project): Promise<ResearchResult>;
}
```

2. 在 `apps/api/src/index.ts` 启动时调用 `setResearchAdapter(adapter)`。
3. 保持 `SlideSearchJson` 形状不变，前端无需改动。

### 10.3 新增主题

1. 在 `packages/shared/src/themePacks.ts` 的 `pptExportThemes` 增加新主题。
2. 提供 `light` / `dark` 族归属、`surfaceId`、`accentPreset`。
3. 如需新质感，在 `themeSurfacePresets.ts` 增加 `surfaceId`。
4. 在 `packages/ppt-renderer/src/index.ts` 的渲染分支里处理新主题的颜色映射。

### 10.4 新增版式角色

1. 在 `packages/shared/src/layoutRoles.ts` 的 `layoutRoles` 枚举新增角色。
2. 在 `inferRenderStrategy` 里决定默认策略。
3. 在 `packages/shared/src/skeletons/` 下新增 IR 骨架模板。
4. 在 `packages/agents/src/prompts.ts` 的大纲 / 策划 prompt 里加入新角色描述。

### 10.5 修改导出行为

1. 先读 `docs/00-architecture/HYBRID_IR_SVG_STRATEGY.md`。
2. 改 `prepareSlidesForExport` 注意按页降级逻辑。
3. 改 `svgCompile.ts` 注意硬门禁同步更新。
4. 运行 `corepack pnpm --filter @ppt-agent/ppt-renderer test` 做 SVG 回归。

---

## 11. 测试与回归

| 命令 | 作用 |
|------|------|
| `corepack pnpm typecheck` | 全仓 TypeScript 类型检查 |
| `corepack pnpm --filter @ppt-agent/ppt-renderer test` | SVG 编译回归测试 |
| `corepack pnpm db:seed` | 写入演示种子项目 |

提交前至少运行类型检查。改动导出 / SVG 编译后必须跑 renderer 回归。

---

## 12. 参考资料

- [PROJECT_GUIDE.md](./PROJECT_GUIDE.md)
- [DESIGN_文章式PPT_Agent工作室.md](./DESIGN_文章式PPT_Agent工作室.md)
- [00-architecture/HYBRID_IR_SVG_STRATEGY.md](./00-architecture/HYBRID_IR_SVG_STRATEGY.md)
- [00-architecture/COMPILABLE_SVG.md](./00-architecture/COMPILABLE_SVG.md)
- [04-article-studio-redesign/SEARCH_ADAPTER.md](./04-article-studio-redesign/SEARCH_ADAPTER.md)
