# PPT Agent Engine (文章式 PPT Agent 工作室)

PPT Agent Engine 是一款本地优先的高级 PPT 制作引擎原型，致力于通过“文章式”的渐进工作流，将非结构化的输入资料转化为高保真、可完全编辑的 PPTX 演示文稿。本项目采用创新性的 **可编译 SVG 智能渲染策略**，打破了传统 AI 生成 PPT 仅能导出静态图片的局限，实现了文本、形状、表格和线条的原生 PowerPoint 对象转换。

## 🌟 核心理念与工作流

本系统模拟了真实顾问与设计师的协作过程，分为两条主线入口与三个核心工作室阶段：

- **双线入口**：支持“需求对话与调研 (Brief)”与“资料粘贴提取 (Paste)”两种模式。
- **结构梳理**：通过“便利贴墙 (Board)”完成大纲规划与叙事逻辑排序。
- **三步工作室 (Studio)**：
  1. **Research (检索)**：搜集并沉淀单页资料卡。
  2. **Draft (初稿)**：基于资料生成结构化策划案。
  3. **Design (设计)**：将策划案渲染为高保真 SVG/Bento 设计稿。
- **智能导出 (Smart Export)**：深度解析 SVG，将标准元素转换为 PPTX 原生可编辑组件。

## 🏗️ 架构与目录结构

本项目采用 Monorepo 结构，各模块职责明确：

```text
apps/
  ├── api/              # Node.js 后端服务 (核心调度、AI 适配、导出处理)
  ├── api-python/       # Python 后端服务 (提供额外的独立处理能力)
  └── web/              # React 前端工作台 (五步流水线操作界面)

packages/
  ├── agents/           # LLM 适配层与提示词链 (Gemini/Mock/OpenAI Compatible)
  ├── ppt-renderer/     # PPTX 渲染引擎 (解析 SVG 转换为原生可编辑对象)
  └── shared/           # 前后端共享类型定义 (Zod Schema, DTOs, ThemePacks)

prisma/                 # PostgreSQL 数据库模型、数据迁移脚本与种子数据
docs/                   # 项目详尽的架构设计、阶段规划与产品需求文档 (PRD)
storage/exports/        # 本地生成的 PPTX 产物 (已被 gitignore)
```

## 🚀 快速启动

本系统主要依赖 Node.js (基于 pnpm) 进行管理，部分后端服务使用了 Python (uv)。

### 一键启动 (推荐)

我们提供了便捷的本地启动脚本，将自动完成依赖安装、数据库初始化及多服务启动：

```bash
chmod +x start-dev.sh
./start-dev.sh
```

### 手动部署指南

1. **环境与依赖安装**
   ```bash
   corepack pnpm setup  # 依据 package.json，此命令会一并安装 Node 与 Python 依赖
   ```

2. **数据库初始化**
   ```bash
   corepack pnpm db:generate
   corepack pnpm db:migrate
   ```

3. **启动所有服务**
   ```bash
   corepack pnpm dev
   ```

> **注意**：首次启动时，若根目录下不存在 `.env` 文件，`start-dev.sh` 会自动基于 `.env.example` 复制一份。不配置 Gemini Key 时，默认使用 `mock` 数据提供商进行离线功能演示。

### 服务访问端点

- 🌐 **Web 前端工作台**: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- 🔌 **API 服务**: [http://127.0.0.1:4000](http://127.0.0.1:4000)
- 🩺 **健康检查**: [http://127.0.0.1:4000/api/health](http://127.0.0.1:4000/api/health)
- 🤖 **AI 状态监控**: [http://127.0.0.1:4000/api/ai/status](http://127.0.0.1:4000/api/ai/status)

## ⚙️ 配置指南 (环境变量)

请复制 `.env.example` 生成 `.env` 文件（请勿将真实 API Key 提交到版本库），并根据需要进行配置：

```env
# 数据库配置 (PostgreSQL)
DATABASE_URL="postgresql://user:password@localhost:5432/ppt_agent"

# AI 提供商配置 (可选: mock, gemini, openai-compatible)
AI_PROVIDER="gemini"
GEMINI_API_KEY="您的 Gemini API Key"

# 模型配置 (建议分离结构化模型与设计模型以优化成本与效果)
GEMINI_MODEL="gemini-3.1-flash-lite"        # 用于事实提取与普通策划 (低成本，响应快)
GEMINI_DESIGN_MODEL="gemini-3.5-flash"      # 用于高级页面设计和视觉渲染

# 代理配置 (如本机访问外部接口受限，请配置此项)
# GEMINI_PROXY_URL="http://127.0.0.1:7892"
```

## 🛠️ 常用开发命令

```bash
corepack pnpm dev            # 同时启动所有服务
corepack pnpm dev:api        # 单独启动 Node API 服务
corepack pnpm dev:python-api # 单独启动 Python API 服务
corepack pnpm dev:web        # 单独启动前端工作台
corepack pnpm typecheck      # 运行全局 TypeScript 类型检查
corepack pnpm db:generate    # 依据 Prisma Schema 重新生成 Client
corepack pnpm db:migrate     # 应用 Prisma 结构迁移
corepack pnpm db:studio      # 开启本地数据库可视化管理界面
```

## 🎨 智能渲染与导出机制 (Smart Export)

本引擎最具竞争力的核心在于其**精准的 SVG 解析与渲染策略**。最终导出并非简单的图片堆叠，而是对 LLM 生成物进行了深度重构：

1. **多模式导出**:
   - `Draft (草稿模式)`: 基于基础主题模版，快速生成且成本较低。
   - `Standard (标准模式)`: **推荐**。智能识别并解析 SVG，遇到渲染故障时自动优雅降级。
   - `Visual (视觉模式)`: 追求最极致的全量 SVG 视觉转换效果。
2. **防幻觉重构**: 引擎后端会自动深度清洗设计图（SVG）中的大语言模型幻觉文本，避免乱写虚假日期、倒计时和不存在的凭空数字。
3. **原生对象编译**: PPT 渲染层（`ppt-renderer`）负责将 SVG 节点中的 `<rect>`, `<text>`, `<line>`, `<circle>` 等图形元素，精准转换为原生的 PowerPoint 可编辑对象。
4. **交付体验**: 最终生成的 `.pptx` 内组件可拖拽、文本框可修改、且样式完美继承。

## 📚 维护与扩展阅读

对于需要参与二次开发和日常维护的开发者，请在着手代码前务必查阅以下核心文档：

- 📖 [**项目文档中心 (docs/README.md)**](./docs/README.md) - 按阶段查阅架构演进及每日执行记录。
- 🏛️ [**文章式工作室完整设计 (DESIGN_文章式PPT_Agent工作室.md)**](./docs/DESIGN_文章式PPT_Agent工作室.md) - 系统边界、设计模式与渲染管道说明。
- 🔧 [**日常维护手册 (MAINTENANCE.md)**](./docs/MAINTENANCE.md)
- 📝 [**原始产品需求 (PRD)**](./docs/prd/editable-ppt-agent-engine-prd.md)

> 💡 **提交规范提示**：
> - 每次 Commit 前请确认能够顺利通过 `corepack pnpm typecheck`。
> - 严禁将 `.env` 及 `storage/exports/` 等临时与敏感文件提交至 Git 仓库中。
