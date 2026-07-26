# SmartDiagram

> 对话即绘图 · AI 演示文稿 — 统一平台：思维导图 / 7 种图表引擎 + PPT 智能制作

SmartDiagram 在一个桌面式 SPA 中集成 **图表 AI** 与 **PPT Agent**：`/diagram` 用自然语言生成专业图表，`/ppt` 完成演示文稿创作与导出。

---

## 📋 操作速查

| 我想… | 命令 |
|--------|------|
| **本地开发** | `cp .env.example .env` → 填 LLM 密钥 → `npm run dev` |
| **检查环境变量** | `npm run env:validate` |
| **服务器首次部署** | 见下方 [首次部署](#-服务器首次部署) |
| **服务器一键更新** | `./deploy.sh --update --with-worker` |
| **合并旧版 env 文件** | `npm run env:merge-legacy` |
| **详细部署文档** | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) · [docs/SERVER_DEPLOYMENT.md](./docs/SERVER_DEPLOYMENT.md) |
| **架构 A 文档（AI/开发 onboarding）** | [AGENTS.md](./AGENTS.md) → [smartdiagram_architecture.md](./smartdiagram_architecture.md) |

---

## ✨ 核心能力

### 图表模块（`/diagram`）

| 特性 | 说明 |
|------|------|
| **7 引擎渲染** | Excalidraw · Mermaid · React Flow · ECharts · mind-elixir · Draw.io · AntV |
| **LangGraph 编排** | 智能路由、Knowledge、Validator/Repair、一致性检查 |
| **企业能力** | 会话持久化、知识库、异步导出、运维看板（需 `--with-worker`） |

### PPT 模块（`/ppt`）

| 特性 | 说明 |
|------|------|
| **AI 生成** | 大纲 → 幻灯片 → 渲染 / TTS / 视频 |
| **双库** | 图表库 `smartdiagram` + PPT 库 `ppt_agent`（根 `.env` 分开配置） |

---

## 🏗 架构概览

**本地**：`npm run dev` → 浏览器 `:5173`，Vite 热更新。

**生产**：唯一入口 `gateway :9237` → 分流 SPA / 图表 API / PPT API / draw.io。

```
gateway :9237
  ├─ /           → web（/ · /diagram · /ppt）
  ├─ /api/       → api-diagram
  ├─ /ppt-api/   → ppt-python-api → ppt-node-api
  └─ /drawio/    → drawio
```

---

## 🚀 本地开发（最小化启动）

### 前置

