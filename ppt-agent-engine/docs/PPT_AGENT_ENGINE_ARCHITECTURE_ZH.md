# PPT-Agent Engine 项目架构文档

> **版本**：2026-07-24  
> **适用对象**：开发人员、架构师、系统集成人员  
> **源码位置**：`ppt-agent-engine/`

---

## 一、 项目定位与核心价值

**PPT-Agent Engine** 是一个以“**本地优先（Local-First）**”为核心原则的智能 PPT 制作与渲染引擎。

与传统的“纯文本转大纲”或“生成不可编辑图片/PDF”的 AI 方案不同，PPT-Agent Engine 的核心使命是：**将用户输入的主题或长篇资料，通过严格的事实抽取、结构推演与双模渲染，最终导出在 Microsoft PowerPoint 中文本框、几何图形、表格均可继续二次编辑的原生 `.pptx` 文件**。

### 核心设计原则
1. **真实事实锚定（Fact-Grounded）**：任何生成的 PPT 页必须绑定可追溯的 `Fact` 事实条目，防止 AI 产生虚假事实。
2. **渐进式工作室流（Studio Pipeline）**：按照“搜索资料 (Search) → 策划与骨架 (Draft) → 视觉设计 (Design)”三阶段递进，告别黑盒等待。
3. **Hybrid 双模渲染引擎（Hybrid IR + SVG Compile）**：兼顾最高可编辑性（Slide IR）与高级视觉设计表达（Compilable SVG），并通过自动降级防范坏页风险。
4. **可编辑性质量审计（Editable Grade A/B/C）**：导出时对每一页的“原生可编辑程度”评分并进行审计告警。

---

## 二、 系统整体架构与 Monorepo 分包

项目采用 `pnpm workspace` 构建 Monorepo 体系，实现了前端 UI、后端 API、AI 适配器、渲染引擎与共享 Schema 的清晰解耦。

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                             前端 React (apps/web)                           │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌─────────────────┐ │
│  │  IntentSpace  │ │ StructureSpace│ │  StudioSpace  │ │  ExportsSpace   │ │
│  │ (Brief/Source)│ │ (StickyBoard) │ │(Search/Draft/ │ │(Draft/Standard/ │ │
│  │               │ │               │ │   Design)     │ │    Visual)      │ │
│  └───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └────────┬────────┘ │
│          │                 │                 │                  │          │
│          └─────────────────┴────────┬────────┴──────────────────┘          │
│                                     ▼                                      │
│                         Zustand (workbenchStore)                           │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │ REST API / SSE 流
┌─────────────────────────────────────┼──────────────────────────────────────┐
│                             后端 API (apps/api)                            │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │                       Fastify 5 REST Server                          │  │
│  │   /api/projects | /api/projects/:id/progress (SSE) | /api/ai/status│  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
│                                     │                                      │
│          ┌──────────────────────────┴──────────────────────────┐           │
│          ▼                                                     ▼           │
│  ┌─────────────────────────┐                         ┌──────────────────┐  │
│  │   @ppt-agent/agents     │                         │@ppt-agent/shared │  │
│  │ OpenAiCompatible / Gemini│                         │Schemas / Themes  │  │
│  │ StageGraph / ParallelMap│                         │Layout Roles      │  │
│  └───────────┬─────────────┘                         └──────────────────┘  │
│              │                                                             │
│              ▼                                                             │
│  ┌─────────────────────────┐                                               │
│  │ @ppt-agent/ppt-renderer │                                               │
│  │ SVG Compiler / IR Render│                                               │
│  │ Theme Engine / PPTX Export                                              │
│  └───────────┬─────────────┘                                               │
│              │                                                             │
│              ▼                                                             │
│  ┌─────────────────────────┐      ┌─────────────────┐  ┌────────────────┐ │
│  │  AI Provider API Gateway│      │ SQLite (Prisma) │  │storage/exports │ │
│  │  (OpenAI/Gemini/Mock)   │      │ dev.db          │  │.pptx 文件存储   │ │
│  └─────────────────────────┘      └─────────────────┘  └────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

### 1. `apps/web` (前端工作台)
* **技术栈**：React 18 + Vite 6 + Tailwind CSS + Zustand
* **核心模块**：
  * **IntentSpace**：意图与资料空间，完成需求问答 (Brief) 与事实提取 (Source/Facts)。
  * **StructureSpace**：结构空间，以便利贴墙 (StickyBoard) 拖拽管理 PPT 章节大纲。
  * **StudioSpace**：创作工作室，支持按页在 搜索 (Search)、初稿 (Draft/IR)、设计稿 (Design/SVG) 三个阶段独立演进与一键并发流水线。
  * **ExportsSpace**：导出与审计空间，提供渲染模式选择（`draft` / `standard` / `visual`）与 `.pptx` 下载。

