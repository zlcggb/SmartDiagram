# Docker 容器化生产交付白皮书 · Containerization & Multi-Stage Build

> **标准定义**：SmartDiagram 视频学习助手（`/video`）生产容器化打包、Monorepo 统一网关（`:9237` ➔ `:4020`）与独立容器微核双模交付技术白皮书。  
> **生产基准 (v2.7.0 · 2026-10)**：支持 **SmartDiagram Monorepo 统一编排 (`./deploy.sh` + Gateway `:9237` + `api-video :4020` + `shared-jeff :8001` + PostgreSQL 16 `vidgrab`)** 与 **`apps/api-video/Dockerfile` 独立容器化交付 (Debian Slim + FFmpeg + 非 root `appuser:10001` + 30s 健康探针)** 双模高内聚生产体系。

---

## 一、 业务背景与双模容器化交付哲学 (Background & Dual-Mode Container Rationale)

在现代全栈工程落地过程中，微服务多容器编排虽然在超大规模集群中具备弹性，但对于音视频知识学习系统而言，必须兼顾**平台级多应用协同**与**轻量化独立私有部署**两种场景：
1. **音视频临时大文件跨容器 I/O 损耗**：前端上传的视频若保存在容器 A，转写服务在容器 B，必须通过跨容器网络复制几十至上百兆字节的媒体文件，产生严重网络等待；
2. **中小企业与私有化部署运维门槛过高**：复杂的多容器编排环境依赖多、启动链路长；
3. **系统 1 小模型 (`shared-jeff`) 内存复用诉求**：`gliformer-large-v1` 通过 Safetensors `mmap` 零拷贝加载仅需 `685 MiB` 内存，多业务模块共享同一侧车容器可节省数 GB 物理内存。

因此，SmartDiagram 视频学习助手在 **v2.7.0** 中确立了**“Monorepo 统一网关编排 + `apps/api-video` 独立微核容器”**双模交付架构：
- **模式 A（SmartDiagram 统一平台生产主推）**：前端融合于 `apps/web/src/features/video`（React 18 + Vite `:5173`，生产由统一网关 `gateway :9237` 分发），后端 `apps/api-video` 运行于 `:4020`（网关统一代理 `/video-api/api/*`），连接同实例隔离的 PostgreSQL 16 `vidgrab` 库（`VIDEO_DATABASE_URL`）与 `shared-jeff:8001` 意图路由侧车，通过仓库根目录 `./deploy.sh` 一键拉起全栈；
- **模式 B（`apps/api-video/Dockerfile` 独立微核交付）**：保留单容器聚合打包能力，在单个 Docker 容器内聚合前端静态产物、FastAPI 异步微核、FFmpeg 声学重采样引擎与持久化卷，支持零外部依赖秒级启动。

---

## 二、 多阶段构建与网络拓扑架构 (Multi-Stage Build & Topology)

