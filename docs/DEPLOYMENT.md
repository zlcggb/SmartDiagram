# SmartDiagram 部署教程

> 从本地开发到服务器上线的完整指南

---

## 目录

1. [总体流程](#总体流程)
2. [第一步：本地准备 — 推送到 GitHub](#第一步本地准备--推送到-github)
3. [第二步：服务器环境准备](#第二步服务器环境准备)
4. [第三步：拉取代码并配置](#第三步拉取代码并配置)
5. [第四步：一键部署](#第四步一键部署)
6. [第五步：域名和 HTTPS（可选）](#第五步域名和-https可选)
7. [日常运维](#日常运维)
8. [常见问题](#常见问题)

---

## 总体流程

```
本地开发 → Git Push → 服务器 Git Pull → Docker Compose 一键启动
```

```
┌──────────┐     git push     ┌──────────┐     git pull      ┌──────────────┐
│  本地 Mac │ ──────────────→ │  GitHub  │ ──────────────→  │  云服务器     │
│  开发机   │                 │  仓库    │                   │  (Ubuntu)    │
└──────────┘                  └──────────┘                   └──────┬───────┘
                                                                    │
                                                          docker compose up
                                                                    │
                                                            ┌───────▼───────┐
                                                            │  Nginx (:80)  │
                                                            │  Backend (:8k)│
                                                            │  PostgreSQL   │
                                                            │  Redis        │
                                                            │  Draw.io      │
                                                            └───────────────┘
```

---

## 第一步：本地准备 — 推送到 GitHub

### 1.1 确认 .gitignore 正确

确保以下敏感文件 **不会被提交**：

```bash
# 检查 .gitignore 是否包含关键排除项
cat .gitignore | grep -E "\.env|gcp-credentials"
```

应该看到：
```
.env
.env.local
backend/.env
gcp-credentials.json
```

> **注意**：`uv.lock` 和 `package-lock.json` 一样是依赖锁文件，**必须提交**到仓库，以确保服务器 Docker 构建时依赖版本一致。

### 1.2 清理已追踪的敏感文件

如果 `.env` 或密钥文件曾经被提交过，需要从 Git 历史中清除：

```bash
# 检查是否有敏感文件被追踪
git ls-files | grep -E "\.env$|gcp-credentials"

# 如果有，取消追踪（不删除本地文件）
git rm --cached backend/.env 2>/dev/null
git rm --cached backend/gcp-credentials.json 2>/dev/null
```

### 1.3 提交并推送

```bash
# 查看当前更改
git status

# 添加所有修改
git add -A

# 提交
git commit -m "feat: 完善部署配置"

# 推送到 GitHub
git push origin main
```

---

## 第二步：服务器环境准备

### 2.1 服务器要求

| 要求 | 最低配置 | 推荐配置 |
|------|----------|----------|
| 系统 | Ubuntu 22.04 / Debian 12 | Ubuntu 24.04 |
| CPU  | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 20 GB | 40 GB SSD |
| 网络 | 公网 IP | 公网 IP + 域名 |

### 2.2 安装 Docker

```bash
# 一键安装 Docker（官方脚本）
curl -fsSL https://get.docker.com | sh

# 将当前用户加入 docker 组（免 sudo）
sudo usermod -aG docker $USER

# 重新登录使权限生效
exit
# 重新 SSH 登录后验证
docker --version
docker compose version
```

### 2.3 安装 Git

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y git

# 验证
git --version
```

### 2.4 配置 SSH Key（推荐）

如果是私有仓库，需要配置 SSH：

```bash
# 生成 SSH 密钥
ssh-keygen -t ed25519 -C "your-email@example.com"

# 查看公钥
cat ~/.ssh/id_ed25519.pub

# 将公钥添加到 GitHub → Settings → SSH Keys
```

---

## 第三步：拉取代码并配置

### 3.1 克隆仓库

```bash
# 选择一个目录
cd /opt

# 克隆（HTTPS 方式 — 公开仓库）
sudo git clone https://github.com/zlcggb/SmartDiagram.git
cd SmartDiagram

# 如果用 SSH 方式
# git clone git@github.com:zlcggb/SmartDiagram.git
```

### 3.2 配置环境变量

`docker-compose.yml` 使用 `env_file` 直接读取 `backend/.env`，**只需配置这一个文件**即可。

```bash
# 从模板创建配置文件
cp backend/.env.example backend/.env

# 编辑配置
nano backend/.env
```

**必须修改的配置项：**

```bash
# ── 必填：LLM API 配置 ──
OPENAI_API_KEY=sk-your-real-api-key        # 替换为真实 API Key
OPENAI_BASE_URL=https://api.openai.com/v1  # 如果用中转站，改为中转站地址
MODEL_ID=gpt-4o                            # 或其他兼容模型

# ── 推荐修改：安全配置 ──
AUTH_SESSION_SECRET=your-random-secret     # Session 签名密钥（至少 32 字符随机串）
ALTCHA_HMAC_KEY=your-random-hmac-key       # CAPTCHA 验证密钥（至少 32 字符随机串）
```

> **生成随机密钥：**
> ```bash
> # 一次生成两个密钥
> echo "AUTH_SESSION_SECRET=$(openssl rand -hex 32)"
> echo "ALTCHA_HMAC_KEY=$(openssl rand -hex 32)"
> ```

**生产环境推荐配置：**

```bash
# 关闭演示账号预设
AUTH_SHOW_DEMO_PRESETS=false

# 安全验证（ALTCHA 自部署 PoW，无需外部服务）
ALTCHA_HMAC_KEY=<openssl rand -hex 32 生成>  # CAPTCHA 签名密钥
ALTCHA_ALGORITHM=SHA-256                     # 哈希算法
ALTCHA_MAX_NUMBER=100000                     # PoW 难度（越大越难，100000 约 1 秒）

# Auth 限速（每 IP 每分钟最多 5 次登录/注册）
AUTH_RATE_LIMIT_MAX=5
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
```

> **关于数据库密码**：`docker-compose.yml` 中数据库密码默认为 `smartdiagram_secret`。如需修改，在项目根目录创建 `.env` 文件：
> ```bash
> echo "DB_PASSWORD=your-strong-db-password" > .env
> ```

---

## 第四步：一键部署

### 4.1 使用部署脚本

```bash
# 赋予执行权限（首次）
chmod +x deploy.sh

# 一键部署！
./deploy.sh
```

部署脚本会自动完成：
1. ✅ 检查 Docker 环境
2. ✅ 检查 `.env` 配置
3. ✅ 构建前端和后端 Docker 镜像
4. ✅ 启动所有服务（PostgreSQL + Redis + Draw.io + Backend + Frontend）

### 4.2 验证部署

```bash
# 查看服务状态
./deploy.sh --status

# 应该看到所有容器都是 running 状态：
# smartdiagram-db        running  5432
# smartdiagram-redis     running  6379
# smartdiagram-drawio    running  9022
# smartdiagram-backend   running  8000
# smartdiagram-frontend  running  80
```

在浏览器访问：`http://你的服务器IP`

### 4.3 带可选服务的部署

```bash
# 同时启动异步 Worker（用于导出任务、知识库 ingestion）
./deploy.sh --with-worker

# 同时启动 Qdrant 向量数据库
./deploy.sh --with-qdrant

# 两个都要
./deploy.sh --with-worker --with-qdrant
```

---

## 第五步：域名和 HTTPS（可选）

### 方案 A：Nginx 反向代理 + Let's Encrypt

如果服务器上已有一个宿主机 Nginx，可以做反向代理：

```bash
# 安装 Nginx 和 Certbot
sudo apt install -y nginx certbot python3-certbot-nginx
```

创建 Nginx 配置：

```bash
sudo nano /etc/nginx/sites-available/smartdiagram
```

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:80;  # 指向 Docker 内的前端
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

> ⚠️ **注意**：如果宿主机 80 端口被 Nginx 占用，需要修改 `docker-compose.yml` 中 frontend 的端口映射，例如改为 `3000:80`，然后 `proxy_pass http://127.0.0.1:3000;`

```bash
# 启用站点
sudo ln -s /etc/nginx/sites-available/smartdiagram /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 申请 SSL 证书
sudo certbot --nginx -d yourdomain.com
```

### 方案 B：Cloudflare Tunnel（推荐，无需公网端口）

如果使用 Cloudflare 管理域名，可以用 Tunnel 免去端口暴露：

```bash
# 安装 cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

# 登录并创建隧道
cloudflared tunnel login
cloudflared tunnel create smartdiagram
cloudflared tunnel route dns smartdiagram yourdomain.com

# 运行隧道
cloudflared tunnel --url http://localhost:80 run smartdiagram
```

---

## 日常运维

### 更新部署

当有新代码推送到 GitHub 后：

```bash
cd /opt/SmartDiagram

# 拉取最新代码 + 重建部署
git pull origin main
./deploy.sh --rebuild
```

或者一步到位：

```bash
./deploy.sh --pull && ./deploy.sh --rebuild
```

### 常用命令速查

| 操作 | 命令 |
|------|------|
| 一键部署 | `./deploy.sh` |
| 查看日志 | `./deploy.sh --logs` |
| 查看状态 | `./deploy.sh --status` |
| 停止服务 | `./deploy.sh --down` |
| 强制重建 | `./deploy.sh --rebuild` |
| 仅查后端日志 | `docker compose logs -f backend` |
| 进入数据库 | `docker compose exec db psql -U postgres -d smartdiagram` |
| 重启单个服务 | `docker compose restart backend` |

### 数据备份

```bash
# 备份数据库
docker compose exec db pg_dump -U postgres smartdiagram > backup_$(date +%Y%m%d).sql

# 恢复数据库
cat backup_20260624.sql | docker compose exec -T db psql -U postgres -d smartdiagram
```

---

## 常见问题

### Q: 前端白屏 / 无法访问

```bash
# 检查前端容器是否正常运行
docker compose logs frontend

# 常见原因：
# 1. 端口 80 被占用 → 修改 docker-compose.yml 的端口映射
# 2. 构建失败 → docker compose build frontend --no-cache
```

### Q: 后端 API 返回 500

```bash
# 查看后端日志
docker compose logs -f backend

# 常见原因：
# 1. API Key 错误 → 检查 backend/.env
# 2. 数据库连接失败 → docker compose restart db && docker compose restart backend
```

### Q: Draw.io 编辑器加载失败

```bash
# 检查 Draw.io 容器
docker compose logs drawio

# 如果容器正常但网络不通，检查 Docker 网络
docker network ls
docker compose restart drawio
```

### Q: SSE 流式响应断开

```bash
# 可能是 Nginx 超时，检查 proxy_read_timeout 配置
# frontend/nginx.conf 中已设置 300s
# 如果用了宿主机 Nginx，也需要设置
```

### Q: 磁盘空间不足

```bash
# 清理未使用的 Docker 资源
docker system prune -a --volumes

# 查看磁盘使用
docker system df
```

---

## 架构拓扑

```
                              ┌─────────────────┐
                              │   用户浏览器      │
                              └────────┬────────┘
                                       │ :80
                              ┌────────▼────────┐
                              │  Nginx (前端容器) │
                              │  静态文件 + 反代   │
                              └──┬─────────┬────┘
                                 │         │
                        静态资源   │         │ /api/*
                                 │    ┌────▼───────┐
                                 │    │  FastAPI    │
                                 │    │  Backend    │
                                 │    │  :8000      │
                                 │    └──┬────┬────┘
                                 │       │    │
                           ┌─────▼──┐ ┌──▼──┐ │
                           │  PG DB │ │Redis│ │ LLM API
                           │ :5432  │ │:6379│ │ (外部)
                           └────────┘ └─────┘ │
                                        ┌─────▼──────┐
                                        │  Draw.io   │
                                        │  :9022     │
                                        └────────────┘
```

---

## 完整部署检查清单

- [ ] 服务器安装了 Docker 和 Docker Compose V2
- [ ] 服务器安装了 Git
- [ ] 已克隆仓库到服务器
- [ ] 已创建 `backend/.env` 并填入真实 API Key
- [ ] 已修改数据库密码（生产环境）
- [ ] 已修改 `AUTH_SESSION_SECRET`（生产环境）
- [ ] 已修改 `ALTCHA_HMAC_KEY`（生产环境）
- [ ] 已关闭 `AUTH_SHOW_DEMO_PRESETS=false`（生产环境）
- [ ] 运行 `./deploy.sh` 成功
- [ ] 所有容器处于 running 状态
- [ ] 浏览器可以正常访问
- [ ] AI 对话可以正常生成图表
- [ ] 注册/登录 CAPTCHA 验证正常（应在 1-2 秒内自动完成）
- [ ] 配置了域名和 HTTPS（可选）
- [ ] 配置了数据库定期备份（可选）