### 2. `apps/api` (后端 REST 服务)
* **技术栈**：Fastify 5 + TypeScript + tsx
* **核心模块**：
  * **`routes/projects.ts`**：核心控制器，封装项目 CRUD、事实提取、大纲生成、单页 Pipeline 编排及 PPTX 导出接口。
  * **`lib/progressEmitter.ts`**：基于 EventListener 实现全流程生成的 SSE 实时进度推送。

### 3. `packages/shared` (数据规范与主题预设)
* **Zod Schemas & Types**：项目、事实、页面、IR 骨架的类型定义与校验。
* **`themePacks.ts`**：包含品牌色、字体、背景质感的统一主题包定义。
* **`layoutRoles.ts`**：定义 12+ 种版式角色（如目录、时间轴、数据对比、行动项）及渲染策略推断算法。
* **`skeletons/`**：原生 IR 骨架布局模板。

### 4. `packages/agents` (AI 智能体编排层)
* **`GeminiAdapter` 接口**：规范 AI 逻辑层行为。
* **`OpenAiCompatibleAdapter`**：支持 OpenAI / Claude / DeepSeek / Gemini 等 compatible 网关，包含双模型配置（普通推理模型与高视觉设计模型）。
* **`stageGraph.ts` & `parallelMap.ts`**：实现单页之间的并发 Fan-out 执行（支持页级 3~8 并发处理）。

### 5. `packages/ppt-renderer` (PPT 渲染与编译引擎)
* **`exportProjectToPptx`**：导出主控入口。
* **`svgCompile.ts`**：解析 SVG 元素并转换为 `pptxgenjs` 原生 Powerpoint 形状与文本框。
* **`pptxPostprocess.ts`**：导出后的文本自适应与几何对齐修正。

---

## 三、 核心数据模型 (Data Architecture)

存储采用 **SQLite + Prisma 6 ORM**，关系模型如下：

```prisma
// 1. 项目主表
model Project {
  id           String   @id @default(cuid())
  name         String
  reportType   String   // 报告类型，如 "商业汇报", "技术宣讲"
  audience     String   // 目标受众
  purpose      String   // 汇报目的
  pageCount    Int      @default(6)
  theme        String   @default("unilumin-blue")
  mode         String   @default("paste")  // "topic" | "paste"
  topic        String?
  briefJson    String?  // Brief 问答结果 JSON
  researchJson String?  // 主题调研结果 JSON
  facts        Fact[]
  slides       Slide[]
  exports      Export[]
}

// 2. 事实资产表
model Fact {
  id             String        @id @default(cuid())
  projectId      String
  category       String        // 事实分类，如 "数据", "背景", "结论"
  content        String        // 事实文本
  status         String        // "confirmed" | "candidate"
  confidence     Float         // 可信度 0~1.0
  sourceText     String        // 原始出处文本
  sourceLocation String        // 原始位置
  canUseInPpt    Boolean       @default(true)
  slideSources   SlideSource[]
}

// 3. 幻灯片单页表
model Slide {
  id                String   @id @default(cuid())
  projectId         String
  sortOrder         Int      // 排序权重
  title             String   // 单页标题
  slideGoal         String   // 单页目标
  keyMessage        String   // 核心结论
  recommendedLayout String   // 推荐版式角色 (LayoutRole)
  partTitle         String?  // 所属章节名称
  
  // 工作室三阶段产物 JSON
  searchJson        String?  // 检索引用
  planJson          String?  // 页面策划
  irJson            String?  // 中间表达 IR
  svgPreview        String?  // 可编译 SVG 代码

  // 锁与渲染策略
  isContentLocked   Boolean  @default(false)
  isLayoutLocked    Boolean  @default(false)
  renderStrategy    String?  // "ir" | "svg" | "hybrid"
  strategyLocked    Boolean  @default(false)
}

// 4. 导出历史表
model Export {
  id          String   @id @default(cuid())
  projectId   String
  versionName String
  pptxPath    String
  createdAt   DateTime @default(now())
}
```

---

## 四、 全生命周期数据流 (Data Flow Pipeline)

PPT-Agent Engine 的典型作业流程分为四个阶段：

```text
[用户输入/主题]
      │
      ▼
1. 意图与事实生成 (Intent & Fact Extraction)
      ├── POST /api/projects/:id/extract-facts
      └── 产生标准化 Fact[] 列表
      │
      ▼
2. 结构大纲推演 (Outline & Strategy Inference)
      ├── POST /api/projects/:id/generate-outline
      ├── 产生 Slide[] 大纲列表
      └── inferRenderStrategy() 自动推断策略 ("ir" | "svg" | "hybrid")
      │
      ▼
3. 工作室三阶段逐页创作 (Studio Pipeline - Parallel Fan-out)
      ├── Phase 1: Search (生成 searchJson)
      ├── Phase 2: Draft (生成 planJson & irJson)
      └── Phase 3: Design (生成 svgPreview，通过硬门禁校验)
      │
      ▼
4. Hybrid PPTX 渲染与导出 (PPTX Render & Degradation)
      ├── POST /api/projects/:id/export-pptx
      ├── 根据 renderStrategy 选择 IR / SVG / Hybrid 编译渲染
      ├── SVG 校验失败自动降级到 IR 兜底
      └── 打出可编辑等级 (A/B/C) 并生成最终 .pptx
```

