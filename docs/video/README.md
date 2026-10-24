# SmartDiagram 视频学习助手 (`/video`) v2.7.0 · 工业级技术知识库中心

> **系统定位**：SmartDiagram 视频学习助手（`/video` 工作台，原 VidGrab 核心引擎）是面向高净值深度学习者与专业研究员的**高性能视频学习工作台与商业智库研报系统**（v2.7.0 · 2026-10）。  
> **工程愿景**：在 SmartDiagram Monorepo 统一工作台下，以第一性原理打造集“React 18 + Tailwind v4 Apple 毛玻璃交互外壳、多平台爬虫集群与 100% 自动流式下载、四点并发极速总结管线（6 线程 ASR + 主研报与双语翻译双线程并行，210s 视频总耗时压降至 `35.4s`）、Jeff 系统 1 三层高置信意图门控、MindElixir 跨工作台导图协同、Study Deck / Paper Sheet 双模式测验，以及 PostgreSQL 16 (`vidgrab` 库) + `localStorage` 双重持久化”于一体的全栈架构。

---

## 快速导航矩阵 · 六大知识卷轴

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">SmartDiagram /video v2.7.0 工业技术知识库拓扑全景 (Engineering Hub Map)</span>
    </div>
    <span class="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-950/60 dark:text-blue-400">Monorepo 统一架构 · 核心卷轴矩阵</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 960 480" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <filter id="svg-card-shadow" x="-4%" y="-3%" width="108%" height="108%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.06"/>
        </filter>
        <linearGradient id="hub-center-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0284c7" />
          <stop offset="100%" stop-color="#2563eb" />
        </linearGradient>
        <marker id="arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <marker id="arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981"/>
        </marker>
        <marker id="arrow-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6"/>
        </marker>
        <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b"/>
        </marker>
      </defs>

      <!-- 贝塞尔连线：中心枢纽连接四大象限与上下卷轴 -->
      <path d="M 370 240 C 270 240, 260 100, 190 100" fill="none" stroke="#0284c7" stroke-width="2.2" stroke-linecap="round" />
      <path d="M 190 100 C 130 100, 120 50, 40 50" fill="none" stroke="#7dd3fc" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 190 100 C 130 100, 120 85, 40 85" fill="none" stroke="#7dd3fc" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 190 100 C 130 100, 120 120, 40 120" fill="none" stroke="#7dd3fc" stroke-width="1.2" stroke-linecap="round" />

      <path d="M 590 240 C 690 240, 700 100, 770 100" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" />
      <path d="M 770 100 C 830 100, 840 50, 915 50" fill="none" stroke="#6ee7b7" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 770 100 C 830 100, 840 85, 915 85" fill="none" stroke="#6ee7b7" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 770 100 C 830 100, 840 120, 915 120" fill="none" stroke="#6ee7b7" stroke-width="1.2" stroke-linecap="round" />

      <path d="M 370 240 C 270 240, 260 380, 190 380" fill="none" stroke="#8b5cf6" stroke-width="2.2" stroke-linecap="round" />
      <path d="M 190 380 C 130 380, 120 335, 40 335" fill="none" stroke="#c4b5fd" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 190 380 C 130 380, 120 370, 40 370" fill="none" stroke="#c4b5fd" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 190 380 C 130 380, 120 405, 40 405" fill="none" stroke="#c4b5fd" stroke-width="1.2" stroke-linecap="round" />

      <path d="M 590 240 C 690 240, 700 380, 770 380" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" />
      <path d="M 770 380 C 830 380, 840 335, 915 335" fill="none" stroke="#fcd34d" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 770 380 C 830 380, 840 370, 915 370" fill="none" stroke="#fcd34d" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 770 380 C 830 380, 840 405, 915 405" fill="none" stroke="#fcd34d" stroke-width="1.2" stroke-linecap="round" />

      <path d="M 480 205 L 480 75" fill="none" stroke="#06b6d4" stroke-width="2.2" stroke-linecap="round" />

      <!-- 中心总枢纽 -->
      <g transform="translate(365, 205)" filter="url(#svg-card-shadow)">
        <rect width="230" height="70" rx="35" fill="url(#hub-center-grad)" stroke="#ffffff" stroke-width="2.5" />
        <text x="115" y="35" fill="#ffffff" font-size="13.5" font-weight="bold" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif">📚 SmartDiagram /video</text>
        <text x="115" y="53" fill="#dbeafe" font-size="10.5" text-anchor="middle">v2.7.0 · 四点并发 · PG16 双写</text>
      </g>

      <!-- 卷一：系统总览与全栈架构 (左上) -->
      <g transform="translate(45, 75)" filter="url(#svg-card-shadow)">
        <rect width="165" height="48" rx="8" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <text x="14" y="24" fill="#0369a1" font-weight="bold" font-size="11.5">🏛️ 卷一：核心架构与设计</text>
        <text x="14" y="39" fill="#0284c7" font-size="9.5">React 18 · 四点并发 · 契约</text>
      </g>
      <g transform="translate(8, 36)" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="9.5">
        <rect width="145" height="24" rx="4" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
        <text x="8" y="16" fill="#0c4a6e">系统架构与技术全景</text>
        <rect y="35" width="145" height="24" rx="4" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
        <text x="8" y="51" fill="#0c4a6e">方案设计与开闭原则</text>
        <rect y="70" width="145" height="24" rx="4" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
        <text x="8" y="86" fill="#0c4a6e">系统需求规格说明 (SRS)</text>
      </g>

      <!-- 卷二：AI 引擎与多模态 (右上) -->
      <g transform="translate(745, 75)" filter="url(#svg-card-shadow)">
        <rect width="165" height="48" rx="8" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <text x="14" y="24" fill="#047857" font-weight="bold" font-size="11.5">🧠 卷二：AI 引擎与多模态</text>
        <text x="14" y="39" fill="#10b981" font-size="9.5">6线程ASR · Jeff门控 · 双源Quiz</text>
      </g>
      <g transform="translate(805, 36)" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="9.5">
        <rect width="145" height="24" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
        <text x="8" y="16" fill="#064e3b">优化记录与技术演进</text>
        <rect y="35" width="145" height="24" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
        <text x="8" y="51" fill="#064e3b">Jeff 三层意图门控路由</text>
        <rect y="70" width="145" height="24" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
        <text x="8" y="86" fill="#064e3b">无旁白视觉与 HEVC 转码</text>
      </g>

      <!-- 卷三：多平台流媒体摄取 (左下) -->
      <g transform="translate(45, 355)" filter="url(#svg-card-shadow)">
        <rect width="165" height="48" rx="8" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <text x="14" y="24" fill="#6d28d9" font-weight="bold" font-size="11.5">🌐 卷三：流媒体解析集群</text>
        <text x="14" y="39" fill="#8b5cf6" font-size="9.5">彩色徽章 · 206 Range · 自动保存</text>
      </g>
      <g transform="translate(8, 320)" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="9.5">
        <rect width="145" height="24" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
        <text x="8" y="16" fill="#4c1d95">多平台统一下载策略</text>
        <rect y="35" width="145" height="24" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
        <text x="8" y="51" fill="#4c1d95">播放能力调研与直链矩阵</text>
        <rect y="70" width="145" height="24" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
        <text x="8" y="86" fill="#4c1d95">平台接入与运维反爬指南</text>
      </g>

      <!-- 卷五：生产部署与运维 (右下) -->
      <g transform="translate(745, 355)" filter="url(#svg-card-shadow)">
        <rect width="165" height="48" rx="8" fill="#fffbeb" stroke="#f59e0b" stroke-width="1.5" />
        <text x="14" y="24" fill="#b45309" font-weight="bold" font-size="11.5">🐳 卷五：生产部署与运维</text>
        <text x="14" y="39" fill="#f59e0b" font-size="9.5">gateway :9237 · api-video :4020</text>
      </g>
      <g transform="translate(805, 320)" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="9.5">
        <rect width="145" height="24" rx="4" fill="#ffffff" stroke="#fde68a" stroke-width="1" />
        <text x="8" y="16" fill="#78350f">Docker 容器化交付</text>
        <rect y="35" width="145" height="24" rx="4" fill="#ffffff" stroke="#fde68a" stroke-width="1" />
        <text x="8" y="51" fill="#78350f">阿里云 ECS 部署指南</text>
        <rect y="70" width="145" height="24" rx="4" fill="#ffffff" stroke="#fde68a" stroke-width="1" />
        <text x="8" y="86" fill="#78350f">宝塔 HTTPS 与 CI/CD</text>
      </g>

      <!-- 卷四：商业化、账号与存储 (正上方卡片) -->
      <g transform="translate(315, 18)" filter="url(#svg-card-shadow)">
        <rect width="330" height="60" rx="10" fill="#ecfeff" stroke="#06b6d4" stroke-width="1.5" />
        <text x="14" y="22" fill="#0e7490" font-weight="bold" font-size="11.5">💳 卷四：商业化、账号与双重持久化体系 (PG16 &amp; Stripe)</text>
        <g transform="translate(14, 28)" font-size="9.5">
          <text x="0" y="18" fill="#155e75">✓ PostgreSQL 16 (vidgrab库) + localStorage 双写</text>
          <text x="205" y="18" fill="#155e75">✓ Stripe 幂等支付</text>
        </g>
      </g>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>mindmap
  root((SmartDiagram /video v2.7.0 知识库))
    卷一：核心架构与设计
      系统架构与技术全景 (React 18 + 四点并发)
      方案设计与开闭原则
      系统需求规格说明 (SRS)
    卷二：AI 引擎与多模态
      优化记录与技术演进
      系统1决策模型-Jeff三层高置信门控
      无旁白视觉理解方案
      TikTok-HEVC 兼容转码
    卷三：流媒体解析集群
      多平台统一下载策略 (100%自动流式保存)
      播放能力调研与 HTTP 206 直链矩阵
      平台接入与运维反爬指南
    卷四：商业化、账号与存储
      PostgreSQL 16 (vidgrab库) + localStorage 双写
      Stripe 支付设计与 Webhook 幂等
      会员支付开发与验收指南
    卷五：生产部署与运维
      Docker 容器化交付 (gateway :9237 / api-video :4020)
      阿里云 ECS 部署指南
      宝塔 HTTPS 与 CI/CD</code></pre>
    </div>
  </details>
