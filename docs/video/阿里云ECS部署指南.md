# 阿里云 ECS 生产环境部署与运维白皮书 · Production Deployment

> **标准定义**：SmartDiagram 视频学习助手（VidGrab `/video`）在 Alibaba Cloud Linux 3 / CentOS / Ubuntu 云主机上的生产落地、纵深防御与高可用运维工程白皮书。  
> **生产基准 (v2.7.0 · 2026-10)**：基于 **阿里云安全组白名单限制 + 宿主机 Nginx / 统一网关 (`:9237`) SSL 卸载与零缓存流式透传 (`proxy_cache off; proxy_buffering off`) + `apps/api-video :4020` + `shared-jeff :8001` (`685 MiB` `safetensors mmap`) + PostgreSQL 16 `vidgrab` 库** 构筑的工业级高可用体系。

---

## 一、 背景与云上基础设施选型 (Background & Cloud Rationale)

SmartDiagram 视频学习助手全栈系统集成了网络爬虫分片抓取、FFmpeg 声学重采样、系统 1 (`Jeff`) 快思考意图路由、大模型双线程并行推理（研报 + 双语翻译 `35.4s`）以及实时 SSE 流式推送。在云端基础设施选型上，系统团队针对资源消耗特征进行了深度推演：
- **CPU 密集型任务**：FFmpeg 音频重采样（16kHz Mono）、6 线程并发切片（`ASR_MAX_WORKERS=6`）与本地 Whisper 兜底极其依赖 CPU 的 AVX2/FMA 指令集扩展；
- **I/O 与内存特征**：
  - `api-video (:4020)` 常驻内存约 `350MB~650MB`；
  - 系统 1 意图路由侧车 `shared-jeff (:8001)` 采用 `safetensors mmap` 零拷贝加载 `gliformer-large-v1`，峰值内存从 `4.81 GB` 压降至 **`685 MiB`**（支持多项目共享）；
  - PostgreSQL 16 `vidgrab` 库（与 `smartdiagram`、`ppt_agent` 同实例逻辑隔离）负责持久化研报、多轮问答历史与测验成绩 JSONB 数据。
- **推荐硬件选型**：阿里云 ECS 通用型/计算型实例（如 `ecs.c7.large` 2核 4G 或 `ecs.g7.large` 2核 8G），预装 **Alibaba Cloud Linux 3** 或 **Ubuntu 22.04 LTS**，兼顾极致性价比与长久稳定性。

---

## 二、 生产云主机网络拓扑与架构 (Production Architecture & Topology)

