# PostgreSQL 16 与双写存储架构白皮书（含 SQLite 演进） · Storage & Auth Architecture

> **标准定义**：SmartDiagram 视频学习助手 (`/video` v2.7.0) 持久化数据底座、统一身份认证、JSONB 全量知识归档、双写持久化与 Stripe 商业化幂等防御体系白皮书。  
> **生产基准（SmartDiagram v2.7.0 · 2026-10）**：由早期单文件 SQLite (`app.db` + WAL) 全面演进至 **PostgreSQL 16 (`vidgrab` 独立库 + `psycopg_pool.ConnectionPool` 连接池 + `migrations/001_init.sql` 自动迁移)**，打通 SmartDiagram 平台统一认证 (`readAuthSession` / `readGuestSession`)，并构建 **服务端 PostgreSQL JSONB + 浏览器 `localStorage` (`vidgrab_guest_history_v1` / `vidgrab_quiz_v2_*`) 双写持久化体系**。

---

## 一、 业务背景与存储架构演进路线 (Background & Architectural Evolution)

SmartDiagram 视频学习助手作为高频交互的全栈 AI 音视频知识内化系统，不仅承载着用户账号、配额与商业化订阅计费，更需要原子化持久化海量的 **四大篇章深度研报、思维导图 Markdown、双语时间轴字幕、多轮 AI 追问上下文 (`chat_history`) 以及交互式测验题库与实时作答状态 (`quiz_data` / `user_state`)**。

在架构演进过程中，系统经历了从**第一代单文件 SQLite 自治存储**到**第二代 PostgreSQL 16 (`vidgrab` 库) + 客户端双写架构**的平滑跃迁：

### 1. 外部云 BaaS 方案的现实痛点与早期 SQLite 探索

1. **跨国网络与跨网段高时延**：海外托管 BaaS（如远端 Supabase Cloud / Firebase）单次 API 鉴权与大体积研报 JSON 读写往返开销高达 150ms ~ 350ms，严重拖慢流式字幕 3.5s 首批上屏与历史秒开的体验。
2. **外部网络抖动与单点依赖**：一旦外部云数据库发生闪断、DNS 污染或连接重置，核心的视频解析、语音转写与测验批改将全线中断。
3. **从 SQLite 到同机/内网 PostgreSQL 16 的必然演进**：
   - **第一阶段（独立版 VidGrab）**：采用单文件 SQLite (`app.db`) + WAL 预写日志，解决了零外部依赖与亚毫秒鉴权问题，但在多工作进程高并发写入大型研报 JSON 与高频测验交卷时，仍受限于文件级写锁（Single-Writer Lock）。
   - **第二阶段（SmartDiagram v2.7.0 平台化融合）**：全面升级至同机/容器内网 **PostgreSQL 16 (`vidgrab` 专用库)**，通过 `psycopg_pool.ConnectionPool`（`apps/api-video/db.py`）管理并发连接，利用原生 **JSONB** 引擎实现研报、对话与测验状态的高并发行级锁更新，并与前端 `guestHistory.ts` 组成双重持久化防线。

### 2. 存储架构三代演进对比矩阵

