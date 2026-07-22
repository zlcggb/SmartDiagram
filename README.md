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
| **服务端短期记忆** | 会话摘要、最近消息和当前图表版本持久化到 PostgreSQL，下一轮 Agent 执行前按权限加载 |
| **会话历史检索** | 历史抽屉支持图表/会话切换；`GET /api/conversations/history` 可按权限浏览会话摘要、最近消息和授权当前图表快照，assistant 历史消息会带回可见 Agent 执行步骤、耗时、token 与成本估算，并可一键恢复聊天上下文和画布 |
| **长期偏好记忆** | 租户、团队、用户图表偏好持久化，前端可维护个人/团队偏好，Agent 生成和 Design Agent 优化时按权限注入 |
| **历史图表检索** | 按租户/项目权限检索历史图表、会话摘要、当前版本和 AI 执行过程，Knowledge Agent 可召回历史案例，前端可一键载入或创建分支复用 |
| **双语企业 UI** | 关键企业面板、设置中心、聊天主交互和画布主界面支持中英双语 i18n，语言选择会在本地保留；右侧头部仅保留历史和设置，偏好、运维、语言、主题和清空对话集中在设置里；分支、回滚和高风险导出使用应用内弹窗而不是浏览器原生 prompt |
| **输出校验修复** | Validator Agent 校验结构，Repair Agent 自动修复常见 DSL 问题 |
| **知识一致性检查** | Consistency Agent 对比授权知识约束，冲突时停止自动导出并创建可审批的人审请求 |
| **企业模板治理** | 团队/项目模板按权限管理，Knowledge Agent 生成前自动选择授权模板作为结构化起点 |
| **版本分支回滚** | 历史版本不可变，需求变化可创建分支、追加式回滚，并用版本 diff 解释变更 |
| **运维看板** | 在应用内查看 Agent runs、执行步骤、成本、预算、审计事件、待审批请求和 trace span |

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

### 3. 启动本地数据库（企业能力验证）

本项目的会话持久化、知识库检索、审计日志和版本化导出依赖 PostgreSQL；多实例限流和队列 worker 可使用 Redis。开发机不需要单独安装 PostgreSQL 或 Redis，直接使用 Docker Compose 启动项目自带基础设施：

```bash
npm run db:up
npm run smoke:runtime
npm run smoke:budget
npm run smoke:ops
npm run smoke:enterprise
npm run smoke:knowledge
npm run worker:once
```

`smoke:runtime` 会验证限流、单请求预算拒绝、降级和 Agent 循环保护。`smoke:budget` 会验证租户月度成本/token 配额、超额拒绝、用量 rollup 刷新、后台 rollup 维护任务和审计指标里的预算快照。`smoke:ops` 会验证 JSON 指标、Prometheus 文本指标导出、Agent 图节点 trace span、归一化 execution steps、tool call 落库、worker 队列健康和 stale running job 恢复。应用右侧头部的运维看板会消费同一组审计 API。`smoke:enterprise` 会创建图表版本，并验证服务端短期记忆、会话历史检索、长期偏好记忆、历史图表检索、版本分支、版本 diff、追加式回滚、JSON、SVG、PNG、PDF、PPTX 五种导出格式都能完成并下载，同时覆盖 PDF/PPTX 人工确认边界、知识一致性人审请求创建/审批/越权拒绝、异步导出任务、DB-backed queued 导出 worker、下载 URL 签发记录、项目成员导出权限、项目审计查询和运维指标。`smoke:knowledge` 会上传一份项目知识文档，并验证对象存储落盘、持久化向量检索、DB/Redis 队列 ingestion worker、企业模板创建/检索/Agent 选择、租户、项目成员、角色和 scope 的检索隔离。`worker:once` 会先恢复 stale running job，再处理一次待执行的导出和知识库队列；长期运行可用 `npm run worker`，Docker 部署可用 `docker compose --profile worker up -d worker`。需要专用 Qdrant 向量库时可用 `docker compose --profile qdrant up -d qdrant` 额外启动，并设置 `KNOWLEDGE_VECTOR_BACKEND=qdrant` 与 `QDRANT_URL=http://localhost:6333`。停止本地基础设施：

```bash
npm run db:down
```

本地登录页默认提供两种开发账号：

| 角色 | 邮箱 | 密码 | 权限 |
| --- | --- | --- | --- |
| 普通用户 | `user@smartdiagram.local` | `user123456` | 生成图表、读取授权知识、基础导出 |
| 管理员 | `admin@smartdiagram.local` | `admin123456` | 运维看板、审批、预算、高级导出 |

这些账号只用于本地开发，默认邮箱和密码可以在 `backend/.env` 里通过 `AUTH_DEMO_*` 配置覆盖。

### 4. 分别启动

```bash
# 仅后端
npm run dev:backend

# 仅前端（新终端）
npm run dev:frontend
```

### 5. Docker 部署

```bash
# 首次部署或代码已拉取后的安全部署
./deploy.sh --with-worker

# 已部署服务器一键更新：拉取、备份、增量迁移、更新、健康检查
./deploy.sh --update --with-worker

# 国内/宝塔服务器可先独立验证 Docker 镜像加速
./deploy.sh --check-mirror
```