Node.js ≥ 18 · [uv](https://docs.astral.sh/uv/) · Docker Desktop

### 步骤

```bash
# 1. 唯一配置文件
cp .env.example .env

# 2. 至少填入图表 LLM（见下方「最小必填项」）
# 3. 检查（可选）
npm run env:validate

# 4. 一键启动
npm run dev
```

打开 http://localhost:5173 · `Ctrl+C` 停止（Docker 里的 db/redis 保持运行）。

演示账号：`user@smartdiagram.local` / `user123456`（管理员 `admin@smartdiagram.local` / `admin123456`）。

### 其他本地命令

```bash
npm run dev:gateway   # 接近生产的网关模式 :8080
npm run db:up         # 只起 db / redis / drawio
npm run db:prepare    # 双库 migrate
```

---

## ⚙️ 环境变量怎么配？

### 原则：一个文件，三个分区

所有配置写在**仓库根目录 `.env`**（从 `.env.example` 复制）。不要用已废弃的 `backend/.env`、`ppt-agent-engine/.env`；`apps/api-diagram/.env` 保持空即可。

```
.env
├── 1) Platform / Deploy    ← 部署、DB 密码、网关端口
├── 2) Diagram              ← 图表 / 思维导图 LLM、Auth、知识库
└── 3) PPT                  ← PPT AI、TTS、Prisma（DATABASE_URL）
```

**双库不要混：**

| 变量 | 指向的库 |
|------|----------|
| `DIAGRAM_DATABASE_URL` | `smartdiagram`（图表） |
| `DATABASE_URL` | `ppt_agent`（PPT，Prisma 约定） |

---

### 最小必填项（能跑起来）

#### 本地开发 — 只玩图表

```env
OPENAI_API_KEY=sk-你的密钥
OPENAI_BASE_URL=https://你的-api-地址/v1
MODEL_ID=gemini-2.5-flash
```

其余保持 `.env.example` 默认即可（本地 DB 密码默认 `smartdiagram_secret`）。

#### 本地开发 — 图表 + PPT 演示

在上面的基础上增加：

```env
AI_PROVIDER=mock
```

或填真实 PPT AI：

```env
AI_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_API_KEY=sk-...
OPENAI_COMPATIBLE_BASE_URL=https://...
OPENAI_COMPATIBLE_MODEL=gemini-3.5-flash
```

#### 服务器生产 — 最小手填

```env
# Diagram 分区
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://...

# PPT 分区（二选一）
AI_PROVIDER=mock
# 或 OPENAI_COMPATIBLE_API_KEY + OPENAI_COMPATIBLE_BASE_URL + OPENAI_COMPATIBLE_MODEL
```

**下面几项不用手填**，首次 `deploy` 会自动生成并写入 `.env`：

- `DB_PASSWORD`（无旧 PG 卷时）及双库 URL 中的密码
- `PPT_INTERNAL_API_SECRET`
- `AUTH_SESSION_SECRET`、`ALTCHA_HMAC_KEY`

**FFmpeg** 不用配：Docker 镜像已内置；本地自动从 PATH 探测。

#### 生产环境建议额外修改

```env
AUTH_LOCAL_LOGIN_ENABLED=false
AUTH_SHOW_DEMO_PRESETS=false
GATEWAY_PORT=9237
```

`AUTH_LOCAL_LOGIN_ENABLED` 与 `AUTH_SHOW_DEMO_PRESETS` 只供本机演示；生产部署校验会拒绝开启，避免测试账号及管理员入口暴露到公网。

---

### 自动生成 vs 必须手填（对照表）

| 变量 | 首次部署 | 说明 |
|------|----------|------|
| `OPENAI_API_KEY` | ✍️ 手填 | 图表 LLM |
| `OPENAI_BASE_URL` | ✍️ 手填 | API 地址 |
| `OPENAI_COMPATIBLE_*` | ✍️ 手填或 mock | PPT AI |
| `DB_PASSWORD` | 🤖 自动 | 有旧 PG 卷则保留原值 |
| `DIAGRAM_DATABASE_URL` / `DATABASE_URL` | 🤖 自动同步密码 | 库名勿改 |
| `PPT_INTERNAL_API_SECRET` | 🤖 自动 | |
| `AUTH_SESSION_SECRET` | 🤖 自动 | |
| `FFMPEG_PATH` | ➖ 留空 | 自动探测 |

---

### 如何检查环境变量？

```bash
# 仅校验，不改文件
npm run env:validate

# 从旧 backend/.env、ppt-agent-engine/.env 合并缺失键后再校验
npm run env:merge-legacy
```

检查内容示例：

- ✅ `DIAGRAM_DATABASE_URL` → `smartdiagram`
- ✅ `DATABASE_URL` → `ppt_agent`
- ✅ LLM / PPT 密钥非占位符
- ✅ 自动生成项已就绪
- ⚠️ 警告项（如演示账号未关闭）不会阻断本地，生产 deploy 会提示

**`./deploy.sh` 在构建和备份前也会自动跑同一套检查**；不通过则不会构建镜像。

提交或部署前可执行 `npm run verify:release`。它会先运行 TypeScript 与 Python 全量自动化测试，再按生产镜像依赖顺序构建全部 TypeScript workspace 和统一前端；任何一步失败都会停止，不应继续部署。

部署脚本默认要求宿主根分区和项目分区各至少保留 3 GiB，并按应用服务严格串行构建，适配小容量服务器并降低并发下载把 Docker 存储层打满的风险。高配置服务器可把 `DEPLOY_BUILD_PARALLEL_LIMIT` 调为大于 `1` 以启用批量构建；磁盘安全线可通过 `DEPLOY_MIN_FREE_GB` 调高。`--rebuild` 全量无缓存构建建议临时使用至少 10 GiB 安全线。

手动查看关键项：

```bash
grep -E '^(OPENAI_API_KEY|DIAGRAM_DATABASE_URL|DATABASE_URL|DB_PASSWORD|AI_PROVIDER)=' .env
```

---

## 🆕 服务器首次部署

适用：**新项目**、空服务器、第一次拉代码。

### 1. 环境准备

- Ubuntu 22.04+ / Debian 12+
- Docker Compose V2、Git
- 推荐 4 核 8G 内存、40G+ 磁盘

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 重新登录生效
```

### 2. 拉代码 + 配置

```bash
cd /opt
git clone git@github.com:你的组织/SmartDiagram.git
cd SmartDiagram

cp .env.example .env
nano .env
```

在 `.env` 里**只填 LLM / PPT AI 密钥**（见 [最小必填项](#最小必填项能跑起来)）。

### 3. 检查 + 部署

```bash
chmod +x deploy.sh

# 国内服务器建议先验 Docker 镜像
./deploy.sh --check-mirror

# 合并旧 env（若从旧版迁移）并校验
npm run env:merge-legacy

# 首次完整部署（自动生成 DB 密码等，然后构建启动）
./deploy.sh --with-worker
```

### 4. 验证

```bash
./deploy.sh --status
```

- 浏览器：`http://服务器IP:9237`
- 图表 API：`http://服务器IP:9236/api/health`
- PPT（经网关）：`http://服务器IP:9237/ppt-api/api/health`

### 5. 宝塔 / Nginx 反代

只反代 **9237**（`GATEWAY_PORT`）：

```nginx
location / {
    proxy_pass http://127.0.0.1:9237;
    proxy_read_timeout 900s;
    proxy_buffering off;
}
```

---

## 🔄 服务器一键更新

适用：**已经在跑**的旧服务器，拉新版本代码。

```bash
cd /opt/SmartDiagram

# 可选：备份当前 .env
cp .env .env.backup.$(date +%Y%m%d)

# 一条命令：拉代码 → 校验 env → 构建预检 → 备份数据库 → 迁移 → 重启 → 健康检查
./deploy.sh --update --with-worker
```

| 情况 | 命令 |
|------|------|
| 标准更新 | `./deploy.sh --update --with-worker` |
| 已手动 `git pull` | `./deploy.sh --with-worker` |
| 用了 Qdrant | `./deploy.sh --update --with-worker --with-qdrant` |
| 国内网络 | `./deploy.sh --update --with-worker --cn` |
| 仅备份不重启 | `./deploy.sh --backup` |
| 看日志 | `./deploy.sh --logs` |
| 验证 worker | `npm run worker:verify` |

**安全保证：**

- 更新前自动备份 `smartdiagram` + `ppt_agent` + 用户文件卷
- 不会 `docker compose down -v`，**不删数据库**
- 已有 PG 卷时**不会改**你的 `DB_PASSWORD`
- 代码有未提交修改时 `--update` 会拒绝执行，避免覆盖服务器本地改动

npm 等价：`npm run deploy:update`

---

## 🐳 部署命令说明

| 场景 | 命令 |
|------|------|
| 首次部署 | `./deploy.sh --with-worker` |
| **日常更新（推荐）** | `./deploy.sh --update --with-worker` |
| 检查 env | `npm run env:validate` |
| 停止服务（保留数据） | `./deploy.sh --down` |

**`--with-worker`**：启动后台 worker（异步导出、知识库队列）。生产建议始终带上。PPT 服务默认就会部署，不需要额外 flag。

---

## 📁 项目结构

```
SmartDiagram/
├── .env / .env.example       # 唯一主配置
├── dev.sh                    # 本地 npm run dev
├── deploy.sh                 # 生产部署 / 更新
├── scripts/
│   ├── validate-deploy-env.sh      # env 校验
│   ├── bootstrap-deploy-secrets.sh   # 自动生成密钥
│   └── dev-common.sh                 # 本地启动公共逻辑
├── apps/web/                 # 统一前端
├── apps/api-diagram/         # 图表后端
├── apps/api-ppt/             # PPT Python
└── apps/service-ppt-renderer/ # PPT Node 渲染
```

---

## 📖 使用示例

| Prompt | 引擎 |
|--------|------|
| 画一个微服务架构图 | Draw.io |
| 项目管理思维导图 | mind-elixir |
| @excalidraw 系统草图 | Excalidraw |

PPT：浏览器打开 `/ppt` 进入工作台。

---

## 📄 许可证

[MIT License](./LICENSE)