系统在云端采用标准的“安全组入口过滤 ➔ 宿主机反向代理 ➔ Docker 单容器微核 ➔ 本地物理卷持久化”的纵深防御拓扑：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">阿里云 ECS 生产网络拓扑与守护进程架构 (ECS Production Architecture)</span>
    </div>
    <span class="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-950/60 dark:text-blue-400">生产拓扑 · 纵深防御</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 940 350" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
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
        <marker id="arrow-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6"/>
        </marker>
      </defs>

      <!-- 1. 公网访问入口 (左) -->
      <g transform="translate(15, 25)" filter="url(#svg-card-shadow)">
        <rect width="265" height="300" rx="10" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <rect width="265" height="34" rx="10" fill="#0284c7" />
        <rect y="18" width="265" height="16" fill="#0284c7" />
        <text x="132" y="23" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="12">1. 公网流量与安全组 (Firewall)</text>
        
        <g transform="translate(12, 46)" font-size="10.5">
          <g transform="translate(0, 0)">
            <rect width="241" height="52" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="18" fill="#0369a1" font-weight="bold">对外开放必要端口：</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">Port 443 (HTTPS 加密流量)</text>
            <text x="10" y="44" fill="#0f172a" font-size="9.5">Port 80 (HTTP 301 重定向 443)</text>
          </g>

          <g transform="translate(0, 58)">
            <rect width="241" height="52" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="18" fill="#0369a1" font-weight="bold">运维受控端口：</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">Port 22 (SSH 密钥登录，限特定IP)</text>
            <text x="10" y="44" fill="#64748b" font-size="9">禁用密码登录，仅限 ed25519 密钥</text>
          </g>

          <g transform="translate(0, 116)">
            <rect width="241" height="52" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="18" fill="#dc2626" font-weight="bold">严格封锁内网服务：</text>
            <text x="10" y="32" fill="#b91c1c" font-size="9.5">严禁向公网暴露 8000 业务端口</text>
            <text x="10" y="44" fill="#64748b" font-size="9">仅允许宿主机本地回环 127.0.0.1 通信</text>
          </g>

          <g transform="translate(0, 174)">
            <rect width="241" height="48" rx="6" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
            <text x="10" y="19" fill="#0f172a" font-weight="bold">转交反向代理 ➔</text>
            <text x="10" y="35" fill="#64748b" font-size="9.5">进入宿主机 Nginx 接入层</text>
          </g>
        </g>
      </g>

      <!-- 2. 宿主机 Nginx 与 systemd (中) -->
      <g transform="translate(315, 25)" filter="url(#svg-card-shadow)">
        <rect width="325" height="300" rx="10" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <rect width="325" height="34" rx="10" fill="#8b5cf6" />
        <rect y="18" width="325" height="16" fill="#8b5cf6" />
        <text x="162" y="23" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="12">2. 宿主机接入层 (Nginx + SSL)</text>
        
        <g transform="translate(14, 46)" font-size="10.5">
          <g transform="translate(0, 0)">
            <rect width="297" height="52" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#6d28d9" font-weight="bold">SSL 证书与 TLS 1.3 卸载</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">Let's Encrypt / 阿里云免费 SSL 证书</text>
            <text x="10" y="44" fill="#7c3aed" font-size="9">配置 HSTS 与 HTTP/2 极速复用</text>
          </g>

          <g transform="translate(0, 58)">
            <rect width="297" height="52" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#6d28d9" font-weight="bold">零缓存 Range 与流式透传 (No Cache/Buffer)</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">proxy_cache off; proxy_buffering off;</text>
            <text x="10" y="44" fill="#047857" font-size="9">保障 HTTP 206 视频秒级跳转与 SSE 流式直推</text>
          </g>

          <g transform="translate(0, 116)">
            <rect width="297" height="52" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#6d28d9" font-weight="bold">守护进程自愈 (systemd / deploy.sh)</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">systemctl enable docker &amp;&amp; ./deploy.sh</text>
            <text x="10" y="44" fill="#64748b" font-size="9">云主机发生意外重启时自动拉起容器集群</text>
          </g>

          <g transform="translate(0, 174)">
            <rect width="297" height="48" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="19" fill="#6d28d9" font-weight="bold">统一网关分发 ➔</text>
            <text x="10" y="35" fill="#64748b" font-size="9.5">Gateway :9237 ➔ /video-api/* (:4020)</text>
          </g>
        </g>
      </g>

      <!-- 3. Docker 容器与物理卷 (右) -->
      <g transform="translate(670, 25)" filter="url(#svg-card-shadow)">
        <rect width="255" height="300" rx="10" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <rect width="255" height="34" rx="10" fill="#10b981" />
        <rect y="18" width="255" height="16" fill="#10b981" />
        <text x="127" y="23" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="12">3. VidGrab Docker 生产容器</text>
        
        <g transform="translate(12, 46)" font-size="10.5">
          <g transform="translate(0, 0)">
            <rect width="231" height="52" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="18" fill="#15803d" font-weight="bold">api-video (:4020) + shared-jeff</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">6 线程 ASR + 研报/翻译并行 (35.4s)</text>
            <text x="10" y="44" fill="#047857" font-size="9">Jeff mmap 685MiB + 0.78 高置信门控</text>
          </g>

          <g transform="translate(0, 58)">
            <rect width="231" height="52" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="18" fill="#15803d" font-weight="bold">PostgreSQL 16 (vidgrab 库)</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">与 smartdiagram 同实例多库隔离</text>
            <text x="10" y="44" fill="#047857" font-size="9">JSONB 持久化研报、问答与测验成绩</text>
          </g>

          <g transform="translate(0, 116)">
            <rect width="231" height="52" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="18" fill="#15803d" font-weight="bold">定时热备份 (Crontab)</text>
            <text x="10" y="32" fill="#0f172a" font-size="9.5">每日凌晨 03:00 执行热备</text>
            <text x="10" y="44" fill="#64748b" font-size="9">无锁快照并同步至异地存储</text>
          </g>

          <g transform="translate(0, 174)">
            <rect width="231" height="48" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="19" fill="#15803d" font-weight="bold">✓ 生产高可用自愈闭环</text>
            <text x="10" y="35" fill="#047857" font-size="9.5">7x24 小时无人值守稳健运行</text>
          </g>
        </g>
      </g>

      <!-- 连线与传输协议药丸标签 -->
      <g>
        <line x1="280" y1="175" x2="313" y2="175" stroke="#0284c7" stroke-width="2" marker-end="url(#arrow-blue)" />
        <rect x="281" y="161" width="31" height="15" rx="3" fill="#e0f2fe" stroke="#bae6fd" stroke-width="0.8" />
        <text x="296" y="172" fill="#0369a1" font-size="8" font-weight="bold" text-anchor="middle">TLS</text>
      </g>

      <g>
        <line x1="640" y1="175" x2="668" y2="175" stroke="#8b5cf6" stroke-width="2" marker-end="url(#arrow-purple)" />
        <rect x="641" y="161" width="27" height="15" rx="3" fill="#ede9fe" stroke="#ddd6fe" stroke-width="0.8" />
        <text x="654" y="172" fill="#6d28d9" font-size="8" font-weight="bold" text-anchor="middle">HTTP</text>
      </g>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>flowchart LR
    S1["1. 公网与安全组 (开放 443/80/22，封锁 8000 公网)"]
    S2["2. 宿主机 Nginx 反代 (SSL 证书 / WebSocket 流式透传)"]
    S3["3. VidGrab Docker 生产容器 (FastAPI + SQLite 挂载卷持久化)"]
    S1 --> S2 --> S3</code></pre>
    </div>
  </details>
</div>

---

## 三、 Nginx 反向代理与流式字幕透传时序 (Reverse Proxy Sequence)

针对字幕流式推送与大文件上传，Nginx 必须配置专有透传策略：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Nginx SSL 卸载、静态强缓存与流式透传时序 (ECS Nginx Reverse Proxy Sequence)</span>
    </div>
    <span class="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full dark:bg-emerald-950/60 dark:text-emerald-400">网络时序 · 零缓冲分发</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 920 440" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <marker id="ng-arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <marker id="ng-arr-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6"/>
        </marker>
        <marker id="ng-arr-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981"/>
        </marker>
      </defs>

      <!-- 泳道 -->
      <g transform="translate(40, 20)">
        <rect width="180" height="34" rx="6" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <text x="90" y="22" fill="#0369a1" font-weight="bold" font-size="11.5" text-anchor="middle">Browser Client (HTTPS)</text>
        <line x1="90" y1="34" x2="90" y2="410" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <g transform="translate(370, 20)">
        <rect width="180" height="34" rx="6" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <text x="90" y="22" fill="#6d28d9" font-weight="bold" font-size="11.5" text-anchor="middle">Host Nginx Edge</text>
        <line x1="90" y1="34" x2="90" y2="410" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <g transform="translate(700, 20)">
        <rect width="180" height="34" rx="6" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <text x="90" y="22" fill="#047857" font-weight="bold" font-size="11.5" text-anchor="middle">VidGrab Container (127.0.0.1:8000)</text>
        <line x1="90" y1="34" x2="90" y2="410" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <!-- 步骤 1 -->
      <g transform="translate(0, 75)">
        <line x1="130" y1="0" x2="452" y2="0" stroke="#0284c7" stroke-width="1.6" marker-end="url(#ng-arr-blue)" />
        <rect x="200" y="-18" width="180" height="24" rx="4" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
        <text x="290" y="-2" fill="#0369a1" font-size="10.5" font-weight="bold" text-anchor="middle">1. HTTPS 访问 https://vidgrab.io</text>
      </g>

      <!-- 步骤 2: TLS 握手 -->
      <g transform="translate(460, 125)">
        <rect width="210" height="34" rx="5" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
        <text x="105" y="15" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">2. TLS 1.3 握手与 SSL 卸载</text>
        <text x="105" y="27" fill="#64748b" font-size="8.5" text-anchor="middle">静态资源命中本地缓存直接返回</text>
      </g>

      <!-- 步骤 3: 转发动态 API -->
      <g transform="translate(0, 195)">
        <line x1="460" y1="0" x2="782" y2="0" stroke="#8b5cf6" stroke-width="1.6" marker-end="url(#ng-arr-purple)" />
        <rect x="500" y="-18" width="240" height="24" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
        <text x="620" y="-2" fill="#6d28d9" font-size="10.5" font-weight="bold" text-anchor="middle">3. proxy_pass http://127.0.0.1:8000</text>
      </g>

      <!-- 步骤 4: 禁用缓冲透传流式字幕 -->
      <g transform="translate(460, 255)">
        <rect width="230" height="38" rx="5" fill="#fef3c7" stroke="#fde68a" stroke-width="1" />
        <text x="115" y="16" fill="#b45309" font-size="10" font-weight="bold" text-anchor="middle">4. proxy_buffering off; (零缓冲)</text>
        <text x="115" y="29" fill="#92400e" font-size="8.5" text-anchor="middle">首批 3.5s 切片字幕立即透传给客户端</text>
      </g>

      <!-- 步骤 5: 响应分发 -->
      <g transform="translate(0, 335)">
        <line x1="790" y1="0" x2="468" y2="0" stroke="#10b981" stroke-width="1.6" stroke-dasharray="4,3" marker-end="url(#ng-arr-emerald)" />
        <line x1="460" y1="0" x2="138" y2="0" stroke="#10b981" stroke-width="1.6" stroke-dasharray="4,3" marker-end="url(#ng-arr-emerald)" />
        <rect x="220" y="-18" width="220" height="24" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
        <text x="330" y="-2" fill="#047857" font-size="10.5" font-weight="bold" text-anchor="middle">5. 客户端 1.2s 渐进轮询上屏呈现</text>
      </g>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>sequenceDiagram
    autonumber
    participant Browser as Browser Client (HTTPS)
    participant Nginx as Host Nginx Edge
    participant App as VidGrab Container (127.0.0.1:8000)

    Browser->>Nginx: 1. 发起 HTTPS 请求
    Note over Nginx: 2. SSL 卸载，静态资源命中缓存直接返回
    Nginx->>App: 3. proxy_pass 转发至容器业务网关
    Note over Nginx: 4. proxy_buffering off (禁用缓冲透传)
    App-->>Nginx: 5. 3.5s 首批字幕流就绪
    Nginx-->>Browser: 实时推达客户端渲染</code></pre>
    </div>
  </details>
</div>

---

## 四、 环境契约与 Nginx 生产配置 (Configuration & Nginx Contract)

宿主机 Nginx 生产标准配置模板（支持 **SmartDiagram Monorepo 统一网关 `:9237` + `/video-api/*` 转发至 `:4020`**，或独立容器 `:8000`）：

```nginx
server {
    listen 80;
    server_name vidgrab.unilumin-gtm.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name vidgrab.unilumin-gtm.com;

    ssl_certificate /etc/letsencrypt/live/vidgrab.unilumin-gtm.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vidgrab.unilumin-gtm.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 客户端大视频拖拽上传限制 (放宽至 500MB)
    client_max_body_size 500m;

    # 1. SmartDiagram 视频学习助手 API 路由 (/video-api/* ➔ 127.0.0.1:4020)
    location /video-api/ {
        proxy_pass http://127.0.0.1:4020/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 核心排坑 1：严禁开启 proxy_cache，否则会剥离 Range 头导致点击 00:26 时间戳重置回 00:00
        proxy_cache off;
        # 核心排坑 2：流式 SSE 问答与 3.5s 首批字幕推流必须关闭代理缓冲
        proxy_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # 2. SmartDiagram 统一前端与主网关 (:9237，若独立部署 api-video 容器则改为 :8000)
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

        # 支持 WebSocket 与长连接升级
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 五、 边界防御、高可用守护与安全加固 (Security Hardening & HA)

### 1. 端口最小化暴露安全规范
在云厂商控制台，系统入站规则严格限定：
- **443 端口**：向全部公网 `0.0.0.0/0` 开放；
- **80 端口**：向全部公网 `0.0.0.0/0` 开放（仅用于 Let's Encrypt 证书验证与 301 跳转）；
- **22 端口 (SSH)**：严格限制仅对管理员办公 IP 或堡垒机开放；
- **内部服务端口（`9237` / `4020` / `8001` / `5432` / `8000`）**：**严禁在安全组开通公网放行**，必须仅绑定在 `127.0.0.1` 本地回环或 Docker 内部桥接网络。

### 2. 数据库在线热备与异地灾备 Crontab
在宿主机配置每日定时任务（涵盖 PostgreSQL 16 `vidgrab` 库及独立容器 SQLite 快照）：
```bash
# 每日凌晨 03:00 执行 PostgreSQL 16 vidgrab 库逻辑热备
0 3 * * * pg_dump -Fc -d vidgrab > /opt/backups/vidgrab_$(date +\%F).dump 2>> /var/log/vidgrab_backup.log
# 若为独立容器 SQLite 部署模式：
0 3 * * * docker compose -f /opt/free-video-downloader/docker-compose.yml exec -T vidgrab python /app/scripts/backup_sqlite.py >> /var/log/vidgrab_backup.log 2>&1
```

---

## 六、 运维巡检、灾备恢复与验收清单 (Inspection & Disaster Recovery Checklist)

### 1. 云主机日常巡检命令集

```bash
# 1. SmartDiagram 生产全栈一键部署与状态检查
./deploy.sh
docker compose ps

# 2. 检查 api-video 与 shared-jeff (685MiB mmap) 实时内存利用率
docker stats --no-stream

# 3. 检查系统磁盘空间使用率 (关注 apps/api-video/downloads 目录)
df -h

# 4. 测试本地视频学习助手与系统 1 路由健康接口
curl -s http://127.0.0.1:4020/api/health
curl -s http://127.0.0.1:8001/health
```

### 2. 生产交付验收指标核验表

| 序号 | 验证场景 | 检查手段 | 预期技术表现 | 验收状态 |
| :---: | :--- | :--- | :--- | :---: |
| **TC-ECS-01** | 安全组隔离 | 从外部网络直接访问 `http://<ECS_IP>:8000` | 连接超时或被丢弃，端口未暴露 | ✅ 通过 |
| **TC-ECS-02** | HTTPS 强制重定向 | 浏览器访问 `http://vidgrab.example.com` | 自动 301 跳转至 `https://`，证书合法 | ✅ 通过 |
| **TC-ECS-03** | 流式字幕零缓冲 | 发起长视频 AI 总结 | 首批字幕 3.5s 内瞬时推达客户端，无缓冲等待 | ✅ 通过 |
| **TC-ECS-04** | 大文件上传穿透 | 拖拽上传 350MB 的 4K 视频 | Nginx 不报错 413 Request Entity Too Large | ✅ 通过 |
| **TC-ECS-05** | 主机重启容器自拉起 | 触发云主机重启 `reboot` | 重启后 Docker 守护进程自动恢复容器运行 | ✅ 通过 |