</div>

---

## 知识库全量卷轴目录

### 🏛️ 卷一：系统总览与全栈架构 (System Architecture & Foundations)

| 文档名称 | 核心技术要点与规格 | 适用对象 |
|---|---|---|
| 📐 **[系统架构与技术全景](系统架构与技术全景.md)** | **【核心基石】** React 18 + Tailwind v4 毛玻璃交互层（`VideoShell` + Portal 居中切换）、`api-video :4020` / `gateway :9237` 编排层、6 线程并发 ASR (`ASR_MAX_WORKERS=6`)、主研报与双语翻译双线程并行（210s 视频总耗时压降至 `35.4s`）、MindElixir 跨工作台移交 `/diagram`、Study Deck / Paper Sheet 双模式测验及 PG16 + `localStorage` 双写拓扑。 | 全体研发 / 架构师 |
| 🛠️ **[方案设计与开闭原则](方案设计.md)** | 四点并发极速流水线、零网络等待协同缓存、HTTP 206 Range 初始态 `readyState` 校准、快慢双系统 SSE 问答契约（`POST /api/ask/stream`）与异步熔断设计。 | 后端开发 / 算法工程 |
| 📋 **[系统需求规格说明 (SRS)](需求分析.md)** | 严格对齐 SmartDiagram `/video` v2.7.0 代码实现的工业级需求规格书，涵盖六维学习闭环、功能边界与 SLA 指标。 | 产品经理 / 系统架构师 |

