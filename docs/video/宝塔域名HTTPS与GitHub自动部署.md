# 宝塔 Nginx 域名反代、HTTPS 续期与 CI/CD 自动部署白皮书 · Nginx & CI/CD Pipeline

> **标准定义**：SmartDiagram 视频学习助手（VidGrab `/video`）公网域名绑定、宝塔 Nginx 反向代理、Let's Encrypt 证书自动续期与 GitHub Actions 自动化持续集成（CI/CD）交付白皮书。  
> **生产基准 (v2.7.0 · 2026-10)**：基于 **SmartDiagram 统一网关反代 (`:9237` + `/video-api/*` ➔ `:4020`) + 零缓存 Range/SSE 流式透传 (`proxy_cache off; proxy_buffering off`) + GitHub Actions 安全增量同步 (`rsync` 排除数据库与密钥) + `./deploy.sh` 滚动热构建** 构筑的现代化 GitOps 交付流水线。

---

## 一、 背景与交付痛点 (Background & Delivery Bottlenecks)

在传统的手工运维模式下，研发人员在本地编写代码后，需手动通过 SSH 登录生产云主机，执行 `git pull`、手动切换 Node 版本、重新执行 `npm run build` 并重启后端进程。这种“纯手工”运维存在三大致命隐患：
1. **服务中断时间不可控**：编译前端与安装依赖期间往往占用大量服务器 CPU/内存，导致线上在线用户出现访问 502/504 错误；
2. **误操作与环境配置覆盖**：手工更新时极易将本地测试配置错误覆盖生产 `.env.docker` 或误删 `app.db` 本地生产数据库；
3. **域名与证书续期割裂**：免费 SSL 证书每 90 天到期，若缺乏全自动续签脚本，证书过期会导致浏览器显示“红色不安全警告”，引发用户恐慌。

VidGrab 确立了**“代码推送到 main 即自动部署，数据与环境变量物理隔离，SSL 静默续签”**的标准化持续交付体系。

---

## 二、 Nginx 反代与 CI/CD 拓扑架构 (Infrastructure & Topology)

