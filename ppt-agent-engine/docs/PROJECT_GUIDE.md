# PPT-Agent Engine

> 版本：2026-07-19
> 状态：本地优先的 PPT 智能制作引擎原型，已落地文章式工作室 + Hybrid 可编辑导出

PPT-Agent Engine 是一个把「项目资料 / 主题 → 事实确认 → 结构大纲 → 单页策划 → 视觉设计 → 可编辑 PPTX」串成稳定闭环的本地优先原型。核心目标不是生成一张好看的图片，而是导出一份**文字、卡片、表格、线条都能在 PowerPoint 里继续编辑**的 PPTX。

---

## 一句话定位

像和 PPT 顾问协作：先澄清主题或粘贴资料 → 在便利贴墙上排叙事 → 在 Studio 里按「搜索 → 初稿 → 设计」推进每一页 → 用 Hybrid 模式导出可编辑 PPTX。

---

## 核心特性

1. **双入口工作流**
   - **主题调研流**：从 Brief 需求问答 + AI 调研开始，适合只有一句话题目的时候。
   - **粘贴资料流**：直接粘贴项目资料，AI 提取事实并确认，适合已有文档的时候。
   - 两条流在后半段汇合：结构（Board）→ 创作（Studio）→ 导出（Exports）。

2. **文章式 Studio 三阶段**
   - **搜索**：为每一页生成资料卡（`searchJson`），让后续策划有依据。
   - **初稿**：生成单页策划（`planJson`）与可编辑中间表达（`irJson`）。
   - **设计稿**：生成 SVG 视觉预览，并决定每页用 `ir` / `svg` / `hybrid` 哪种渲染策略。

3. **Hybrid 可编辑导出**
   - **Slide IR**：内容契约、可编辑骨架、质检、降级兜底。
   - **可编译 SVG**：布局创意、Bento 剪影、预览与高视觉编译源。
   - **原生 PPTX**：唯一交付物，文本框 / 形状 / 表格尽量可编辑。
   - 导出模式：`draft`（快、省、IR 优先）、`standard`（按页策略，失败降级）、`visual`（尽量 SVG，失败告警降级）。

4. **按页策略与降级**
   - 每页可单独选择 `ir` / `svg` / `hybrid`。
   - 手动锁定后，重新生成大纲不会覆盖你的选择。
   - SVG 失败或不符合硬门禁时自动降级到 IR / 主题模板，避免单页失败拖死整份。

5. **可观测的 AI 进度**
   - Studio 顶栏一键「全部自动生成」。
   - 进度通过 SSE 推送到前端 Agent 日志，避免黑盒等待。
   - `/api/ai/usage` 提供按可编辑等级（A/B/C）的用量汇总。

---

## 目录结构

```text
ppt-agent-engine/
├── apps/
│   ├── api/              # Fastify 后端：REST API、AI 编排、导出
│   └── web/              # React 前端：项目工作区、Studio、导出 UI
├── packages/
│   ├── agents/           # AI 适配器、提示词链、编排后端、并发工具
│   ├── ppt-renderer/     # SVG/IR → PPTX 渲染器、降级策略、回归脚本
│   └── shared/           # 共享 DTO、Zod schema、主题包、渲染策略、SVG 工具
├── prisma/               # SQLite schema、迁移、种子数据
├── docs/                 # 设计文档、阶段执行记录、经验总结
├── storage/exports/      # 本地导出的 PPTX（已被 gitignore）
├── start-dev.sh          # 一键启动脚本
└── README.md             # 本文件
```

---

## 技术栈

- **后端**：Fastify 5 + TypeScript 5.8 + tsx
- **前端**：React 18 + React Router 6 + Vite 6 + Tailwind CSS + Zustand
- **数据库**：SQLite + Prisma 6
- **AI 调用**：自研 `@ppt-agent/agents`，支持 `mock` / `openai-compatible` / `gemini`
- **PPT 渲染**：pptxgenjs 3.x + @resvg/resvg-js
- **构建**：pnpm 9 workspace monorepo，ESM

---

## 本地启动

### 一键启动（推荐）

```bash
chmod +x start-dev.sh
./start-dev.sh
```

首次运行会自动从 `.env.example` 复制出 `.env`。

### 手动启动

```bash
corepack pnpm install
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm dev
```

### 默认地址