---

## 五、 Hybrid 可编辑渲染机制与 SVG 编译契约

PPT-Agent Engine 能够兼顾“精美排版”与“原生可编辑”的核心机理在于其 **Hybrid 双模渲染架构**：

### 1. 渲染策略三态 (Render Strategies)
* **`ir` (Slide IR 优先)**：
  * **可编辑等级**：**A 级**（100% 文本框/表格原生可编辑）。
  * **应用场景**：数据对比、行动计划、目录页、风险矩阵。
  * **原理**：直接读取 `irJson` 结构化对象，渲染为预置的原生 PPT 骨架。
* **`svg` (Compilable SVG 编译)**：
  * **可编辑等级**：**B 级**（图形/文本框原生编译，高视觉排版）。
  * **应用场景**：封面页、复杂流程图、时间轴、金字塔结构。
  * **原理**：将 AI 生成的 SVG 逐节点解析（`<rect>` 变矩形，`<text>` 变原生文本框），生成 PowerPoint 对象。
* **`hybrid` (混合渲染)**：
  * **可编辑等级**：**A/B 级**。
  * **原理**：装饰性背景/复杂图形走 SVG 编译，关键正文文本走 IR 原生文本框覆盖。

### 2. 可编译 SVG 硬门禁 (Banned SVG Features)
为了防止 AI 生成的 SVG 无法映射为 PPT 原生对象，系统在 `validateSvgPreview` 中设置了严格的“硬门禁”：

| 校验类型 | 规则/禁止项 | 触犯后果 |
| :--- | :--- | :--- |
| **禁止标签** | `<style>`, `class`, `foreignObject`, `filter`, `mask`, `pattern`, `symbol`, `<animate>`, `<script>` | 拒绝该 SVG，触发静默降级 |
| **尺寸契约** | 强制要求 `viewBox="0 0 1280 720"` (16:9 标准比例) | 自动缩放矫正或拒绝 |
| **文字溢出** | 通过 `fitSvgTextToBounds` 检测文本盒是否超出边界 | 自动缩小字号，若无法修复则降级 |
| **丰富度** | 页面至少包含 3 个有效图形和 4 段有效文本 | 拒绝空洞 SVG，自动降级为 IR |

> 💡 **降级保护机制**：即使某个 SVG 在导出阶段编译失败，引擎也会自动退回到 `ir` 模式或主题模板渲染该页，确保整份 PPT 导出过程 100% 成功，绝不会出现“单页报错打不开”的情况。

---

## 六、 并发控制与可观测性设计

1. **页级并发 Map (Parallel Fan-out)**：
   * 后端通过 `packages/agents/src/parallelMap.ts` 控制大纲推演与 Studio 创作成图时的并发度。可通过 `SEARCH_CONCURRENCY` / `PLAN_CONCURRENCY` 环境变量调控（默认 3 并发，最高可设 8）。
2. **SSE 进度推流**：
   * 前端 `workbenchStore` 订阅后端 `/api/projects/:id/progress` 端点，流式获取 Agent 执行状态（如：`Slide 2 search completed`），并在 Studio 右侧提供实时控制台日志。
3. **可编辑等级审计 (Editable Grade Audit)**：
   * 导出完成后，接口返回每页的 `editableGrade` (A/B/C) 及警告日志 (`warnings`)，方便用户在导出页面预览哪些页已被静默降级。

---

## 七、 项目扩展指南

### 1. 扩展新的 AI 提供方 (AI Provider)
1. 在 `packages/agents/src/types.ts` 中实现 `GeminiAdapter` 接口。
2. 创建 `packages/agents/src/myNewAdapter.ts`。
3. 在 `packages/agents/src/index.ts` 的 `createAdapter()` 工厂中添加对应 `AI_PROVIDER` 分支。

### 2. 增加新的主题包 (Theme Pack)
1. 在 `packages/shared/src/themePacks.ts` 的 `pptExportThemes` 对象中注册新主题。
2. 设定其 `light`/`dark` 色彩分类、`primaryColor`、`backgroundColor` 及 `surfaceId`。

### 3. 添加新的版式角色 (Layout Role)
1. 在 `packages/shared/src/layoutRoles.ts` 中添加枚举项。
2. 在 `packages/shared/src/skeletons/` 中注册对应的 IR 布局骨架。
3. 在 `packages/agents/src/prompts.ts` 的提示词词典中加入该版式的约束规则。

---

## 八、 常用开发指令速查

```bash
# 全仓开发启动
corepack pnpm dev

# 独立启动 API 或 Web
corepack pnpm dev:api
corepack pnpm dev:web

# 全仓类型检查 (每次提交前必跑)
corepack pnpm typecheck

# 数据库迁移与种子数据
corepack pnpm db:migrate
corepack pnpm db:seed

# SVG 编译回归测试
corepack pnpm test:svg-regression
```