系统通过两阶段构建将繁重的前端打包工具链（Node.js / npm）隔离在构建缓存中，仅将轻量静态文件拷入运行时镜像：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Docker 多阶段构建与单容器网络映射拓扑 (Multi-Stage Build &amp; Network Topology)</span>
    </div>
    <span class="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-950/60 dark:text-blue-400">容器拓扑 · 极简单容器交付</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 940 380" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <filter id="svg-card-shadow" x="-4%" y="-3%" width="108%" height="108%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.06"/>
        </filter>
        <marker id="arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <marker id="arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981"/>
        </marker>
      </defs>

      <!-- 阶段 1: 前端构建 (左) -->
      <g transform="translate(15, 30)" filter="url(#svg-card-shadow)">
        <rect width="260" height="320" rx="10" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <rect width="260" height="34" rx="10" fill="#0284c7" />
        <rect y="18" width="260" height="16" fill="#0284c7" />
        <text x="130" y="23" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="12">Stage 1: frontend-build (Node 20)</text>
        
        <g transform="translate(12, 46)" font-size="10.5">
          <g transform="translate(0, 0)">
            <rect width="236" height="48" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="18" fill="#0369a1" font-weight="bold">精简基础镜像</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">node:20-bookworm-slim</text>
          </g>

          <g transform="translate(0, 56)">
            <rect width="236" height="52" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="18" fill="#0369a1" font-weight="bold">npm ci 严格依赖锁</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">基于 package-lock.json 纯净还原</text>
            <text x="10" y="44" fill="#64748b" font-size="9">利用 Docker Layer 缓存加速拉取</text>
          </g>

          <g transform="translate(0, 116)">
            <rect width="236" height="52" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="18" fill="#0369a1" font-weight="bold">Vite 生产构建编译</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">npm run build ➔ 输出 dist/ 目录</text>
            <text x="10" y="44" fill="#15803d" font-size="9">打包 React 18 / XGPlayer / MindElixir</text>
          </g>

          <g transform="translate(0, 176)">
            <rect width="236" height="42" rx="6" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
            <text x="10" y="18" fill="#0f172a" font-weight="bold">向 Stage 2 交付静态资产 ➔</text>
            <text x="10" y="32" fill="#64748b" font-size="9">丢弃 800MB+ node_modules 垃圾</text>
          </g>
        </g>
      </g>

      <!-- 阶段 2: 最终生产镜像 (中) -->
      <g transform="translate(315, 30)" filter="url(#svg-card-shadow)">
        <rect width="320" height="320" rx="10" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <rect width="320" height="34" rx="10" fill="#8b5cf6" />
        <rect y="18" width="320" height="16" fill="#8b5cf6" />
        <text x="160" y="23" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="12">Stage 2: 生产运行容器 (Python 3.12)</text>
        
        <g transform="translate(14, 46)" font-size="10.5">
          <g transform="translate(0, 0)">
            <rect width="292" height="52" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#6d28d9" font-weight="bold">OS 系统层：Debian 镜像源 + FFmpeg</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">预装 FFmpeg 极速重采样与声学抽音依赖</text>
            <text x="10" y="44" fill="#64748b" font-size="9">清理 apt 缓存，保持镜像体积最小化</text>
          </g>

          <g transform="translate(0, 60)">
            <rect width="292" height="52" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#6d28d9" font-weight="bold">Python 运行时依赖安装</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">pip install -r requirements.txt</text>
            <text x="10" y="44" fill="#64748b" font-size="9">FastAPI / uvicorn / stripe / bcrypt / PyJWT</text>
          </g>

          <g transform="translate(0, 120)">
            <rect width="292" height="52" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#6d28d9" font-weight="bold">资产组合与非 root 安全加固</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">COPY --from=frontend-build dist /app/frontend/dist</text>
            <text x="10" y="44" fill="#dc2626" font-size="9" font-weight="bold">创建 appuser:10001 独立非特权用户</text>
          </g>

          <g transform="translate(0, 180)">
            <rect width="292" height="42" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#6d28d9" font-weight="bold">内置健康检查 HEALTHCHECK ➔</text>
            <text x="10" y="32" fill="#64748b" font-size="9">30s 周期探测 /api/health，异常自动自愈</text>
          </g>
        </g>
      </g>

      <!-- 阶段 3: 宿主机运行环境 (右) -->
      <g transform="translate(675, 30)" filter="url(#svg-card-shadow)">
        <rect width="250" height="320" rx="10" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <rect width="250" height="34" rx="10" fill="#10b981" />
        <rect y="18" width="250" height="16" fill="#10b981" />
        <text x="125" y="23" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="12">宿主机网络与数据持久化</text>
        
        <g transform="translate(12, 46)" font-size="10.5">
          <g transform="translate(0, 0)">
            <rect width="226" height="52" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="18" fill="#15803d" font-weight="bold">网关与端口映射 (:9237 ➔ :4020)</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">/video ➔ React 18 前端工作台</text>
            <text x="10" y="44" fill="#047857" font-size="9">/video-api/api/* ➔ FastAPI (:4020)</text>
          </g>

          <g transform="translate(0, 60)">
            <rect width="226" height="56" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="18" fill="#15803d" font-weight="bold">PostgreSQL 16 &amp; 物理卷持久化</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">PG 16 vidgrab 库 + downloads 卷</text>
            <text x="10" y="44" fill="#047857" font-size="9.5">持久化研报、测验与问答 JSONB 数据</text>
          </g>

          <g transform="translate(0, 124)">
            <rect width="226" height="50" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="18" fill="#15803d" font-weight="bold">Nginx 统一网关 (:9237 / 宝塔)</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">proxy_cache off; proxy_buffering off;</text>
            <text x="10" y="44" fill="#64748b" font-size="9">支持 HTTP 206 Range 与 SSE 流式</text>
          </g>

          <g transform="translate(0, 182)">
            <rect width="226" height="42" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="18" fill="#15803d" font-weight="bold">✓ 生产就绪</text>
            <text x="10" y="32" fill="#047857" font-size="9">单命令 docker compose up -d 交付</text>
          </g>
        </g>
      </g>

      <!-- 连接箭头 -->
      <path d="M 275 180 L 315 180" stroke="#0284c7" stroke-width="2" marker-end="url(#arrow-blue)" fill="none" />
      <path d="M 635 180 L 675 180" stroke="#10b981" stroke-width="2" marker-end="url(#arrow-emerald)" fill="none" />
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>flowchart LR
    S1["Stage 1: node:20 前端静态打包 (npm run build)"] -->|拷贝 dist 产物| S2["Stage 2: python:3.12 聚合镜像 (FFmpeg + FastAPI)"]
    S2 -->|8000 端口 + 卷挂载| S3["宿主机单容器交付 (http://127.0.0.1:8000 / 宝塔反代)"]</code></pre>
    </div>
  </details>
</div>

---

## 三、 容器生命周期、健康探针与优雅停机时序 (Lifecycle & Healthcheck)

生产容器运行时包含严格的生命周期管理，从冷启动建库到探针检测闭环运转：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">容器启动生命周期、健康探针与优雅停机时序 (Container Lifecycle Sequence)</span>
    </div>
    <span class="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full dark:bg-emerald-950/60 dark:text-emerald-400">生命周期 · 探针自愈</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 920 440" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <marker id="dk-arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <marker id="dk-arrow-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6"/>
        </marker>
        <marker id="dk-arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981"/>
        </marker>
      </defs>

      <!-- 泳道 -->
      <g transform="translate(40, 20)">
        <rect width="180" height="34" rx="6" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <text x="90" y="22" fill="#0369a1" font-weight="bold" font-size="11.5" text-anchor="middle">Docker Daemon / Host</text>
        <line x1="90" y1="34" x2="90" y2="410" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <g transform="translate(370, 20)">
        <rect width="180" height="34" rx="6" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <text x="90" y="22" fill="#6d28d9" font-weight="bold" font-size="11.5" text-anchor="middle">Entrypoint (Uvicorn Core)</text>
        <line x1="90" y1="34" x2="90" y2="410" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <g transform="translate(700, 20)">
        <rect width="180" height="34" rx="6" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <text x="90" y="22" fill="#047857" font-weight="bold" font-size="11.5" text-anchor="middle">SQLite Storage (WAL Volume)</text>
        <line x1="90" y1="34" x2="90" y2="410" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <!-- 步骤 1 -->
      <g transform="translate(0, 75)">
        <line x1="130" y1="0" x2="452" y2="0" stroke="#0284c7" stroke-width="1.6" marker-end="url(#dk-arrow-blue)" />
        <rect x="200" y="-18" width="180" height="24" rx="4" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
        <text x="290" y="-2" fill="#0369a1" font-size="10.5" font-weight="bold" text-anchor="middle">1. docker compose up -d 启动</text>
      </g>

      <!-- 步骤 2: 挂载卷并初始化数据库 -->
      <g transform="translate(0, 130)">
        <line x1="460" y1="0" x2="782" y2="0" stroke="#8b5cf6" stroke-width="1.6" marker-end="url(#dk-arrow-purple)" />
        <rect x="500" y="-18" width="240" height="24" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
        <text x="620" y="-2" fill="#6d28d9" font-size="10.5" font-weight="bold" text-anchor="middle">2. PRAGMA journal_mode = WAL 初始化</text>
      </g>

      <!-- 步骤 3: 启动静态文件服务与路由 -->
      <g transform="translate(460, 185)">
        <rect width="210" height="34" rx="5" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
        <text x="105" y="15" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">3. 挂载 /app/frontend/dist 静态路由</text>
        <text x="105" y="27" fill="#64748b" font-size="8.5" text-anchor="middle">工作在 appuser (10001) 最小权限下</text>
      </g>

      <!-- 步骤 4: 容器健康检查探测 -->
      <g transform="translate(0, 255)">
        <line x1="130" y1="0" x2="452" y2="0" stroke="#10b981" stroke-width="1.6" marker-end="url(#dk-arrow-emerald)" />
        <rect x="200" y="-18" width="180" height="24" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
        <text x="290" y="-2" fill="#047857" font-size="10.5" font-weight="bold" text-anchor="middle">4. HEALTHCHECK GET /api/health</text>
      </g>

      <!-- 步骤 5: 响应健康状态 -->
      <g transform="translate(0, 315)">
        <line x1="460" y1="0" x2="138" y2="0" stroke="#10b981" stroke-width="1.6" stroke-dasharray="4,3" marker-end="url(#dk-arrow-emerald)" />
        <rect x="210" y="-18" width="170" height="24" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
        <text x="295" y="-2" fill="#047857" font-size="10.5" font-weight="bold" text-anchor="middle">5. 状态标为 (healthy)</text>
      </g>

      <!-- 步骤 6: 优雅停机 SIGTERM -->
      <g transform="translate(0, 375)">
        <line x1="130" y1="0" x2="452" y2="0" stroke="#64748b" stroke-width="1.6" stroke-dasharray="4,3" marker-end="url(#dk-arrow-blue)" />
        <rect x="180" y="-18" width="220" height="24" rx="4" fill="#ffffff" stroke="#cbd5e1" stroke-width="1" />
        <text x="290" y="-2" fill="#334155" font-size="10.5" font-weight="bold" text-anchor="middle">6. 捕获 SIGTERM 刷盘关闭连接</text>
      </g>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>sequenceDiagram
    autonumber
    participant Host as Docker Daemon / Host
    participant Uvi as Entrypoint (Uvicorn Core)
    participant DB as SQLite Storage (WAL Volume)

    Host->>Uvi: 1. docker compose up 启动容器
    Uvi->>DB: 2. 初始化 SQLite 存储并开启 WAL 预写日志
    Note over Uvi: 3. 挂载前端 dist 静态路由，降权为 appuser 运行
    Host->>Uvi: 4. HEALTHCHECK 定期探测 /api/health
    Uvi-->>Host: 5. 返回 200 OK，标记为 (healthy)
    Host->>Uvi: 6. 容器停止时派发 SIGTERM，优雅刷盘退出</code></pre>
    </div>
  </details>
</div>

---

## 四、 核心 Dockerfile 与环境配置契约 (Dockerfile & Environment Contract)

### 1. 生产级多阶段分层 Dockerfile

```dockerfile
# Stage 1: 前端静态资产编译
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: 生产单体运行容器
FROM python:3.12-slim-bookworm AS app
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_DB_PATH=/app/data/app.db

WORKDIR /app/backend

# 换国内镜像源并预装 FFmpeg
RUN sed -i 's|http://deb.debian.org/debian|https://mirrors.tuna.tsinghua.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install --no-install-recommends -y ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY backend/ ./
COPY scripts/backup_sqlite.py /app/scripts/backup_sqlite.py
COPY --from=frontend-build /build/frontend/dist /app/frontend/dist

# 最小权限原则：以非 root 用户 appuser 运行
RUN useradd --system --uid 10001 --create-home appuser \
    && mkdir -p /app/data /app/backend/downloads /app/scripts \
    && chown -R appuser:appuser /app

USER appuser
EXPOSE 8000

# 生产级健康探针
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 2. 容器与 Monorepo 环境变量规范（根 `.env` / `.env.docker`）

在 SmartDiagram v2.7.0 统一平台中，所有服务共用仓库根目录 `.env`（独立容器部署可使用 `.env.docker`）：

```ini
# 1. SmartDiagram Monorepo 端口与网关契约
VIDEO_API_PORT=4020
VITE_VIDEO_API_URL=/video-api

# 2. PostgreSQL 16 独立业务库 (与 smartdiagram / ppt_agent 同实例隔离)
VIDEO_DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/vidgrab

# 3. 系统 1 意图路由侧车 (shared-jeff Safetensors mmap 685MiB)
JEFF_ROUTER_ENABLED=true
JEFF_SERVICE_URL=http://shared-jeff:8001

# 4. 四点并发极速总结与配额体系
ASR_MAX_WORKERS=6
GUEST_DAILY_SUMMARY_LIMIT=30
GUEST_DAILY_ASK_LIMIT=100

# 5. 商业化与安全鉴权密钥
AUTH_JWT_SECRET=super_secret_jwt_random_key_vidgrab_2026
STRIPE_SECRET_KEY=sk_live_51Pxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_MONTHLY=price_1xxxxxx
STRIPE_PRICE_YEARLY=price_1xxxxxx
CORS_ORIGINS=["*"]
```

---

## 五、 边界防御、容器安全与存储持久化 (Container Security & Persistence)

### 1. 运行态权限最小化 (Non-Root Execution)
容器内严格创建 UID 为 `10001` 的专有系统用户 `appuser`，并通过 `USER appuser` 剥离全部 Root 权限。即使代码或第三方依赖存在远程代码执行（RCE）漏洞，攻击者也无法破坏容器文件系统或逃逸至宿主机。

### 2. 宿主机数据卷物理隔离
在 `docker-compose.yml` 中：
```yaml
services:
  vidgrab:
    volumes:
      - ./data:/app/data
      - ./downloads:/app/backend/downloads
```
- `./data` 独立挂载，保障容器在经历 `docker compose down` 与重建时，用户账号与支付数据绝对不会丢失；
- `./downloads` 挂载临时下载池，配合系统定时清理协程，彻底杜绝宿主机磁盘占满风险。

---

## 六、 运维基准、命令速查与验收清单 (Ops Commands & Checklist)

### 1. 核心容器与 Monorepo 运维指令速查表

```bash
# 【模式 A：SmartDiagram Monorepo 统一开发与生产部署】
# 1. 本地全栈一键热重载启动 (Web :5173 + api-video :4020 + 统一后端)
./dev.sh
# 或使用 npm workspace 启动
npm run dev

# 2. 生产环境全栈一键构建与网关 (:9237) 部署
./deploy.sh

# 【模式 B：apps/api-video 独立 Docker 容器运维】
# 3. 首次独立容器部署与后台启动
cp .env.docker.example .env.docker
docker compose up --build -d

# 4. 检查容器健康探针状态 (api-video & shared-jeff)
docker compose ps
# 输出中的 STATUS 应显示为 "Up X minutes (healthy)"

# 5. 实时跟踪服务运行日志
docker compose logs -f vidgrab

# 6. PostgreSQL 16 vidgrab 库逻辑备份 / SQLite 热备
pg_dump -Fc -d vidgrab > vidgrab_backup_$(date +%F).dump
# 若使用独立容器 SQLite 模式：
docker compose exec vidgrab python /app/scripts/backup_sqlite.py

# 7. 进入容器内部调试诊断
docker compose exec vidgrab /bin/bash
```

### 2. 生产交付验收指标清单

| 检查项 | 质量标准 | 实测状态 |
| :--- | :--- | :---: |
| **最终镜像体积** | 剥离 Node 环境后体积 $\le 450\text{MB}$ | ✅ 符合标准 |
| **启动就绪时延** | 容器从启动至通过首个健康检查 $\le 5\text{s}$ | ✅ 符合标准 |
| **持久化数据安全** | 执行 `docker compose down && docker compose up -d` 数据不丢 | ✅ 验证通过 |
| **非特权用户执行** | `id` 输出为 `uid=10001(appuser)` | ✅ 验证通过 |
| **无锁在线热备** | `docker compose exec ... backup_sqlite.py` 成功生成备份快照 | ✅ 验证通过 |