| 服务 | 地址 |
|------|------|
| Web 工作台 | http://127.0.0.1:5173 |
| API | http://127.0.0.1:4000 |
| 健康检查 | http://127.0.0.1:4000/api/health |
| AI 状态 | http://127.0.0.1:4000/api/ai/status |

### 常用命令

```bash
corepack pnpm dev          # 同时启动 API 和 Web
corepack pnpm dev:api      # 只启动后端
corepack pnpm dev:web      # 只启动前端
corepack pnpm typecheck    # 全仓类型检查
corepack pnpm db:generate  # 生成 Prisma Client
corepack pnpm db:migrate   # 初始化或更新数据库
corepack pnpm db:studio    # 打开 Prisma Studio
corepack pnpm db:seed      # 写入演示种子数据
```

---

## 环境变量

复制 `.env.example` 为 `.env` 后按需填写。

```env
# 数据库（建议用绝对路径，避免 cwd 变化导致找不到）
DATABASE_URL="file:/Volumes/WorkData/项目app/app/PPT-Agent/ppt-agent-engine/prisma/dev.db"

# 端口
API_PORT=4000
WEB_PORT=5173

# AI 提供方：mock / openai-compatible / gemini
AI_PROVIDER="openai-compatible"

# OpenAI 兼容网关
OPENAI_COMPATIBLE_API_KEY="sk-proj-xxx"
OPENAI_COMPATIBLE_BASE_URL="https://api.unilumin-gtm.xyz/v1"
OPENAI_COMPATIBLE_MODEL="gemini-3.5-flash"
OPENAI_COMPATIBLE_DESIGN_MODEL="gemini-3-flash-agent"
OPENAI_COMPATIBLE_TEMPERATURE=1

# 思考深度（K3 等模型有效）：low | high | max | none
OPENAI_COMPATIBLE_EFFORT_FIELD=reasoning_effort
OPENAI_COMPATIBLE_EFFORT=low

# 页级并发（默认 3，最大 8）
SEARCH_CONCURRENCY=3
PLAN_CONCURRENCY=3

# Google 官方 Gemini（仅 AI_PROVIDER=gemini 时需要）
# GEMINI_API_KEY=""
# GEMINI_MODEL="gemini-3.1-flash-lite"
# GEMINI_DESIGN_MODEL="gemini-3.5-flash"
# GEMINI_PROXY_URL="http://127.0.0.1:7892"
```

完整说明见 `.env.example`。`.env`、`prisma/dev.db`、`storage/exports/**` 已加入 `.gitignore`，不要提交。

---

## 工作流说明

### 1. 创建项目

首页选择：

- **主题调研**：输入一个主题，进入 Brief 问答 + AI 调研。
- **粘贴资料**：输入项目资料，AI 提取事实。

### 2. 意图空间（Intent）

- **Brief 标签**：需求问答、调研结果、受众 / 目的 / 页数调整。
- **资料 标签**：粘贴或修改原始资料，重新提取事实。
- **可视化 标签**：主题 / 报告类型 / 视觉方向预览。

### 3. 结构空间（Structure）

- 以「便利贴墙」形式展示大纲。
- 支持章节（`partTitle`）分组、拖拽排序、增删页。
- 输出：每页的 `title`、`slideGoal`、`keyMessage`、`recommendedLayout`。

### 4. 创作空间（Studio）

三阶段切换：

| 阶段 | 用户动作 | 产物 |
|------|----------|------|
| 搜索 | 单页 / 全页检索 | `Slide.searchJson` |
| 初稿 | 生成策划 / IR | `planJson`、`irJson` |
| 设计稿 | 生成 SVG、切换渲染策略 | `svgPreview`、`renderStrategy` |

顶栏「全部自动生成」会按搜索 → 初稿 → 设计稿跑流水线，进度实时写入右侧 Agent 日志。

### 5. 导出空间（Exports）

选择主题与导出模式：

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `draft` | 优先 IR / 主题模板，不强制 SVG | 快速草稿、低成本 |
| `standard` | 按页 `renderStrategy`；失败降级 | 日常推荐 |
| `visual` | 尽量 SVG；失败降级并告警 | 高视觉、可接受更慢 |

导出完成后可下载 PPTX，并查看每页的 `warnings`、`pageResults`、`editableGrade`。

---

## 关键概念

### 渲染策略 `renderStrategy`

- `ir`：用结构化 IR 渲染，文本可编辑性最高，适合表格、行动项、风险页。
- `svg`：用 SVG 设计稿编译成 PPT 原生对象，视觉丰富但可编辑性中等。
- `hybrid`：IR 兜底 + SVG 元素组合，平衡可编辑与视觉。