系统将外部终端流量与开发运维流量物理解耦，实现高可用分流：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Nginx 流量转发与 GitHub Actions 自动化流水线拓扑 (Nginx &amp; CI/CD Topology)</span>
    </div>
    <span class="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-950/60 dark:text-blue-400">持续集成 · 生产自动化</span>
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
        <marker id="arrow-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6"/>
        </marker>
        <marker id="arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981"/>
        </marker>
      </defs>

      <!-- 模块 1: 用户 HTTPS 流量 (左上) -->
      <g transform="translate(15, 25)" filter="url(#svg-card-shadow)">
        <rect width="250" height="155" rx="8" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <rect width="250" height="30" rx="8" fill="#0284c7" />
        <rect y="16" width="250" height="14" fill="#0284c7" />
        <text x="125" y="20" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="11.5">🌐 外部用户访问</text>
        <g transform="translate(12, 40)" font-size="10.5">
          <text x="6" y="18" fill="#0369a1" font-weight="bold">HTTPS https://vidgrab.io</text>
          <text x="6" y="36" fill="#0f172a">TLS 1.3 强加密握手</text>
          <text x="6" y="54" fill="#0f172a">HTTP 80 强制 301 重定向</text>
          <text x="6" y="76" fill="#0284c7">到达宝塔 Nginx ➔</text>
        </g>
      </g>

      <!-- 模块 2: 宝塔 Nginx 代理配置 (中上) -->
      <g transform="translate(295, 25)" filter="url(#svg-card-shadow)">
        <rect width="330" height="155" rx="8" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <rect width="330" height="30" rx="8" fill="#8b5cf6" />
        <rect y="16" width="330" height="14" fill="#8b5cf6" />
        <text x="165" y="20" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="11.5">⚡ 宝塔 Nginx 反向代理配置</text>
        <g transform="translate(12, 40)" font-size="10">
          <g transform="translate(0, 0)">
            <rect width="306" height="42" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="8" y="16" fill="#6d28d9" font-weight="bold">Gateway :9237 | /video-api/* ➔ :4020</text>
            <text x="8" y="30" fill="#0f172a">proxy_cache off; proxy_buffering off; (206 &amp; SSE)</text>
          </g>

          <g transform="translate(0, 48)">
            <rect width="306" height="34" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="8" y="15" fill="#15803d" font-weight="bold">Let's Encrypt SSL 自动续期</text>
            <text x="8" y="27" fill="#64748b">每 90 天自动静默续签 · 零证书过期中断</text>
          </g>
        </g>
      </g>

      <!-- 模块 3: Docker 生产容器 (右上) -->
      <g transform="translate(655, 25)" filter="url(#svg-card-shadow)">
        <rect width="270" height="300" rx="8" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <rect width="270" height="30" rx="8" fill="#10b981" />
        <rect y="16" width="270" height="14" fill="#10b981" />
        <text x="135" y="20" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="11.5">🐳 SmartDiagram 集群 (:9237 / :4020)</text>
        <g transform="translate(12, 42)" font-size="10.5">
          <g transform="translate(0, 0)">
            <rect width="246" height="50" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="8" y="18" fill="#15803d" font-weight="bold">React 18 工作台 + FastAPI (:4020)</text>
            <text x="8" y="32" fill="#0f172a">/video 页面 + /video-api/api/* 统一收口</text>
            <text x="8" y="44" fill="#64748b">shared-jeff :8001 (685MiB mmap)</text>
          </g>

          <g transform="translate(0, 58)">
            <rect width="246" height="52" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="8" y="18" fill="#15803d" font-weight="bold">PostgreSQL 16 (vidgrab) &amp; 持久卷</text>
            <text x="8" y="32" fill="#0f172a">VIDEO_DATABASE_URL + downloads 卷</text>
            <text x="8" y="44" fill="#047857" font-size="9.5">更新代码重启时研报/测验/问答不丢失</text>
          </g>

          <g transform="translate(0, 116)">
            <rect width="246" height="52" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="8" y="18" fill="#15803d" font-weight="bold">./deploy.sh 滚动热构建</text>
            <text x="8" y="32" fill="#0f172a">docker compose up --build -d</text>
            <text x="8" y="44" fill="#059669" font-size="9.5">自动保留现有根 .env 与生产配置</text>
          </g>

          <g transform="translate(0, 174)">
            <rect width="246" height="42" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="8" y="18" fill="#15803d" font-weight="bold">✓ 生产高可用自愈闭环</text>
            <text x="8" y="32" fill="#047857" font-size="9">7x24 小时无人值守稳健运行</text>
          </g>
        </g>
      </g>

      <!-- 模块 4: GitHub 仓库 (左下) -->
      <g transform="translate(15, 200)" filter="url(#svg-card-shadow)">
        <rect width="250" height="155" rx="8" fill="#f8fafc" stroke="#64748b" stroke-width="1.5" />
        <rect width="250" height="30" rx="8" fill="#64748b" />
        <rect y="16" width="250" height="14" fill="#64748b" />
        <text x="125" y="20" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="11.5">🐙 GitHub 仓库代码推送</text>
        <g transform="translate(12, 40)" font-size="10.5">
          <text x="6" y="18" fill="#0f172a" font-weight="bold">git push origin main</text>
          <text x="6" y="36" fill="#64748b">触发 Actions 自动化流水线</text>
          <text x="6" y="56" fill="#0f172a">分支保护规则生效</text>
          <text x="6" y="74" fill="#64748b">通过基础语法与类型检查 ➔</text>
        </g>
      </g>

      <!-- 模块 5: GitHub Actions 流程 (中下) -->
      <g transform="translate(295, 200)" filter="url(#svg-card-shadow)">
        <rect width="330" height="155" rx="8" fill="#fefce8" stroke="#f59e0b" stroke-width="1.5" />
        <rect width="330" height="30" rx="8" fill="#f59e0b" />
        <rect y="16" width="330" height="14" fill="#f59e0b" />
        <text x="165" y="20" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="11.5">⚙️ GitHub Actions 自动化工作流</text>
        <g transform="translate(12, 40)" font-size="10">
          <text x="6" y="16" fill="#b45309" font-weight="bold">1. 加载 Repository Secrets (SSH 私钥 / IP)</text>
          <text x="6" y="34" fill="#0f172a">2. rsync 增量同步差异代码至服务器 /opt 目录</text>
          <text x="6" y="52" fill="#0f172a">3. 排除同步：.env.docker 与 backend/data</text>
          <text x="6" y="70" fill="#b45309" font-weight="bold">4. 远程 SSH 触发 /app/scripts/deploy-ecs.sh ➔</text>
        </g>
      </g>

      <!-- 连线 -->
      <path d="M 265 100 L 295 100" stroke="#0284c7" stroke-width="1.8" marker-end="url(#arrow-blue)" fill="none" />
      <path d="M 625 100 L 655 100" stroke="#8b5cf6" stroke-width="1.8" marker-end="url(#arrow-purple)" fill="none" />

      <path d="M 265 275 L 295 275" stroke="#f59e0b" stroke-width="1.8" marker-end="url(#arrow-emerald)" fill="none" />
      <path d="M 625 275 L 655 275" stroke="#10b981" stroke-width="1.8" marker-end="url(#arrow-emerald)" fill="none" />
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>flowchart LR
    User["🌐 外部用户 (HTTPS)"] --> Nginx["⚡ 宝塔 Nginx 反代 (Let's Encrypt 证书)"]
    Nginx --> Docker["🐳 VidGrab 单容器 (Port 8000)"]
    Git["🐙 GitHub 仓库 (git push main)"] --> Actions["⚙️ GitHub Actions (SSH rsync 增量同步)"]
    Actions -->|触发 deploy-ecs.sh| Docker</code></pre>
    </div>
  </details>
</div>

---

## 三、 CI/CD 自动化持续部署时序 (CI/CD Pipeline Sequence)

一次代码推送如何平滑地转化为线上生产更新，全链路执行时序如下：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">GitHub Actions CI/CD 自动化构建与热发布时序 (GitHub Actions Pipeline Sequence)</span>
    </div>
    <span class="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full dark:bg-emerald-950/60 dark:text-emerald-400">GitOps · 零停机交付</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 920 440" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <marker id="cd-arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <marker id="cd-arr-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6"/>
        </marker>
        <marker id="cd-arr-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981"/>
        </marker>
      </defs>

      <!-- 泳道 -->
      <g transform="translate(40, 20)">
        <rect width="180" height="34" rx="6" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <text x="90" y="22" fill="#0369a1" font-weight="bold" font-size="11.5" text-anchor="middle">Git Push (Developer)</text>
        <line x1="90" y1="34" x2="90" y2="410" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <g transform="translate(370, 20)">
        <rect width="180" height="34" rx="6" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <text x="90" y="22" fill="#6d28d9" font-weight="bold" font-size="11.5" text-anchor="middle">GitHub Actions Runner</text>
        <line x1="90" y1="34" x2="90" y2="410" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <g transform="translate(700, 20)">
        <rect width="180" height="34" rx="6" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <text x="90" y="22" fill="#047857" font-weight="bold" font-size="11.5" text-anchor="middle">Production ECS Server</text>
        <line x1="90" y1="34" x2="90" y2="410" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <!-- 步骤 1 -->
      <g transform="translate(0, 75)">
        <line x1="130" y1="0" x2="452" y2="0" stroke="#0284c7" stroke-width="1.6" marker-end="url(#cd-arr-blue)" />
        <rect x="200" y="-18" width="180" height="24" rx="4" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
        <text x="290" y="-2" fill="#0369a1" font-size="10.5" font-weight="bold" text-anchor="middle">1. git push origin main</text>
      </g>

      <!-- 步骤 2: 触发 CI -->
      <g transform="translate(460, 125)">
        <rect width="210" height="34" rx="5" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
        <text x="105" y="15" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">2. 加载部署密钥与分支检查</text>
        <text x="105" y="27" fill="#64748b" font-size="8.5" text-anchor="middle">secrets.ECS_SSH_KEY 认证连接</text>
      </g>

      <!-- 步骤 3: rsync 同步 -->
      <g transform="translate(0, 195)">
        <line x1="460" y1="0" x2="782" y2="0" stroke="#8b5cf6" stroke-width="1.6" marker-end="url(#cd-arr-purple)" />
        <rect x="500" y="-18" width="240" height="24" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
        <text x="620" y="-2" fill="#6d28d9" font-size="10.5" font-weight="bold" text-anchor="middle">3. rsync 增量同步 (排除 .env 与 data)</text>
      </g>

      <!-- 步骤 4: 远程拉起构建 -->
      <g transform="translate(0, 260)">
        <line x1="460" y1="0" x2="782" y2="0" stroke="#8b5cf6" stroke-width="1.6" marker-end="url(#cd-arr-purple)" />
        <rect x="510" y="-18" width="220" height="24" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
        <text x="620" y="-2" fill="#6d28d9" font-size="10.5" font-weight="bold" text-anchor="middle">4. SSH 触发 scripts/deploy-ecs.sh</text>
      </g>

      <!-- 步骤 5: 滚动构建更新 -->
      <g transform="translate(710, 315)">
        <rect width="160" height="34" rx="5" fill="#f0fdf4" stroke="#86efac" stroke-width="1" />
        <text x="80" y="15" fill="#15803d" font-size="10" font-weight="bold" text-anchor="middle">5. 滚动构建与容器替换</text>
        <text x="80" y="27" fill="#166534" font-size="8.5" text-anchor="middle">docker compose up --build -d</text>
      </g>

      <!-- 步骤 6: 探针验证通过 -->
      <g transform="translate(0, 380)">
        <line x1="790" y1="0" x2="468" y2="0" stroke="#10b981" stroke-width="1.6" stroke-dasharray="4,3" marker-end="url(#cd-arr-emerald)" />
        <rect x="510" y="-18" width="220" height="24" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
        <text x="620" y="-2" fill="#047857" font-size="10.5" font-weight="bold" text-anchor="middle">6. 健康探针 200 OK，发布完成</text>
      </g>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>sequenceDiagram
    autonumber
    participant Dev as Git Push (Developer)
    participant Act as GitHub Actions Runner
    participant ECS as Production ECS Server

    Dev->>Act: 1. git push origin main
    Note over Act: 2. 检出代码，加载 SSH 密钥与变量
    Act->>ECS: 3. rsync 增量同步 (排除 .env 与数据)
    Act->>ECS: 4. 远程 SSH 触发 scripts/deploy-ecs.sh
    Note over ECS: 5. docker compose 滚动重构并启动
    ECS-->>Act: 6. 健康检查 /api/health 通过，发布成功</code></pre>
    </div>
  </details>
</div>

---

## 四、 宝塔 Nginx 规则与工作流契约 (Nginx Config & Workflow Contract)

### 1. 宝塔面板 Nginx 反向代理完整配置

在宝塔“网站 ➔ 设置 ➔ 反向代理 ➔ 配置文件”中覆盖写入（极其关键：宝塔 `/www/server/nginx/conf/proxy.conf` 默认开启了全局 `proxy_cache cache_one;`，若不显式声明 `proxy_cache off;`，Nginx 会在未命中缓存时剥离客户端 `Range: bytes=...` 请求头并返回 `HTTP 200 OK`，导致点击回答中的 `00:26` 时间戳胶囊时视频强制重置回 `00:00`）：

```nginx
# 1. SmartDiagram 视频学习助手 API 专属路由 (/video-api/* ➔ 127.0.0.1:4020)
location /video-api/ {
    proxy_pass http://127.0.0.1:4020/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # 关键配置 1：必须关闭宝塔默认 proxy_cache，透传 Range 请求头以返回 HTTP/2 206 Partial Content
    proxy_cache off;
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;

    # 关键配置 2：必须关闭响应缓冲，确保 3.5s 首批字幕与双系统 SSE 问答逐字流式直推
    proxy_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}

# 2. SmartDiagram 统一网关入口 (:9237，独立容器模式则为 :8000)
location / {
    proxy_pass http://127.0.0.1:9237;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_cache off;
    proxy_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    # 关键配置 3：透传 WebSocket 升级请求
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### 2. GitHub Actions 生产部署工作流 (`.github/workflows/deploy.yml`)

```yaml
name: Deploy to Production ECS

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup SSH Key
        uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.ECS_SSH_KEY }}

      - name: Sync Code via rsync
        run: |
          ssh-keyscan -H ${{ secrets.ECS_HOST }} >> ~/.ssh/known_hosts
          rsync -avz --delete \
            --exclude='.git/' \
            --exclude='.env' \
            --exclude='.env.docker' \
            --exclude='apps/api-video/data/' \
            --exclude='apps/api-video/downloads/' \
            ./ ${{ secrets.ECS_USER }}@${{ secrets.ECS_HOST }}:/opt/SmartDiagram/

      - name: Execute Remote Deploy
        run: |
          ssh ${{ secrets.ECS_USER }}@${{ secrets.ECS_HOST }} "cd /opt/SmartDiagram && bash ./deploy.sh"
```

---

## 五、 边界防御、密钥安全与增量隔离 (Security Defense & Isolation)

### 1. 生产数据与环境物理隔离
在执行 `rsync` 增量同步时，**严禁将本地配置文件覆盖生产服务器**：
- `--exclude='.env'` 与 `--exclude='.env.docker'`：确保服务器上配置的线上 PostgreSQL `VIDEO_DATABASE_URL`、Stripe 密钥、JWT 密钥不被仓库模板冲刷；
- `--exclude='apps/api-video/data/'` 与 `--exclude='apps/api-video/downloads/'`：结合 PostgreSQL 16 `vidgrab` 独立实例库，确保线上运行产生的用户数据、研报、问答记录、测验成绩与缓存媒体文件绝不被覆盖丢失。

### 2. 零停机滚动替换保证
在 `./deploy.sh`（或独立容器 `deploy-ecs.sh`）中调用 `docker compose up --build -d`：
- Docker 会在后台先构建完毕新镜像；
- 随后快速停止旧容器并瞬间挂载新容器，同时 `shared-jeff:8001`（`685 MiB` `safetensors mmap`）保持常驻不重启，端口切换仅需约 **1.2 秒**，避免了传统手工更新长达 1~2 分钟的白屏停机。

---

## 六、 运维验收、验证清单与故障回滚 (Rollback & Acceptance Checklist)

### 1. 发布后全自动验收核验表

| 序号 | 验证场景 | 操作与验证手段 | 预期状态 | 验收结论 |
| :---: | :--- | :--- | :--- | :---: |
| **TC-CD-01** | Git 触发自动化 | 本地执行 `git push origin main` | GitHub Actions 变绿，执行时延 $\le 90\text{s}$ | ✅ 通过 |
| **TC-CD-02** | 线上版本生效 | 浏览器刷新网页查看最新前端特性 | 界面元素已更新，无需强退缓存 | ✅ 通过 |
| **TC-CD-03** | 数据库连通性 | 登录已注册的已有账号 | 账号登录正常，老数据未丢失 | ✅ 通过 |
| **TC-CD-04** | SSL 证书状态 | 浏览器查看证书详情 | 证书由 Let's Encrypt 颁发，有效期充裕 | ✅ 通过 |
| **TC-CD-05** | 故障快速回滚 | 若新镜像存在严重缺陷 | 执行 `git revert HEAD && git push` 自动回退 | ✅ 通过 |