---

### 🧠 卷二：AI 引擎与音视频多模态 (AI Engine & Multimodal Pipeline)

| 文档名称 | 核心技术要点与规格 | 状态 |
|---|---|---|
| 🚀 **[优化记录与技术演进](优化记录与技术演进.md)** | **【持续追踪】** 记录四点并发极速管线（210s 视频 `58.8s ➔ 35.4s`）、6 线程 ASR (`6.7s`)、领域先验编译器（`build_asr_system_prompt` 0 同音错别字）、自研 `markdown.ts` 渲染引擎、双源融合极速出题（`~9s`）与 Study Deck / Paper Sheet 双模式演进。 | **活跃维护中** |
| ⚡ **[系统1决策模型-Jeff本地部署与毫秒级意图路由](系统1决策模型-Jeff本地部署与毫秒级意图路由.md)** | **【核心破局】** `Jeff (:8001, gliformer-large-v1)` Safetensors `mmap` 零拷贝常驻（`685 MiB`）、三层高置信意图门控（① `_SUMMARY_QA_PRIORITY_RE` 硬优先白名单 ➔ ② 功能动作词校验 ➔ ③ `0.78` 阈值门控）与 SSE 耗时徽章展示。 | 生产已集成 |
| 👁️ **[AI总结-无旁白视频优化方案](AI总结-无旁白视频优化方案.md)** | 针对无旁白、背景音乐占优的视频素材，采用关键帧抽帧、场景目标识别与多模态音画特征融合生成。 | 生产已集成 |
| 🎬 **[TikTok-HEVC下载与兼容方案](TikTok-HEVC下载与兼容方案.md)** | 移动端 H.265/HEVC 编码深度嗅探、FFmpeg 极速降解为 Web 友好的 H.264 MP4 自动交付。 | 生产已集成 |