更新流程不会删除 PostgreSQL、上传资料、知识库或 PPT 生成文件卷。完整的首次部署、备份、迁移和故障处理说明见 [服务器安全更新与数据库迁移](./docs/SERVER_DEPLOYMENT.md)。

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
| `DATABASE_URL` | ❌ | PostgreSQL（本地 Docker 默认 `postgresql+asyncpg://postgres:smartdiagram_secret@localhost:5432/smartdiagram`，不配则 stateless）|
| `REDIS_URL` | ❌ | Redis 限流后端地址（本地 Docker 默认 `redis://localhost:6379/0`）|
| `OBJECT_STORAGE_BACKEND` | ❌ | 对象存储后端：`local`、`s3` 或 `r2` |
| `OBJECT_STORAGE_LOCAL_ROOT` | ❌ | 本地对象存储根目录，默认 `backend/storage/objects` |
| `S3_ENDPOINT_URL` | ❌ | S3/R2 兼容 endpoint，例如 R2 account endpoint |
| `S3_BUCKET` | ❌ | S3/R2 bucket 名称 |
| `S3_REGION` | ❌ | S3 region，R2 可用 `auto` |
| `S3_ACCESS_KEY_ID` | ❌ | S3/R2 access key |
| `S3_SECRET_ACCESS_KEY` | ❌ | S3/R2 secret key |
| `S3_PUBLIC_BASE_URL` | ❌ | 可选公开访问域名，当前签名请求仍使用 endpoint |
| `KNOWLEDGE_INGESTION_REDIS_QUEUE` | ❌ | Redis 知识库 ingestion 队列名称 |
| `KNOWLEDGE_VECTOR_BACKEND` | ❌ | 知识库向量后端：`local_db`、`pgvector` 或 `qdrant` |
| `KNOWLEDGE_VECTOR_DIMENSIONS` | ❌ | pgvector/Qdrant 使用的向量维度 |
| `KNOWLEDGE_VECTOR_FALLBACK_TO_LOCAL` | ❌ | 原生向量后端不可用时是否回退到本地 DB-backed 向量 |
| `QDRANT_URL` | ❌ | Qdrant HTTP 地址，例如 `http://localhost:6333` |
| `QDRANT_API_KEY` | ❌ | Qdrant API key，内网无鉴权部署可留空 |
| `QDRANT_COLLECTION` | ❌ | Qdrant collection 名称，默认 `smartdiagram_knowledge` |
| `QDRANT_TIMEOUT_SECONDS` | ❌ | Qdrant HTTP 请求超时时间 |
| `KNOWLEDGE_SECURITY_POLICY_MODE` | ❌ | 知识库安全策略模式，当前为 `rule`，预留 ML/rule hybrid |
| `KNOWLEDGE_SECURITY_BLOCK_SEVERITY` | ❌ | 达到该风险级别时阻止注入 Prompt，默认 `high` |
| `KNOWLEDGE_SECURITY_TRUSTED_TERMS` | ❌ | 业务可信术语列表，用于降低中风险误报 |
| `RUNTIME_RATE_LIMIT_PER_MINUTE` | ❌ | 每个租户/用户的本地限流窗口 |
| `RUNTIME_RATE_LIMIT_BACKEND` | ❌ | 限流后端：`memory` 或 `redis` |
| `RUNTIME_RATE_LIMIT_REDIS_FAIL_OPEN` | ❌ | Redis 不可用时是否退回本地内存限流 |
| `RUNTIME_MAX_ESTIMATED_TOKENS` | ❌ | 请求进入 Agent 前的最大估算 token |
| `RUNTIME_DEGRADE_TOKEN_THRESHOLD` | ❌ | 触发短输出降级的估算 token 阈值 |
| `RUNTIME_MAX_STREAM_EVENTS` | ❌ | 单次 Agent 流最大事件数 |
| `RUNTIME_MAX_AGENT_REPEATS` | ❌ | 单个 Agent 节点最大重复次数 |
| `RUNTIME_INPUT_COST_PER_1K` | ❌ | 输入 token 成本估算单价 |
| `RUNTIME_OUTPUT_COST_PER_1K` | ❌ | 输出 token 成本估算单价 |
| `TENANT_DEFAULT_MONTHLY_COST_LIMIT` | ❌ | 新租户默认月度成本预算 |
| `TENANT_DEFAULT_MONTHLY_TOKEN_LIMIT` | ❌ | 新租户默认月度 token 预算 |
| `TENANT_BUDGET_HARD_LIMIT` | ❌ | 是否在超出租户预算时直接拒绝请求 |
| `USAGE_ROLLUP_SCHEDULER_ENABLED` | ❌ | 是否启动进程内用量 rollup 定时维护任务 |
| `USAGE_ROLLUP_REFRESH_ON_STARTUP` | ❌ | API 启动时是否立即刷新一次当前周期 rollup |
| `USAGE_ROLLUP_REFRESH_INTERVAL_SECONDS` | ❌ | rollup 维护任务执行间隔，最小 60 秒 |
| `WORKER_STALE_JOB_TIMEOUT_SECONDS` | ❌ | worker running job 超时判定阈值，默认 1800 秒 |
| `WORKER_STALE_JOB_ACTION` | ❌ | stale running job 处理策略：`requeue` 或 `fail` |
| `AUTH_LOCAL_LOGIN_ENABLED` | ❌ | 是否启用本地账号登录入口 |
| `AUTH_SESSION_SECRET` | ❌ | 本地登录 session 签名密钥，生产环境必须替换 |
| `AUTH_SESSION_TTL_SECONDS` | ❌ | 登录 session 有效期 |
| `AUTH_DEMO_USER_EMAIL` / `AUTH_DEMO_USER_PASSWORD` | ❌ | 普通用户开发账号 |
| `AUTH_DEMO_ADMIN_EMAIL` / `AUTH_DEMO_ADMIN_PASSWORD` | ❌ | 管理员开发账号 |

---

## 📄 许可证

[MIT License](./LICENSE)