系统会根据 `recommendedLayout` 自动推断（`inferRenderStrategy`），用户可在 Studio 手动覆盖并锁定。

### 可编辑等级 `editableGrade`

导出后为每页打等级：

- **A**：全文可编辑。
- **B**：主体可编辑，少量装饰为图。
- **C**：保真图或纯主题模板，可编辑性最低。

### ThemePack / 主题包

`packages/shared` 提供有限的主题集合（如 `unilumin-blue`、`dark-tech`），导出时统一归一化为 `light` / `dark` 族处理。主题只控制颜色、字体、质感，不控制版式名称；版式名必须从 `layoutRoles` 枚举中选择。

### SVG 硬门禁

导出前会检查 SVG 是否包含禁止特性（`<style>`、class、mask、foreignObject、symbol、textPath、动画、脚本等），以及文字是否溢出、是否缺少必要元素。未通过则降级到 IR / 主题模板。

---

## 主要 API 速查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/ai/status` | AI 提供方状态 |
| GET | `/api/ai/usage` | 用量与可编辑等级汇总 |
| GET / POST | `/api/projects` | 项目列表 / 创建 |
| GET / PATCH | `/api/projects/:id` | 详情 / 更新 |
| POST | `/api/projects/:id/source-text` | 保存资料 |
| POST | `/api/projects/:id/extract-facts` | 提取事实 |
| GET/POST/PATCH/DELETE | `/api/projects/:id/facts` | 事实 CRUD |
| POST | `/api/projects/:id/generate-outline` | 生成大纲 |
| GET/POST | `/api/projects/:id/slides` | 列表 / 新增 |
| PATCH / DELETE | `/api/projects/:id/slides/:slideId` | 更新 / 删除 |
| POST | `/api/projects/:id/slides/reorder` | 排序 |
| POST | `/api/projects/:id/slides/:slideId/generate-plan` | 单页策划 |
| POST | `/api/projects/:id/generate-all-plans` | 批量策划 |
| POST | `/api/projects/:id/slides/:slideId/generate-ir` | 单页 IR |
| POST | `/api/projects/:id/slides/:slideId/generate-design` | 单页 SVG 设计 |
| POST | `/api/projects/:id/run-pipeline` | 搜索→初稿→设计 流水线 |
| POST | `/api/projects/:id/export-pptx` | Hybrid 导出 |
| GET | `/api/projects/:id/progress` | SSE 进度 |

完整接口与请求体定义见 `packages/shared/src/index.ts` 与 `apps/api/src/routes/projects.ts`。

---

## 限制与后续方向

### 当前限制

- 本地 SQLite，无多用户鉴权与协作。
- 搜索第一期默认 LLM 模拟检索，未绑定真实搜索供应商（接口已预留 `ResearchAdapter`）。
- SVG 编译与 PPTX 原生对象之间有天然损耗：复杂滤镜、渐变、路径装饰可能无法 1:1 还原。
- AI 用量为进程内内存计数，非账单级。

### 后续方向

- 接入真实搜索（Tavily / 内网 KB）替换模拟检索。
- 更多版式角色与主题包。
- 导出后在线轻量编辑（位置 / 字号微调）。
- 多人协作与云端存储。

---

## 文档索引

| 文档 | 内容 |
|------|------|
| `docs/README.md` | 文档中心与阶段时间线 |
| `docs/DESIGN_文章式PPT_Agent工作室.md` | 产品 / 技术总览 |
| `docs/ARCHITECTURE.md` | 架构详解（本目录对应文件） |
| `docs/00-architecture/HYBRID_IR_SVG_STRATEGY.md` | Hybrid 导出策略 |
| `docs/00-architecture/COMPILABLE_SVG.md` | 可编译 SVG 契约 |
| `docs/04-article-studio-redesign/SEARCH_ADAPTER.md` | 搜索适配器接口 |
| `docs/MAINTENANCE.md` | 日常维护清单 |

---

## 开发前必读

1. 读完 `docs/DESIGN_文章式PPT_Agent工作室.md`。
2. 改导出前先读 `docs/00-architecture/HYBRID_IR_SVG_STRATEGY.md`。
3. 改 SVG 相关代码前先读 `docs/00-architecture/COMPILABLE_SVG.md`。
4. 每次提交前运行 `corepack pnpm typecheck`。

---

*Happy slide-making.*