---

### 🌐 卷三：多平台流媒体摄取与播放引擎 (Media Scraping & Playback)

| 文档名称 | 核心技术要点与规格 | 状态 |
|---|---|---|
| 🎯 **[多平台统一策略](多平台统一策略.md)** | 自动识别 **🎵 抖音 / 📺 Bilibili / 📕 小红书 / ▶️ YouTube / 🎵 TikTok** 彩色来源徽章，抖音 4 线程分片并发下载、B站 WBI 签名、小红书 `xhshow` 签名治理与下载达 100% 自动触发浏览器流式保存。 | 生产标准 |
| 📊 **[播放能力调研与方案](播放能力调研与方案.md)** | `VideoPlayer.tsx` 自适应竖屏（`max-w-[390px] max-h-[66vh]`）与横屏（`max-h-[54vh]`）大屏播放，HTTP 206 Range 秒级精准跳转（含未播放初始态 `readyState` 校准）。 | 生产标准 |
| 🛡️ **[平台接入与运维指南](平台接入与运维指南.md)** | 匿名 Cookie 池保活机制、IP 限频风控对抗策略、新站点接入三步法。 | 运维参考 |

---

### 💳 卷四：商业化、账号与存储体系 (Business, Auth & Storage)

| 文档名称 | 核心技术要点与规格 | 状态 |
|---|---|---|
| 💾 **[存储方案与账号鉴权架构](存储方案-SQLite本地账号.md)** | 已全面升级为 **PostgreSQL 16 (`vidgrab` 数据库)**：`users`、`videos`、`analyses`（`result` JSONB 内含研报、`chat_history` 多轮问答、`quiz_data` 测验与作答状态）、`quizzes`、`quiz_attempts`，配合前端 `localStorage` 双写与学习记录页 `🎯 测验 XX分` 直达回放（附历史单文件架构演进对比）。 | 生产标准 |
| 💳 **[会员支付-Stripe 方案设计](会员支付-Stripe方案设计.md)** | Stripe Checkout 托管收银台、Webhook 签名验签幂等落库（`billing_webhook_events`）、Customer Portal 订阅管理。 | 生产标准 |
| 🧪 **[会员支付-开发与验收指南](会员支付-开发与验收指南.md)** | 本地 Stripe CLI 联调沙箱、Webhook 事件推送模拟推演、核心端到端验收用例。 | 联调测试 |

---

### 🐳 卷五：生产部署与运维基础设施 (Deployment & Operations)

| 文档名称 | 核心技术要点与规格 | 状态 |
|---|---|---|
| 📦 **[Docker 内部部署](Docker内部部署.md)** | SmartDiagram Monorepo 容器化交付：本地 Vite `:5173` `/video-api/*` 代理至 `apps/api-video :4020`，生产环境由 `gateway :9237` (Nginx) 统一分流，集成 PostgreSQL 16 与 `Jeff :8001` 微服务。 | 容器交付 |
| ☁️ **[阿里云 ECS 部署指南](阿里云ECS部署指南.md)** | 生产 Linux ECS 一键部署、国内镜像加速源配置、systemd 守护进程与日志轮转策略。 | 生产部署 |
| 🎛️ **[宝塔面板部署指南](宝塔面板部署指南.md)** | 宝塔 + Docker Compose 首次上线：`.env.docker`、Jeff `:8001` 零拷贝配置、建站反代与验收清单。 | 生产部署 |
| 🔒 **[宝塔域名 HTTPS 与 GitHub 自动部署](宝塔域名HTTPS与GitHub自动部署.md)** | Nginx 反代配置（支持 WebSocket/SSE 长连接穿透）、Let's Encrypt 自动续期与 CI/CD 自动化流水线。 | 自动化运维 |

---

### 📜 卷六：历史沉淀与项目演进 (Archives & Engineering Milestones)

- **[优化记录与技术演进](优化记录与技术演进.md)**：最新系统架构突破与 v2.7.0 演进指南。
- **[执行记录与踩坑沉淀](执行记录.md)**：历史环境适配、Windows 便携版 Python、证书修复等历史踩坑全纪实。
- **[2026-06-25-稳定性与总结加速迭代](2026-06-25-稳定性与总结加速迭代.md)**：早期总结加速与熔断器设计记录。
- **[2026-08-07-洲明视频学习助手与AI测验](2026-08-07-洲明视频学习助手与AI测验.md)**：本地音视频拖拽上传与 AI 测验系统设计。

