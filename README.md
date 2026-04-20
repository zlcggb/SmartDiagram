# SmartDiagram AI

> 🧠 对话即绘图 — 用自然语言生成专业图表的智能可视化平台

SmartDiagram 集成 7 种绘图引擎，通过 AI Agent 智能路由，让用户在一个界面中完成需求描述、AI 理解、图表生成和实时编辑的完整闭环。

---

## ✨ 核心特性

| 特性 | 说明 |
|------|------|
| **7 引擎渲染** | Excalidraw 手绘 · Mermaid 标准图 · React Flow 流程图 · ECharts 数据图表 · mind-elixir 思维导图 · Draw.io 架构图 · AntV 信息图 |
| **智能路由** | LangGraph Agent 编排，自动识别意图分发到最佳引擎 |
| **流式响应** | SSE 流式传输，设计思路和代码分离输出，实时渲染 |
| **@tag 语法** | `@excalidraw`、`@mermaid`、`@drawio` 等标签显式选择引擎 |
| **语义图表** | 统一的形状词汇 · 语义箭头系统 · AI 领域模式库 |
| **多轮编辑** | 在已有图表上追加修改（"把颜色改成蓝色"） |

---

## 🛠 技术栈

```
┌──────────────────────────────────────┐
│          前端 (Frontend)              │
│  React 19 · TypeScript · Vite 8      │
│  TailwindCSS v4 · Zustand            │
├──────────────────────────────────────┤
│          后端 (Backend)               │
│  Python 3.12+ · FastAPI · LangGraph  │
│  LangChain · uvicorn                 │
├──────────────────────────────────────┤
│        基础设施 (Infra)               │
│  Docker Compose · Nginx · PostgreSQL │
└──────────────────────────────────────┘
```

---

## 🚀 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) ≥ 18
- [uv](https://docs.astral.sh/uv/) (Python 包管理器)
- 一个 OpenAI 兼容的 API Key

### 1. 配置环境变量

```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入你的 API Key 和 Base URL
```

### 2. 一键启动（推荐）

```bash
npm run dev
```

这会同时启动前后端：
- 🖥 前端 → http://localhost:5173
- ⚙️ 后端 → http://localhost:8000

按 `Ctrl+C` 停止所有服务。

### 3. 分别启动

```bash
# 仅后端
npm run dev:backend

# 仅前端（新终端）
npm run dev:frontend
```

### 4. Docker 部署

```bash
npm run docker
# 或
docker-compose up --build -d
```

---

## 📖 使用方式

在聊天面板输入自然语言描述即可生成图表：

| 示例 Prompt | 路由引擎 |
|-------------|---------|
| 画一个微服务架构图 | Draw.io |
| 画用户登录的时序图 | Mermaid |
| 画一个 RAG Pipeline 流程 | React Flow |
| 帮我画个项目管理思维导图 | mind-elixir |
| 2024年销售数据柱状图 | ECharts |
| @excalidraw 画一个系统草图 | Excalidraw（@tag 强制） |

---

## 📁 项目结构

```
SmartDiagram/
├── package.json          # 根目录 npm scripts
├── dev.sh                # 一键启动脚本
├── docker-compose.yml    # Docker 编排
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── api/routes.py        # SSE 流式端点
│   │   ├── agents/              # 7 个绘图 Agent + 路由
│   │   │   ├── orchestrator.py  # LangGraph 状态图
│   │   │   ├── router.py        # 意图路由
│   │   │   ├── semantic_knowledge.py  # 语义知识库
│   │   │   ├── excalidraw_agent.py
│   │   │   ├── mermaid_agent.py
│   │   │   ├── flow_agent.py
│   │   │   ├── drawio_agent.py
│   │   │   ├── charts_agent.py
│   │   │   ├── mindmap_agent.py
│   │   │   └── infographic_agent.py
│   │   └── core/                # 配置、LLM、日志
│   └── .env                     # 环境变量（不提交）
└── frontend/
    └── src/
        ├── App.tsx              # 根布局
        ├── store/chatStore.ts   # Zustand 状态
        └── components/
            ├── layout/          # ChatPanel、CanvasPanel
            └── canvas/          # 7 种渲染器
```

---

## ⚙️ 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | ✅ | LLM API 密钥 |
| `OPENAI_BASE_URL` | ✅ | API 基地址 |
| `MODEL_ID` | ❌ | 默认模型（默认 `gpt-4o`）|
| `MODEL_ROUTE_*` | ❌ | 各 Agent 独立模型路由 |
| `DATABASE_URL` | ❌ | PostgreSQL（不配则 stateless）|

---

## 📄 许可证

[MIT License](./LICENSE)