| 架构维度 | 外部云 BaaS (远端托管) | 第一代：单文件 SQLite WAL (历史演进) | **第二代：SmartDiagram v2.7.0 (PostgreSQL 16 + 双写)** |
| :--- | :--- | :--- | :--- |
| **数据库引擎与连接** | 跨公网 HTTP REST / 受限连接池 | 本地单文件 `app.db` + `threading.RLock` | **PostgreSQL 16 (`vidgrab` 库) + `psycopg_pool.ConnectionPool` (1~10 连接)** |
| **建表与 Schema 演进** | 依赖云端控制台手工维护 | 冷启动 `sqlite_store.py` 建表 | **`db.py: ensure_database_exists()` 自动建库 + `migrations/001_init.sql` 幂等迁移** |
| **复杂研报与测验存储** | 多表拆分或受限文本字段 | `TEXT` 序列化 JSON，全量覆写 | **原生 `JSONB` 引擎 (`analyses.result` / `quizzes.questions`)，支持局部合并与索引** |
| **认证与游客配额体系** | 强绑定第三方 Auth SDK | 独立 `AuthModal.vue` + 单库 JWT | **统一打通 SmartDiagram 认证 (`readAuthSession` / `readGuestSession`)，游客享每日 30 次总结 / 100 次问答** |
| **断网容灾与学习记录** | 强依赖网络，未登录即丢失 | 仅登录态落盘 | **PostgreSQL + `localStorage` (`vidgrab_guest_history_v1` / `vidgrab_quiz_v2_*`) 双写** |

---

## 二、 实体关系与存储架构拓扑 (ER Modeling & SVG Topology)