---

## 核心系统 SLA 指标看板 (v2.7.0)

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">SmartDiagram /video v2.7.0 全链路性能指标与可用性保障看板 (Core SLA Performance Dashboard)</span>
    </div>
    <span class="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-950/60 dark:text-blue-400">工业级 SLA · 毫秒级监控</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 940 260" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <filter id="sla-readme-shadow" x="-4%" y="-3%" width="108%" height="108%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.06"/>
        </filter>
      </defs>

      <!-- 3 列 x 2 行 卡片矩阵 -->
      <!-- 行 1 -->
      <!-- 卡片 1: 首批字幕响应时延 -->
      <g transform="translate(15, 20)" filter="url(#sla-readme-shadow)">
        <rect width="285" height="100" rx="8" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <rect width="285" height="26" rx="8" fill="#0284c7" />
        <rect y="14" width="285" height="12" fill="#0284c7" />
        <text x="12" y="18" fill="#ffffff" font-weight="bold" font-size="11">⚡ 首批字幕与 6 线程转写</text>
        <g transform="translate(14, 38)">
          <text x="0" y="20" fill="#0369a1" font-weight="bold" font-size="18" font-family="monospace">≤ 3.5s / 6.7s</text>
          <text x="0" y="42" fill="#0f172a" font-size="10.5">首片 3.5s 推流 · 210s视频 6 线程转写仅 6.7s</text>
        </g>
      </g>

      <!-- 卡片 2: 双线程并行研报总耗时 -->
      <g transform="translate(325, 20)" filter="url(#sla-readme-shadow)">
        <rect width="285" height="100" rx="8" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <rect width="285" height="26" rx="8" fill="#10b981" />
        <rect y="14" width="285" height="12" fill="#10b981" />
        <text x="12" y="18" fill="#ffffff" font-weight="bold" font-size="11">🚀 210s 视频端到端总结耗时</text>
        <g transform="translate(14, 38)">
          <text x="0" y="20" fill="#047857" font-weight="bold" font-size="18" font-family="monospace">35.4s (提速40%+)</text>
          <text x="0" y="42" fill="#0f172a" font-size="10.5">主研报 + 双语字幕双线程并行 (原 58.8s)</text>
        </g>
      </g>

      <!-- 卡片 3: 双源融合极速出题 -->
      <g transform="translate(635, 20)" filter="url(#sla-readme-shadow)">
        <rect width="285" height="100" rx="8" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <rect width="285" height="26" rx="8" fill="#8b5cf6" />
        <rect y="14" width="285" height="12" fill="#8b5cf6" />
        <text x="12" y="18" fill="#ffffff" font-weight="bold" font-size="11">🎴 双源融合极速出题 (6 题)</text>
        <g transform="translate(14, 38)">
          <text x="0" y="20" fill="#6d28d9" font-weight="bold" font-size="18" font-family="monospace">~9.0s (原 ~25s)</text>
          <text x="0" y="42" fill="#0f172a" font-size="10.5">时间桶采样 + 研报骨架 + Study Deck / 全卷</text>
        </g>
      </g>

      <!-- 行 2 -->
      <!-- 卡片 4: Jeff 系统 1 三层意图门控 -->
      <g transform="translate(15, 140)" filter="url(#sla-readme-shadow)">
        <rect width="285" height="100" rx="8" fill="#fffbeb" stroke="#f59e0b" stroke-width="1.5" />
        <rect width="285" height="26" rx="8" fill="#f59e0b" />
        <rect y="14" width="285" height="12" fill="#f59e0b" />
        <text x="12" y="18" fill="#ffffff" font-weight="bold" font-size="11">🧠 Jeff 系统 1 三层高置信门控</text>
        <g transform="translate(14, 38)">
          <text x="0" y="20" fill="#b45309" font-weight="bold" font-size="18" font-family="monospace">685 MiB · 100%归正</text>
          <text x="0" y="42" fill="#0f172a" font-size="10.5">Safetensors mmap 零拷贝 · 0.78 高置信阈值</text>
        </g>
      </g>

      <!-- 卡片 5: 任务取消与熔断时延 -->
      <g transform="translate(325, 140)" filter="url(#sla-readme-shadow)">
        <rect width="285" height="100" rx="8" fill="#fef2f2" stroke="#ef4444" stroke-width="1.5" />
        <rect width="285" height="26" rx="8" fill="#ef4444" />
        <rect y="14" width="285" height="12" fill="#ef4444" />
        <text x="12" y="18" fill="#ffffff" font-weight="bold" font-size="11">🛑 任务取消与熔断时延</text>
        <g transform="translate(14, 38)">
          <text x="0" y="20" fill="#b91c1c" font-weight="bold" font-size="18" font-family="monospace">≤ 200ms</text>
          <text x="0" y="42" fill="#0f172a" font-size="10.5">SummaryCancelledError 强行阻断后端</text>
        </g>
      </g>

      <!-- 卡片 6: PG16 + localStorage 双写持久化 -->
      <g transform="translate(635, 140)" filter="url(#sla-readme-shadow)">
        <rect width="285" height="100" rx="8" fill="#fdf4ff" stroke="#d946ef" stroke-width="1.5" />
        <rect width="285" height="26" rx="8" fill="#d946ef" />
        <rect y="14" width="285" height="12" fill="#d946ef" />
        <text x="12" y="18" fill="#ffffff" font-weight="bold" font-size="11">💾 PG16 + localStorage 双重持久化</text>
        <g transform="translate(14, 38)">
          <text x="0" y="20" fill="#a21caf" font-weight="bold" font-size="18" font-family="monospace">100% 状态同步</text>
          <text x="0" y="42" fill="#0f172a" font-size="10.5">vidgrab 库 JSONB 归档研报/问答/测验得分</text>
        </g>
      </g>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>flowchart LR
    A["⚡ 6线程ASR (首片3.5s / 210s仅6.7s)"] --> B["🚀 双线程并行研报 (210s总耗时 35.4s)"]
    B --> C["🎴 双源融合出题 (6题精选 ~9.0s)"]
    C --> D["💾 PostgreSQL 16 + localStorage 双写"]</code></pre>
    </div>
  </details>
