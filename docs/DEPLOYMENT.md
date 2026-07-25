# SmartDiagram 部署教程

> 统一平台（思维导图 / 图表 + PPT）从本地到服务器上线的完整指南

---

## 目录

1. [架构与服务](#架构与服务)
2. [部署命令怎么选](#部署命令怎么选)
3. [首次部署](#首次部署)
4. [日常更新](#日常更新)
5. [环境变量](#环境变量)
6. [域名与 HTTPS](#域名与-https)
7. [日常运维](#日常运维)
8. [常见问题](#常见问题)
9. [检查清单](#检查清单)

---

## 架构与服务

### 对外入口

生产环境**只有一个对外 HTTP 端口**：聚合网关 `gateway`（默认宿主机 **9237**）。宝塔 / Nginx 只需反代这一端口。

```
                    ┌─────────────────────────────────────┐
                    │  gateway (:9237 → 容器 :80)          │
                    │  /          → web（统一 SPA）        │
                    │  /api/      → api-diagram :8000     │
                    │  /ppt-api/  → ppt-python-api :4000  │
                    │  /drawio/   → drawio :9022          │
                    └─────────────────────────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
  smartdiagram-web            smartdiagram-api-diagram      smartdiagram-ppt-*
  （apps/web 构建）            （apps/api-diagram）           Node :4010 + Python :4000
         │                            │                            │
         └────────────────────────────┼────────────────────────────┘
                                      ▼
                         PostgreSQL（smartdiagram + ppt_agent）
                         Redis · 命名卷（knowledgedata / pptdata）
```

### Compose 服务对照

| 服务名 | 容器名 | 作用 | 默认对外 |
|--------|--------|------|----------|
| `gateway` | `smartdiagram-gateway` | 统一入口、路径分流 | **9237** |
| `web` | `smartdiagram-web` | 统一 SPA（`/diagram` + `/ppt`） | 仅内网 |
| `api-diagram` | `smartdiagram-api-diagram` | 图表 / Auth / 知识库 API | 9236（调试） |
| `ppt-python-api` | `smartdiagram-ppt-python-api` | PPT 编排 API | 仅内网 |
| `ppt-node-api` | `smartdiagram-ppt-node-api` | PPT 渲染 / Prisma | 仅内网 |
| `db` | `smartdiagram-db` | PostgreSQL | 5432 |
| `redis` | `smartdiagram-redis` | 限流 / 队列 | 6379 |
| `drawio` | `smartdiagram-drawio` | 画板 iframe | 9022 |
| `worker` | `smartdiagram-worker` | 异步导出 / 知识库队列 | profile `worker` |
| `qdrant` | `smartdiagram-qdrant` | 向量库（可选） | profile `qdrant` |

> 旧版单独的 `frontend`、`backend`、`ppt-web` 服务已合并为 `web` + `api-diagram` + PPT 双 API。

---

## 部署命令怎么选

`deploy.sh` **仍然是生产部署的唯一入口**，你之前用的 `--with-worker` **继续有效**。

| 场景 | 命令 |
|------|------|
| **服务器日常更新（最推荐）** | `./deploy.sh --update --with-worker` |
| 代码已 `git pull`，只部署 | `./deploy.sh --with-worker` |
| 首次部署 | `./deploy.sh --with-worker` |
| 国内 / 宝塔，先验镜像 | `./deploy.sh --check-mirror` |
| 国内强制加速 | `./deploy.sh --update --with-worker --cn` |
| 启用 Qdrant | 加 `--with-qdrant` |
| 仅备份 | `./deploy.sh --backup` |
| 部署前 env 自检 | `npm run env:validate` |
| 合并旧 env 后自检 | `npm run env:merge-legacy` |
| 查看状态 / 日志 | `./deploy.sh --status` / `--logs` |
| 停止（保留数据卷） | `./deploy.sh --down` |

### `--with-worker` 是什么？

- 启动 Compose **`worker` profile**，运行 `apps/api-diagram` 里的企业后台 worker。
- 负责：**异步导出**（`mode=redis` / `queued`）、**知识库 ingestion**（`ingestion_mode=redis` / `queued`）、stale job 恢复、Redis 分布式锁。
- **不带 worker**：图表仍可生成，但队列类任务不会后台执行。
- **PPT 模块**不依赖此 flag；`ppt-node-api` / `ppt-python-api` 默认就会部署。
- 部署脚本在 `--with-worker` 成功后会自动跑 `scripts/verify-worker-deployment.sh`（Redis PING + worker 进程 + `/api/health` 的 `dependencies.redis`）。

### `--update` 做什么？

1. `git pull --ff-only origin main`（工作区有未提交修改会中止）
2. 备份 `smartdiagram` + `ppt_agent` + 用户文件卷
3. 构建镜像 → 增量 migrate → `compose up -d`
4. 健康检查：主 API、网关、`/ppt-api/api/health`

**不会**执行 `down -v` 或删除命名卷。

更细的安全策略见 [SERVER_DEPLOYMENT.md](./SERVER_DEPLOYMENT.md)。

---

## 首次部署

### 1. 服务器要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| 系统 | Ubuntu 22.04 | Ubuntu 24.04 |
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB（含 PPT 渲染建议更高） |
| 磁盘 | 40 GB SSD | 80 GB SSD |

安装 Docker Compose V2 与 Git（见旧版步骤，此处略）。

### 2. 克隆与配置

```bash
cd /opt
git clone git@github.com:你的组织/SmartDiagram.git
cd SmartDiagram

cp .env.example .env
nano .env
```

**只需维护根目录 `.env`**（Platform / Diagram / PPT 三分区）。`apps/api-diagram/.env` 可选，默认留空。

必填示例：

```bash
# Platform
DB_PASSWORD=你的强密码          # 首次初始化后勿改，否则连不上已有卷
PPT_INTERNAL_API_SECRET=至少32字节的随机串
GATEWAY_PORT=9237

# Diagram
DIAGRAM_DATABASE_URL=postgresql+asyncpg://postgres:你的强密码@localhost:5432/smartdiagram
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1

# PPT（Prisma 读 DATABASE_URL）
DATABASE_URL=postgresql://postgres:你的强密码@localhost:5432/ppt_agent?schema=public
# AI / TTS 等见 .env.example PPT 分区
```

生成随机密钥：

```bash
openssl rand -hex 32   # PPT_INTERNAL_API_SECRET、AUTH_SESSION_SECRET 等
```

### 3. 一键部署

```bash
chmod +x deploy.sh

# 合并旧 env（若服务器还有 backend/.env 等）并校验双库/密钥
npm run env:merge-legacy

# 国内建议先检查镜像
./deploy.sh --check-mirror

# 首次完整部署（脚本内会再次自动校验 env，通过后才备份/构建）
./deploy.sh --with-worker
```

### 4. 验证

```bash
./deploy.sh --status
npm run worker:verify    # 单独检查 Redis + worker（生产/本地 Docker 均可）
```

浏览器访问：`http://服务器IP:9237`  
调试 API：`http://服务器IP:9236/api/health`（应含 `"dependencies":{"redis":"ok"}`）  
PPT 健康（经网关）：`http://服务器IP:9237/ppt-api/api/health`

**生产队列任务**建议 API 使用 Redis 模式（需 worker 运行）：

- 导出：`POST .../exports` body `{ "format": "pdf", "mode": "redis" }`
- 知识库：`ingestion_mode=redis`

---

## 日常更新

```bash
cd /opt/SmartDiagram
git status --short          # 有未提交修改时 deploy 会拒绝 --update
./deploy.sh --update --with-worker
```

若已手动 `git pull`：

```bash
./deploy.sh --with-worker
```

需要 Qdrant 时：

```bash
./deploy.sh --update --with-worker --with-qdrant
```

---

## 环境变量

| 变更点 | 旧版 | 现在 |
|--------|------|------|
| 配置文件 | `backend/.env` | **根 `.env` 唯一主配置** |
| 图表库 | `DATABASE_URL` | **`DIAGRAM_DATABASE_URL`**（图表后端优先） |
| PPT 库 | 独立 sqlite / 旧路径 | **`DATABASE_URL` → `ppt_agent`** |
| 网关端口 | 80 或混用 | **`GATEWAY_PORT=9237`**（避免与宝塔 80 冲突） |

`docker-compose.yml` 通过 `env_file: ./.env` 注入各服务，并在 `environment` 段覆盖容器内网络地址（如 `@db:5432`）。

---

## 域名与 HTTPS

宝塔 / 宿主机 Nginx **只反代 gateway**：

```nginx
location / {
    proxy_pass http://127.0.0.1:9237;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 900s;   # SSE / PPT 长任务
}
```

不要直接把 `web` 或 `api-diagram` 暴露到公网 80。

---

## 日常运维

| 操作 | 命令 |
|------|------|
| 部署 / 更新 | `./deploy.sh --update --with-worker` |
| 仅备份 | `./deploy.sh --backup` |
| 日志 | `./deploy.sh --logs` |
| 状态 | `./deploy.sh --status` |
| 停止 | `./deploy.sh --down` |
| 清理悬空镜像 | `./deploy.sh --clean` |
| 图表 API 日志 | `docker compose logs -f api-diagram` |
| PPT Python 日志 | `docker compose logs -f ppt-python-api` |
| 进入主库 | `docker compose exec db psql -U postgres -d smartdiagram` |
| 进入 PPT 库 | `docker compose exec db psql -U postgres -d ppt_agent` |

备份目录：`backups/<UTC时间>/`（含双库 dump + 用户卷 tar + 校验和）。

---

## 常见问题

### Q: 以前只用 `./deploy.sh --with-worker`，现在还要改吗？

**不用改习惯。** 日常更新建议加上 `--update`：

```bash
./deploy.sh --update --with-worker
```

### Q: 前端白屏

```bash
docker compose logs web gateway
docker compose build web gateway --no-cache
./deploy.sh --with-worker
```

确认访问的是 **9237**（gateway），不是旧的 80 直连 frontend。

### Q: PPT 模块 502

```bash
docker compose logs ppt-python-api ppt-node-api
curl -s http://127.0.0.1:9237/ppt-api/api/health
```

检查根 `.env` 的 PPT 密钥与 `DATABASE_URL`（`ppt_agent`）。

### Q: 图表 API 500

```bash
docker compose logs api-diagram
```

检查根 `.env` 的 `OPENAI_API_KEY`、`DIAGRAM_DATABASE_URL`。

### Q: Worker 任务不执行

确认部署时带了 `--with-worker`，且 worker 容器在运行：

```bash
docker compose --profile worker ps worker
npm run worker:verify
docker compose --profile worker logs worker --tail=100
```

异步任务需使用 Redis/队列模式（见上文「生产队列任务」）；`mode=sync` / `ingestion_mode=sync` 不会进入 worker。

### Q: 国内构建慢 / 拉镜像失败

```bash
./deploy.sh --check-mirror
# 宝塔：Docker → 设置 → 加速 URL → https://docker.1ms.run
./deploy.sh --update --with-worker --cn
```

---

## 检查清单

- [ ] Docker Compose V2 可用
- [ ] 根目录 `.env` 已从 `.env.example` 创建并填密钥
- [ ] `DIAGRAM_DATABASE_URL` 与 `DATABASE_URL` 分别指向两个库
- [ ] `PPT_INTERNAL_API_SECRET` ≥ 32 字节
- [ ] `GATEWAY_PORT=9237`（宝塔环境）
- [ ] `./deploy.sh --with-worker` 或 `--update --with-worker` 成功
- [ ] `npm run worker:verify` 通过（若启用了 worker）
- [ ] `gateway`、`web`、`api-diagram`、`ppt-*` 均为 running
- [ ] 浏览器可打开 `/`、`/diagram`、`/ppt`
- [ ] 图表对话与 PPT 生成均正常
- [ ] （可选）`--with-qdrant` + `KNOWLEDGE_VECTOR_BACKEND=qdrant`
- [ ] 定期 `./deploy.sh --backup` 或同步 `backups/` 目录

---

## 相关文档

- [SERVER_DEPLOYMENT.md](./SERVER_DEPLOYMENT.md) — 备份策略、迁移安全、宝塔镜像
- [README.md](../README.md) — 本地开发 `npm run dev`
- [.env.example](../.env.example) — 完整环境变量模板