在 SmartDiagram v2.7.0 中，后端通过 `apps/api-video/migrations/001_init.sql` 规范化定义了 **8 张核心业务与商业化实体表**，并在 `apps/api-video/repo.py` 中实现了分析记录、AI 追问与测验分数的自动关联与反查补齐：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">SmartDiagram v2.7.0 PostgreSQL 16 (vidgrab) 实体关系与双写持久化拓扑</span>
    </div>
    <span class="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-950/60 dark:text-blue-400">PostgreSQL 16 · JSONB · 双写架构</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 960 440" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
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

      <!-- 表 1: users & videos (左上) -->
      <g transform="translate(20, 25)" filter="url(#svg-card-shadow)">
        <rect width="270" height="175" rx="8" fill="#ffffff" stroke="#0284c7" stroke-width="1.5" />
        <rect width="270" height="28" rx="8" fill="#0284c7" />
        <rect y="16" width="270" height="12" fill="#0284c7" />
        <text x="12" y="19" fill="#ffffff" font-weight="bold" font-size="11">users &amp; videos (用户与去重视频源表)</text>
        <g transform="translate(10, 36)" font-family="monospace" font-size="10">
          <text x="4" y="15" fill="#0284c7" font-weight="bold">PK users.id</text>
          <text x="105" y="15" fill="#64748b">UUID (user/admin/super_admin)</text>
          <text x="4" y="32" fill="#0f172a" font-weight="bold">UQ LOWER(email)</text>
          <text x="105" y="32" fill="#64748b">bcrypt + 配额/用量统计</text>
          <line x1="4" y1="42" x2="246" y2="42" stroke="#e2e8f0" stroke-width="1" />
          <text x="4" y="58" fill="#0284c7" font-weight="bold">PK videos.id</text>
          <text x="105" y="58" fill="#64748b">UUID (FK ➔ users.id)</text>
          <text x="4" y="75" fill="#0f172a">   source_url</text>
          <text x="105" y="75" fill="#64748b">platform / duration_sec</text>
          <text x="4" y="92" fill="#0f172a">   storage_status</text>
          <text x="105" y="92" fill="#64748b">link_only | ready | ...</text>
          <text x="4" y="109" fill="#0f172a">   storage_path</text>
          <text x="105" y="109" fill="#64748b">本地缓存路径 &amp; 字节数</text>
        </g>
      </g>

      <!-- 表 2: analyses (右上) -->
      <g transform="translate(350, 25)" filter="url(#svg-card-shadow)">
        <rect width="290" height="175" rx="8" fill="#ffffff" stroke="#8b5cf6" stroke-width="1.5" />
        <rect width="290" height="28" rx="8" fill="#8b5cf6" />
        <rect y="16" width="290" height="12" fill="#8b5cf6" />
        <text x="12" y="19" fill="#ffffff" font-weight="bold" font-size="11">analyses (AI 总结与 JSONB 核心全量表)</text>
        <g transform="translate(10, 36)" font-family="monospace" font-size="10">
          <text x="4" y="15" fill="#8b5cf6" font-weight="bold">PK id</text>
          <text x="95" y="15" fill="#64748b">TEXT (与 task_id 1:1 对应)</text>
          <text x="4" y="32" fill="#0284c7" font-weight="bold">FK video_id</text>
          <text x="95" y="32" fill="#64748b">UUID ➔ videos.id CASCADE</text>
          <text x="4" y="49" fill="#0f172a">   status</text>
          <text x="95" y="49" fill="#64748b">pending | completed | failed</text>
          <text x="4" y="68" fill="#6d28d9" font-weight="bold">   result (JSONB)</text>
          <text x="95" y="68" fill="#047857" font-weight="bold">• 四大篇章研报 + 思维导图</text>
          <text x="95" y="84" fill="#047857">• 双语字幕 + chat_history</text>
          <text x="95" y="100" fill="#047857">• quiz_data + user_state</text>
          <text x="4" y="118" fill="#0f172a">   timing (JSONB)</text>
          <text x="95" y="118" fill="#64748b">各阶段耗时指标 &amp; finished_at</text>
        </g>
      </g>

      <!-- 表 3: quizzes & quiz_attempts (右下) -->
      <g transform="translate(350, 235)" filter="url(#svg-card-shadow)">
        <rect width="290" height="180" rx="8" fill="#ffffff" stroke="#10b981" stroke-width="1.5" />
        <rect width="290" height="28" rx="8" fill="#10b981" />
        <rect y="16" width="290" height="12" fill="#10b981" />
        <text x="12" y="19" fill="#ffffff" font-weight="bold" font-size="11">quizzes &amp; quiz_attempts (题库与交卷评分表)</text>
        <g transform="translate(10, 36)" font-family="monospace" font-size="10">
          <text x="4" y="15" fill="#10b981" font-weight="bold">PK quizzes.id</text>
          <text x="110" y="15" fill="#64748b">TEXT (FK ➔ analyses.id)</text>
          <text x="4" y="32" fill="#0f172a">   questions</text>
          <text x="110" y="32" fill="#64748b">JSONB (含服务端标准答案)</text>
          <line x1="4" y1="42" x2="266" y2="42" stroke="#e2e8f0" stroke-width="1" />
          <text x="4" y="58" fill="#10b981" font-weight="bold">PK attempts.id</text>
          <text x="110" y="58" fill="#64748b">BIGSERIAL (FK ➔ quizzes.id)</text>
          <text x="4" y="75" fill="#0f172a">   answers / result</text>
          <text x="110" y="75" fill="#64748b">JSONB (用户作答与批改详情)</text>
          <text x="4" y="92" fill="#047857" font-weight="bold">   score</text>
          <text x="110" y="92" fill="#047857" font-weight="bold">REAL (驱动历史页 🎯 测验 XX分)</text>
          <text x="4" y="114" fill="#0369a1" font-size="9">🔄 get_latest_quiz_bundle_for_analysis 自动反查补齐</text>
        </g>
      </g>

      <!-- 表 4: billing_* (左下) -->
      <g transform="translate(20, 235)" filter="url(#svg-card-shadow)">
        <rect width="270" height="180" rx="8" fill="#ffffff" stroke="#f59e0b" stroke-width="1.5" />
        <rect width="270" height="28" rx="8" fill="#f59e0b" />
        <rect y="16" width="270" height="12" fill="#f59e0b" />
        <text x="12" y="19" fill="#ffffff" font-weight="bold" font-size="11">billing_* (Stripe 商业化与幂等去重表)</text>
        <g transform="translate(10, 36)" font-family="monospace" font-size="10">
          <text x="4" y="15" fill="#b45309" font-weight="bold">billing_users</text>
          <text x="115" y="15" fill="#64748b">PK user_id | cus_xxx</text>
          <text x="4" y="34" fill="#b45309" font-weight="bold">billing_subscriptions</text>
          <text x="4" y="50" fill="#64748b">  sub_xxx | monthly/yearly | active</text>
          <line x1="4" y1="60" x2="246" y2="60" stroke="#e2e8f0" stroke-width="1" />
          <text x="4" y="76" fill="#b45309" font-weight="bold">billing_webhook_events</text>
          <text x="4" y="93" fill="#0f172a">  PK event_id</text>
          <text x="105" y="93" fill="#64748b">TEXT (evt_xxx)</text>
          <text x="4" y="115" fill="#b45309" font-size="9.5">🛡️ ON CONFLICT DO NOTHING 防重放</text>
        </g>
      </g>

      <!-- 右侧双写与平台认证解说卡片 (右) -->
      <g transform="translate(680, 25)" filter="url(#svg-card-shadow)">
        <rect width="260" height="390" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
        <rect width="260" height="28" rx="8" fill="#334155" />
        <rect y="16" width="260" height="12" fill="#334155" />
        <text x="12" y="19" fill="#ffffff" font-weight="bold" font-size="11">💾 v2.7.0 双写与架构核心指标</text>
        <g transform="translate(12, 42)" font-size="10.5">
          <text x="4" y="16" fill="#0f172a" font-weight="bold">1. PostgreSQL 16 连接池引擎：</text>
          <text x="4" y="32" fill="#64748b">• vidgrab 独立库自动探测创建</text>
          <text x="4" y="48" fill="#64748b">• psycopg_pool 并发事务自管理</text>

          <text x="4" y="78" fill="#0f172a" font-weight="bold">2. 统一认证与宽裕游客配额：</text>
          <text x="4" y="94" fill="#64748b">• 打通 readAuthSession / Guest</text>
          <text x="4" y="110" fill="#64748b">• 游客每日 30 次总结 / 100 次问答</text>
          <text x="4" y="126" fill="#64748b">• 支持 user / admin / super_admin</text>

          <text x="4" y="156" fill="#0f172a" font-weight="bold">3. 服务端 + 浏览器双写持久化：</text>
          <text x="4" y="172" fill="#64748b">• guestHistory.ts 实时同步本地</text>
          <text x="4" y="188" fill="#64748b">• vidgrab_guest_history_v1 归档</text>
          <text x="4" y="204" fill="#64748b">• vidgrab_quiz_v2_* 测验状态快照</text>

          <text x="4" y="234" fill="#0f172a" font-weight="bold">4. 学习记录页全量聚合展示：</text>
          <text x="4" y="250" fill="#64748b">• VideoHistoryPage.tsx 卡片流</text>
          <text x="4" y="266" fill="#047857" font-weight="bold">• 封面 + 研报摘要 + 🎯 测验 XX分</text>
          <text x="4" y="282" fill="#64748b">• 点击卡片秒级还原完整工作台</text>
        </g>
      </g>

      <!-- 外键连线 -->
      <path d="M 290 105 L 350 105" stroke="#8b5cf6" stroke-width="1.8" marker-end="url(#arrow-purple)" fill="none" />
      <text x="320" y="97" font-size="9" fill="#8b5cf6" text-anchor="middle">1:N CASCADE</text>

      <path d="M 495 200 L 495 235" stroke="#10b981" stroke-width="1.8" marker-end="url(#arrow-emerald)" fill="none" />
      <text x="535" y="221" font-size="9" fill="#10b981" text-anchor="middle">1:N 题库反查</text>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>erDiagram
    users ||--o{ videos : "1:N 归属视频"
    users ||--o{ analyses : "1:N 发起分析"
    videos ||--o{ analyses : "1:N 总结任务"
    analyses ||--o{ quizzes : "1:N 生成测验"
    quizzes ||--o{ quiz_attempts : "1:N 交卷评分"
    users ||--o| billing_users : "1:1 商业化映射"
    billing_users ||--o{ billing_subscriptions : "1:N 订阅合约"
    analyses {
        string id PK
        uuid video_id FK
        uuid user_id FK
        string status
        jsonb result "研报+导图+字幕+chat_history+quiz_data"
        jsonb timing
    }
    quizzes {
        string id PK
        string analysis_id FK
        jsonb questions
    }
    quiz_attempts {
        bigserial id PK
        string quiz_id FK
        jsonb answers
        jsonb result
        real score
    }</code></pre>
    </div>
  </details>
</div>

---

## 三、 统一身份认证与双写持久化时序 (Unified Auth & Dual-Write Sequence)

SmartDiagram `/video` v2.7.0 与主站认证会话（`readAuthSession` / `readGuestSession`）深度打通，并在工作台总结、追问与测验交卷全流程实行 **PostgreSQL 16 + Browser `localStorage` 双写策略**：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-indigo-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">统一会话鉴权、JSONB 原子归档与本地双写时序 (Auth &amp; Dual-Write Lifecycle)</span>
    </div>
    <span class="text-[11px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full dark:bg-indigo-950/60 dark:text-indigo-400">双写持久化 · 测验反查</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 920 450" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <marker id="auth-arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <marker id="auth-arrow-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6"/>
        </marker>
        <marker id="auth-arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981"/>
        </marker>
      </defs>

      <!-- 泳道 -->
      <g transform="translate(40, 20)">
        <rect width="200" height="36" rx="6" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <text x="100" y="23" fill="#0369a1" font-weight="bold" font-size="11" text-anchor="middle">React 18 (Workspace / QuizPanel)</text>
        <line x1="100" y1="36" x2="100" y2="420" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <g transform="translate(360, 20)">
        <rect width="200" height="36" rx="6" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <text x="100" y="23" fill="#6d28d9" font-weight="bold" font-size="11" text-anchor="middle">FastAPI Repo (apps/api-video)</text>
        <line x1="100" y1="36" x2="100" y2="420" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <g transform="translate(680, 20)">
        <rect width="200" height="36" rx="6" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <text x="100" y="23" fill="#047857" font-weight="bold" font-size="11" text-anchor="middle">PostgreSQL 16 (vidgrab Pool)</text>
        <line x1="100" y1="36" x2="100" y2="420" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <!-- 步骤 1 -->
      <g transform="translate(0, 80)">
        <line x1="140" y1="0" x2="452" y2="0" stroke="#0284c7" stroke-width="1.6" marker-end="url(#auth-arrow-blue)" />
        <rect x="175" y="-18" width="245" height="24" rx="4" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
        <text x="297" y="-2" fill="#0369a1" font-size="10" font-weight="bold" text-anchor="middle">1. 携带 Bearer Token / Guest Session 发起请求</text>
      </g>

      <!-- 步骤 2 -->
      <g transform="translate(0, 135)">
        <line x1="460" y1="0" x2="772" y2="0" stroke="#8b5cf6" stroke-width="1.6" marker-end="url(#auth-arrow-purple)" />
        <rect x="495" y="-18" width="250" height="24" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
        <text x="620" y="-2" fill="#6d28d9" font-size="10" font-weight="bold" text-anchor="middle">2. 写入 videos &amp; analyses.result (JSONB)</text>
      </g>

      <!-- 步骤 3 -->
      <g transform="translate(460, 175)">
        <rect width="235" height="36" rx="5" fill="#fdf4ff" stroke="#f0abfc" stroke-width="1" />
        <text x="117" y="15" fill="#86198f" font-size="10" font-weight="bold" text-anchor="middle">3. 测验交卷双表同步 (repo.py)</text>
        <text x="117" y="29" fill="#701a75" font-size="9" text-anchor="middle">写入 quiz_attempts + 合并 quiz_data.user_state</text>
      </g>

      <!-- 步骤 4 -->
      <g transform="translate(0, 240)">
        <line x1="460" y1="0" x2="148" y2="0" stroke="#10b981" stroke-width="1.6" stroke-dasharray="4,3" marker-end="url(#auth-arrow-emerald)" />
        <rect x="185" y="-18" width="230" height="24" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
        <text x="300" y="-2" fill="#047857" font-size="10" font-weight="bold" text-anchor="middle">4. 返回完整分析结果与测验批改分数</text>
      </g>

      <!-- 步骤 5 -->
      <g transform="translate(40, 275)">
        <rect width="215" height="40" rx="5" fill="#f0f9ff" stroke="#bae6fd" stroke-width="1" />
        <text x="107" y="16" fill="#0369a1" font-size="10" font-weight="bold" text-anchor="middle">5. 浏览器 localStorage 双写归档</text>
        <text x="107" y="30" fill="#0284c7" font-size="8.5" text-anchor="middle">vidgrab_guest_history_v1 + vidgrab_quiz_v2_*</text>
      </g>

      <!-- 步骤 6 -->
      <g transform="translate(0, 345)">
        <line x1="140" y1="0" x2="452" y2="0" stroke="#0284c7" stroke-width="1.6" marker-end="url(#auth-arrow-blue)" />
        <rect x="175" y="-18" width="245" height="24" rx="4" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
        <text x="297" y="-2" fill="#0369a1" font-size="10" font-weight="bold" text-anchor="middle">6. VideoHistoryPage.tsx 拉取学习记录列表</text>
      </g>

      <!-- 步骤 7 -->
      <g transform="translate(460, 380)">
        <rect width="250" height="36" rx="5" fill="#f0fdf4" stroke="#86efac" stroke-width="1" />
        <text x="125" y="15" fill="#15803d" font-size="10" font-weight="bold" text-anchor="middle">7. 自动反查补齐最新测验成绩</text>
        <text x="125" y="28" fill="#166534" font-size="9" text-anchor="middle">get_latest_quiz_bundle_for_analysis ➔ 🎯 测验 XX分</text>
      </g>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>sequenceDiagram
    autonumber
    participant Client as React 18 (Workspace / QuizPanel)
    participant API as FastAPI Repo (apps/api-video)
    participant PG as PostgreSQL 16 (vidgrab Pool)

    Client->>API: 1. 携带 Bearer Token / Guest Session 请求总结或交卷
    API->>PG: 2. 写入 videos & analyses.result (JSONB 原子存储)
    Note over API,PG: 3. 交卷时同步写入 quiz_attempts 并更新 analyses.result->quiz_data
    API-->>Client: 4. 返回分析研报与测验评分明细
    Note over Client: 5. 双写落盘 localStorage (vidgrab_guest_history_v1 & vidgrab_quiz_v2_*)
    Client->>API: 6. VideoHistoryPage.tsx 查询历史学习记录
    Note over API,PG: 7. get_latest_quiz_bundle_for_analysis 自动补齐 🎯 测验 XX分</code></pre>
    </div>
  </details>
</div>

---

## 四、 数据契约与 PostgreSQL 16 核心模型 (`migrations/001_init.sql`)

数据库由 `apps/api-video/db.py` 在服务启动时自动探测并创建 `vidgrab` 数据库（`ensure_database_exists()`），随后通过 `run_migrations()` 自动按序执行 `apps/api-video/migrations/001_init.sql` 增量迁移并记录至 `schema_migrations` 表：

```sql
-- 1. 用户账号表（支持 user / admin / super_admin 角色与配额管理）
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user'   CHECK (role IN ('user', 'admin', 'super_admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  display_name  TEXT,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

-- 2. 视频记录表（去重视频源元数据、本地缓存路径、音视频时长与平台来源）
CREATE TABLE IF NOT EXISTS videos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL CHECK (source_type IN ('url', 'upload')),
  source_url        TEXT,
  platform          TEXT,
  title             TEXT,
  original_filename TEXT,
  duration_sec      REAL,
  storage_status    TEXT NOT NULL DEFAULT 'link_only'
                    CHECK (storage_status IN ('link_only', 'pending', 'transcoding', 'ready', 'failed', 'skipped')),
  storage_path      TEXT,
  original_bytes    BIGINT,
  storage_bytes     BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. AI 总结与研报分析表 (result 为 JSONB，原子存储研报、导图、双语字幕、chat_history 与 quiz_data)
CREATE TABLE IF NOT EXISTS analyses (
  id          TEXT PRIMARY KEY,
  video_id    UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  target_lang TEXT NOT NULL DEFAULT 'zh',
  prompt      TEXT,
  result      JSONB,
  error       TEXT,
  error_code  TEXT,
  timing      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- 4. AI 测验卷面表与 5. 测验提交评分表
CREATE TABLE IF NOT EXISTS quizzes (
  id                TEXT PRIMARY KEY,
  analysis_id       TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  estimated_minutes INT NOT NULL DEFAULT 15,
  questions         JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id         BIGSERIAL PRIMARY KEY,
  quiz_id    TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers    JSONB NOT NULL,
  result     JSONB NOT NULL,
  score      REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `analyses.result` (JSONB) 原子文档结构契约

`analyses.result` 利用 PostgreSQL 16 的 `JSONB` 特性，将一次视频学习的全部产出凝聚为自包含的知识快照：
- **四大篇章深度研报与流式分节**：`summary`、`sections`、`keypoints`、`timeline`、`outline_markdown`（思维导图 Markdown）；
- **双语时间轴字幕**：`subtitles`（包含 `start`、`end`、`text`、`translation`）；
- **多轮 AI 导师追问记录**：`chat_history`（每次对话完成后通过 `repo.py` 增量写回 JSONB）；
- **交互式学习测验与作答状态**：`quiz_data`（内嵌题目列表与 `user_state`，包含用户已选答案 `answers`、是否交卷 `submitted`、批改详情 `submitResult` 与最高得分 `score`）。即使历史记录中未显式内嵌 `quiz_data`，`repo.py` 中的 `get_latest_quiz_bundle_for_analysis()` 也会自动联表反查 `quizzes` 与 `quiz_attempts` 进行无感补齐。

---

## 五、 游客/登录双写持久化、连接池与安全机制 (Dual-Write & Concurrency Control)

### 1. 游客与登录态双重持久化 (`guestHistory.ts` + `QuizPanel.tsx` + `repo.py`)
- **宽裕的游客体验配额**：未登录游客默认享有每日 **30 次 AI 视频总结**与 **100 次 AI 导师追问**配额，与 SmartDiagram 主站 `readAuthSession` / `readGuestSession` 无缝衔接。
- **双写防丢失机制**：
  1. **服务端落盘**：无论是登录用户还是游客会话，总结结果、追问记录与测验交卷均实时写入服务端 PostgreSQL `vidgrab` 库；
  2. **客户端镜像缓存**：前端通过 `guestHistory.ts` 将学习记录实时同步至 `localStorage`（键名 `vidgrab_guest_history_v1`），同时 `QuizPanel.tsx` 将每道题的作答进度与批改结果持久化至 `vidgrab_quiz_v2_${taskId}`；
  3. **历史页统一聚合渲染 (`VideoHistoryPage.tsx`)**：合并服务端历史与本地缓存，完整呈现视频高清封面、平台徽章、研报摘要以及醒目的 **`🎯 测验 XX分`** 成绩徽章。

### 2. PostgreSQL 连接池与历史 SQLite 并发演进
- **当前生产方案 (`apps/api-video/db.py`)**：
  使用 `psycopg_pool.ConnectionPool(min_size=1, max_size=10, timeout=10, kwargs={"row_factory": dict_row, "autocommit": False})`。通过 `@contextmanager def db_cursor()` 自动管理连接借用、正常退出 `conn.commit()` 与异常 `conn.rollback()`，并自动隔离 `VIDEO_DATABASE_URL`（默认指向 `postgresql://postgres:***@127.0.0.1:5432/vidgrab`），避免与主站 Prisma 的 `?schema=public` 参数冲突。
- **历史演进对照（第一代 SQLite WAL 防锁经验沉淀）**：
  在早期单容器轻量版中，曾采用 `PRAGMA journal_mode = WAL` + `PRAGMA busy_timeout = 10000` + `threading.RLock()` 三重防御规避 `database is locked`；如今迁移至 PostgreSQL 16 MVCC（多版本并发控制）后，彻底消除了多进程写锁争用。

### 3. 密码学加固与级联保护
- **加盐散列与恒定时间校验**：采用 `bcrypt` 算法（Cost Factor 12）与 `bcrypt.checkpw()` 恒定时间比对，防御彩虹表与时序攻击（Timing Attack）。
- **外键级联清理 (`ON DELETE CASCADE`)**：`videos`、`analyses`、`quizzes`、`quiz_attempts`、`billing_users` 均绑定外键级联约束，删除用户或单条视频记录时自动清理所有派生的分析与测验数据，零孤儿脏数据残留。

---

## 六、 运维备份、恢复与全链路验收清单 (Backup, Recovery & Checklist)

### 1. PostgreSQL 16 在线逻辑热备份与历史 SQLite 备份对照

```bash
# 当前生产环境 (PostgreSQL 16 vidgrab 库)：执行无锁一致性在线逻辑备份
pg_dump -h 127.0.0.1 -p 5432 -U postgres -F c -b -v -f "vidgrab_backup_$(date +%Y%m%d).dump" vidgrab

# 一键恢复至指定实例
pg_restore -h 127.0.0.1 -p 5432 -U postgres -d vidgrab --clean --if-exists "vidgrab_backup_20261024.dump"

# [历史归档] 早期单文件 SQLite 在线无锁热备脚本参考
# python3 scripts/backup_sqlite.py
```

### 2. 核心功能验收测试用例表 (SmartDiagram v2.7.0)

| 序号 | 验证场景 | 输入条件与操作 | 预期技术行为与数据库状态 | 验收状态 |
| :---: | :--- | :--- | :--- | :---: |
| **TC-01** | 数据库与表结构自举 | 首次启动 `apps/api-video` 服务 | `ensure_database_exists()` 自动创建 `vidgrab` 库，`run_migrations()` 自动执行 `001_init.sql` | ✅ 通过 |
| **TC-02** | 邮箱大小写唯一约束 | 使用 `Admin@Test.com` 与 `admin@test.com` 注册 | 命中 `idx_users_email_lower` 唯一索引，拒绝重复注册 | ✅ 通过 |
| **TC-03** | JSONB 全量归档与追问持久化 | 完成视频总结并连续追问 3 轮 AI 导师 | `analyses.result` JSONB 完整包含研报、导图、字幕及最新 `chat_history` | ✅ 通过 |
| **TC-04** | 测验交卷双写与反查补齐 | 在 `QuizPanel.tsx` 提交测验并刷新页面 | `quiz_attempts` 入库，`analyses.result->quiz_data` 与 `vidgrab_quiz_v2_*` 同步更新，刷新后完整还原批改态 | ✅ 通过 |
| **TC-05** | 学习记录页测验徽章展示 | 打开 `VideoHistoryPage.tsx` 查看历史卡片 | 无论登录态或游客态，历史卡片均准确展示封面、摘要及 **`🎯 测验 XX分`** 徽章 | ✅ 通过 |
| **TC-06** | 级联物理删除完整性 | 删除某条历史学习记录或注销账号 | 关联的 `analyses`、`quizzes`、`quiz_attempts` 自动级联清除 | ✅ 通过 |