</div>

| 指标维度 | 指标项 | 目标 SLA | 测量基准与验证方式 | 保障与防御机制 |
| :--- | :--- | :--- | :--- | :--- |
| **时延 (Latency)** | 首批字幕与 6 线程转写 | 首片 $\le 3.5\text{s}$ / 210s仅 $6.7\text{s}$ | 实时推流秒表打点 | `ASR_MAX_WORKERS=6` + `on_chunk_done` 极速推流 |
| **时延 (Latency)** | 210s 视频端到端总结 | $35.4\text{s}$ (原 $58.8\text{s}$) | `/api/summary` 全链路计时 | 主研报生成 + 双语字幕翻译 `ThreadPoolExecutor` 双线程并行 |
| **时延 (Latency)** | AI 学习测验出题 (6 题) | $\sim 9.0\text{s}$ (原 $\sim 25\text{s}$) | `/api/quiz` 调用计时 | 时间桶均匀采样 + 研报骨架双源融合 + Bloom 四维分层 |
| **路由 (Routing)** | Jeff 系统 1 三层意图门控 | $685\text{ MiB}$ / 100% 归正 | `POST /api/ask/stream` 路由阶段 | Safetensors `mmap` 零拷贝 + 白名单/动作词/`0.78` 阈值门控 |
| **韧性 (Resilience)** | 任务取消与熔断时延 | $\le 200\text{ms}$ | POST `/api/summary/cancel` 响应 | `SummaryCancelledError` 强行阻断后端并清理临时文件 |
| **持久化 (Storage)** | 双重持久化与幂等保障 | 100% 状态同步 | 页面刷新与历史回放测试 | PostgreSQL 16 (`vidgrab` 库 JSONB) + `localStorage` 双写 |

---

## 贡献与文档维护规范

1. **事实第一，禁止虚构**：所有架构拓扑与时序图变更，必须严格对齐前端 `apps/web/src/features/video/` 与后端 `apps/api-video/` 的真实实现；
2. **纯原生 SVG 图表标准**：**严禁使用任何客户端图表渲染库（Mermaid/Chart.js）**。所有图表必须采用本项目标准外壳包裹手写原生 SVG 矢量图，并在折叠框中附注 Mermaid DSL 源码以便追溯；
3. **安全红线**：严禁在任何文档、测试用例或示例代码中硬编码任何真实 API Key、Stripe 私钥或服务器凭据；
4. **统一命名与规范**：新增文档必须归入上述六大卷轴，遵循 Google / Apple 官方技术文档的客观、严谨、工业级中英语气。
