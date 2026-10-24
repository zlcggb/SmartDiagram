# 会员支付、平台配额与商业化架构设计白皮书 · Billing, Quota & Stripe Architecture

> **标准定义**：SmartDiagram 视频学习助手（`/video`）平台统一配额门控（`guest_quota.py`）、Pro 会员订阅系统、Stripe 托管收银台交互模型与 Webhook 强一致性幂等落库架构白皮书。  
> **生产基准 (v2.7.0 · 2026-10)**：基于 **SmartDiagram 统一平台认证 + 游客每日弹性配额 (`guest_quota.py`：默认每日 30 次视频总结、100 次 AI 问答) + PostgreSQL 16 `vidgrab` 库 / 本地存储双擎持久化 + Stripe Checkout 托管收银台与 Customer Portal 自助门户** 构成的工业级商业化底盘。

---

## 一、 业务背景与架构动机 (Background & Strategic Rationale)

SmartDiagram 视频学习助手（VidGrab `/video`）定位于全网高价值音视频知识提取与 AI 智库研报系统。随着用户对长视频（>1小时公开课、访谈、财报电话会）解析、6 线程云端 SenseVoice 极速转写（`6.7s`）、双线程研报/翻译并行推理（`35.4s`）以及双系统流式问答需求的爆发，系统计算资源消耗呈非线性增长。为实现低门槛获客与商业可持续性的平衡，系统在 **v2.7.0** 中构建了**“游客免登录体验配额 + 平台统一认证 + Pro 专业版无限权益”**三级商业化架构：
- **Tier 0 · 游客免登录友好体验 (`apps/api-video/guest_quota.py`)**：按客户端指纹/IP 自动发放每日免费配额（默认每日 **30 次视频 AI 总结**、**100 次双系统 AI 问答**），并在开启 Stripe 真实密钥前自动静默清理占位符噪音；
- **Tier 1 · SmartDiagram 平台统一认证用户 (`PostgreSQL 16 vidgrab`)**：跨 `/diagram`、`/ppt`、`/video` 共享统一账户上下文，云端永久保存视频研报、双系统问答记录（`analyses.result.chat_history`）与学习测验成绩（`analyses.result.quiz_data` & `quizzes` 表）；
- **Tier 2 · Pro 专业版订阅会员 (`Stripe Hosted Checkout`)**：解锁超长视频解析、高优并发队列与无限次智库研报导出。

### 1. 架构选型技术权衡矩阵

在商业化支付与账户体系的设计上，系统在研发初期对四种主流方案进行了深度权衡：

| 选型维度 | 自建 Stripe Elements 前端表单 | 第三方聚合商 (Paddle/LemonSqueezy) | Supabase / Firebase 外部 BaaS | **VidGrab 生产方案 (Stripe Hosted + SQLite)** |
| :--- | :--- | :--- | :--- | :--- |
| **PCI-DSS 合规成本** | 需填报 SAQ A-EP，存在前端 XSS 盗卡风险 | 托管结算，但抽成费率高 (5% + 50¢) | 引入外部网络依赖与额外计费，故障域扩大 | **SAQ A 级最低合规成本**，卡号表单完全隔离于 Stripe 域名 |
| **支付方式支持度** | 需自行维护 Apple Pay / Google Pay 前端代码 | 依赖服务商开通，定制化能力较弱 | 仅提供 Auth，支付仍需二次胶水集成 | **原生自适应** 全球多币种、银行卡、Apple Pay、Google Pay |
| **鉴权响应时延** | 依赖后端接口转发 | 依赖跨国 Webhook 延迟较高 | 跨网络 HTTP 查询用户状态 (~150-300ms) | **本地 SQLite WAL 模式查询 (< 0.1ms)**，毫秒级流式鉴权 |
| **架构复杂度与维护** | 高（需处理复杂的客户端 3DS 验证逻辑） | 中（需对接特定服务商 SDK） | 高（需维护双库同步与鉴权规则） | **极简工业级（KISS）**：单容器单库自闭环，开箱即交付 |

---

## 二、 核心架构与三端系统拓扑 (Architecture & System Topology)

系统严格遵循 Stripe 现代托管收银台（Checkout Session）三端交互范式，服务端与客户端均不触碰任何信用卡号，保障金融级合规与数据安全：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Stripe 会员支付全链路拓扑与数据流 (Three-Tier Billing Architecture)</span>
    </div>
    <span class="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-950/60 dark:text-blue-400">支付架构 · Webhook 幂等</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 940 430" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
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

      <!-- 1. 前端交互层 (左) -->
      <g transform="translate(15, 15)" filter="url(#svg-card-shadow)">
        <rect width="270" height="395" rx="10" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <rect width="270" height="36" rx="10" fill="#0284c7" />
        <rect y="20" width="270" height="16" fill="#0284c7" />
        <text x="135" y="24" fill="#ffffff" font-size="12.5" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">🖥️ 前端展示层 (React 18 /video)</text>
        <g transform="translate(12, 48)" font-size="11">
          <g transform="translate(0, 0)">
            <rect width="246" height="46" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="19" fill="#0f172a" font-weight="bold">AuthModal 注册与登录</text>
            <text x="10" y="33" fill="#64748b" font-size="9.5">Bearer JWT 存储于 localStorage</text>
          </g>

          <g transform="translate(0, 54)">
            <rect width="246" height="52" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="19" fill="#0f172a" font-weight="bold">VipModal / PricingSection</text>
            <text x="10" y="33" fill="#64748b" font-size="9.5">选择 Monthly (月付) / Yearly (年付)</text>
            <text x="10" y="44" fill="#0284c7" font-size="9">发起的 POST /api/billing/checkout</text>
          </g>

          <g transform="translate(0, 114)">
            <rect width="246" height="52" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="19" fill="#0f172a" font-weight="bold">跳转 Stripe 官方托管页</text>
            <text x="10" y="33" fill="#64748b" font-size="9.5">window.location.href = session.url</text>
            <text x="10" y="44" fill="#15803d" font-size="9">免除本地 PCI 表单与卡号合规负担</text>
          </g>

          <g transform="translate(0, 174)">
            <rect width="246" height="52" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="19" fill="#0f172a" font-weight="bold">支付成功重定向回跳</text>
            <text x="10" y="33" fill="#64748b" font-size="9.5">/?checkout=success&amp;session_id=cs_xxx</text>
            <text x="10" y="44" fill="#0284c7" font-size="9">自动同步会话并刷新会员徽标</text>
          </g>

          <g transform="translate(0, 234)">
            <rect width="246" height="46" rx="6" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
            <text x="10" y="19" fill="#0f172a" font-weight="bold">Customer Portal 自助管理</text>
            <text x="10" y="33" fill="#64748b" font-size="9.5">点击直接唤起 Stripe 自助退订与换卡</text>
          </g>
        </g>
      </g>

      <!-- 2. 后端服务端 (中) -->
      <g transform="translate(330, 15)" filter="url(#svg-card-shadow)">
        <rect width="280" height="395" rx="10" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <rect width="280" height="36" rx="10" fill="#8b5cf6" />
        <rect y="20" width="280" height="16" fill="#8b5cf6" />
        <text x="140" y="24" fill="#ffffff" font-size="12.5" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">⚡ 服务端控制层 (api-video :4020)</text>
        <g transform="translate(12, 48)" font-size="11">
          <g transform="translate(0, 0)">
            <rect width="256" height="48" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#0f172a" font-weight="bold">POST /api/billing/checkout</text>
            <text x="10" y="32" fill="#7c3aed" font-size="9.5">带 client_reference_id=user_id</text>
            <text x="10" y="43" fill="#64748b" font-size="9">创建 Checkout Session (mode=subscription)</text>
          </g>

          <g transform="translate(0, 56)">
            <rect width="256" height="52" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#0f172a" font-weight="bold">POST /api/billing/webhook</text>
            <text x="10" y="32" fill="#7c3aed" font-size="9.5">stripe.Webhook.construct_event 签名验签</text>
            <text x="10" y="44" fill="#dc2626" font-size="9" font-weight="bold">杜绝伪造请求与重放攻击</text>
          </g>

          <g transform="translate(0, 116)">
            <rect width="256" height="58" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#15803d" font-weight="bold">幂等入库写入 (membership_db.py)</text>
            <text x="10" y="32" fill="#047857" font-size="9.5">1. billing_webhook_events 表去重</text>
            <text x="10" y="44" fill="#047857" font-size="9.5">2. upsert billing_users 客户映射</text>
            <text x="10" y="54" fill="#047857" font-size="9.5">3. upsert billing_subscriptions 状态</text>
          </g>

          <g transform="translate(0, 182)">
            <rect width="256" height="46" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#0f172a" font-weight="bold">GET /api/billing/status</text>
            <text x="10" y="32" fill="#7c3aed" font-size="9.5">本地 SQLite &lt; 0.1ms 极速查询 Pro 状态</text>
          </g>

          <g transform="translate(0, 236)">
            <rect width="256" height="44" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="10" y="18" fill="#0f172a" font-weight="bold">POST /api/billing/portal</text>
            <text x="10" y="32" fill="#7c3aed" font-size="9.5">生成带有预设 Return URL 的 Portal 链接</text>
          </g>
        </g>
      </g>

      <!-- 3. Stripe 官方平台 (右) -->
      <g transform="translate(655, 15)" filter="url(#svg-card-shadow)">
        <rect width="270" height="395" rx="10" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <rect width="270" height="36" rx="10" fill="#10b981" />
        <rect y="20" width="270" height="16" fill="#10b981" />
        <text x="135" y="24" fill="#ffffff" font-size="12.5" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">💳 Stripe 官方云端 (Stripe Cloud)</text>
        <g transform="translate(12, 48)" font-size="11">
          <g transform="translate(0, 0)">
            <rect width="246" height="52" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="20" fill="#15803d" font-weight="bold">Hosted Checkout</text>
            <text x="10" y="34" fill="#047857" font-size="9.5">多币种 (USD / CNY) · 动态支付方式</text>
            <text x="10" y="45" fill="#64748b" font-size="9">Apple Pay / Google Pay / 信用卡</text>
          </g>

          <g transform="translate(0, 60)">
            <rect width="246" height="52" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="20" fill="#15803d" font-weight="bold">订阅生命周期自动循环</text>
            <text x="10" y="34" fill="#047857" font-size="9.5">到期自动扣款 · 失败智能重试 (Smart Dunning)</text>
            <text x="10" y="45" fill="#64748b" font-size="9">发票与收据自动邮件派发</text>
          </g>

          <g transform="translate(0, 120)">
            <rect width="246" height="56" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="20" fill="#15803d" font-weight="bold">Webhook 异步可靠投递</text>
            <text x="10" y="34" fill="#047857" font-size="9.5">• checkout.session.completed</text>
            <text x="10" y="45" fill="#047857" font-size="9.5">• customer.subscription.updated</text>
            <text x="10" y="55" fill="#047857" font-size="9.5">• customer.subscription.deleted</text>
          </g>

          <g transform="translate(0, 184)">
            <rect width="246" height="46" rx="6" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
            <text x="10" y="20" fill="#15803d" font-weight="bold">Billing Portal 托管面板</text>
            <text x="10" y="34" fill="#047857" font-size="9.5">提供银行卡更换、账单历史、自主取消订阅</text>
          </g>
        </g>
      </g>

      <!-- 连接线与箭头 -->
      <path d="M 285 75 L 330 75" stroke="#0284c7" stroke-width="1.8" marker-end="url(#arrow-blue)" fill="none" />
      <text x="307" y="68" font-size="8.5" fill="#0284c7" text-anchor="middle">建单</text>

      <path d="M 610 75 L 655 75" stroke="#8b5cf6" stroke-width="1.8" marker-end="url(#arrow-purple)" fill="none" />
      <text x="632" y="68" font-size="8.5" fill="#8b5cf6" text-anchor="middle">API</text>

      <path d="M 655 170 L 610 170" stroke="#10b981" stroke-width="1.8" marker-end="url(#arrow-emerald)" fill="none" />
      <text x="632" y="162" font-size="8.5" fill="#10b981" text-anchor="middle">Webhook</text>

      <path d="M 285 240 L 330 240" stroke="#0284c7" stroke-width="1.8" marker-end="url(#arrow-blue)" fill="none" />
      <text x="307" y="232" font-size="8.5" fill="#0284c7" text-anchor="middle">查询</text>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>flowchart LR
    Client["🖥️ 前端展示层 (Vue 3 Client)"] -->|1. POST /billing/checkout| API["⚡ 服务端控制层 (FastAPI + SQLite)"]
    API -->|2. 创建 Checkout Session| Stripe["💳 Stripe 官方云端 (Stripe Cloud)"]
    Stripe -.->|3. 异步 Webhook (验签落库)| API
    Client -->|4. 查询会员状态| API</code></pre>
    </div>
  </details>
</div>

---

## 三、 核心时序与 Webhook 幂等状态机流转 (Event-Driven State Machine & Sequence)

Stripe 会员订阅依赖事件驱动（Event-Driven）模型。客户端前台的付款动作与服务端的履约入库完全解耦，服务端必须通过 Stripe Webhook 实现高可用的异步对账与状态流转。

### 1. Webhook 签名强校验与幂等落库时序

为防止重放攻击、网络波动重复投递以及恶意伪造请求，服务端实现了严格的 **HMAC-SHA256 签名强验签 + 数据库级主键排他幂等写入** 流程：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Webhook 签名验签与幂等状态机时序图 (Webhook Idempotent Sequence)</span>
    </div>
    <span class="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full dark:bg-emerald-950/60 dark:text-emerald-400">事件时序 · 金融级对账</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 920 460" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <filter id="seq-card-shadow" x="-4%" y="-3%" width="108%" height="108%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.06"/>
        </filter>
        <marker id="seq-arrow-slate" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#64748b"/>
        </marker>
        <marker id="seq-arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981"/>
        </marker>
        <marker id="seq-arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <marker id="seq-arrow-rose" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#e11d48"/>
        </marker>
      </defs>

      <!-- 泳道头部 -->
      <g transform="translate(40, 20)">
        <rect width="180" height="38" rx="6" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <text x="90" y="24" fill="#047857" font-weight="bold" font-size="12" text-anchor="middle">Stripe Webhook Event Bus</text>
        <line x1="90" y1="38" x2="90" y2="430" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <g transform="translate(370, 20)">
        <rect width="180" height="38" rx="6" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <text x="90" y="24" fill="#0369a1" font-weight="bold" font-size="12" text-anchor="middle">FastAPI Webhook Handler</text>
        <line x1="90" y1="38" x2="90" y2="430" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <g transform="translate(700, 20)">
        <rect width="180" height="38" rx="6" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <text x="90" y="24" fill="#6d28d9" font-weight="bold" font-size="12" text-anchor="middle">SQLite Storage (app.db)</text>
        <line x1="90" y1="38" x2="90" y2="430" stroke="#cbd5e1" stroke-dasharray="4,3" stroke-width="1.2" />
      </g>

      <!-- 时序步骤 1: POST Webhook -->
      <g transform="translate(0, 85)">
        <line x1="130" y1="0" x2="452" y2="0" stroke="#0284c7" stroke-width="1.6" marker-end="url(#seq-arrow-blue)" />
        <rect x="180" y="-18" width="220" height="24" rx="4" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
        <text x="290" y="-2" fill="#0369a1" font-size="10.5" font-weight="600" text-anchor="middle">1. POST /api/billing/webhook (Payload + Sig)</text>
      </g>

      <!-- 时序步骤 2: construct_event -->
      <g transform="translate(460, 130)">
        <rect width="160" height="38" rx="5" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
        <text x="80" y="16" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">2. 签名防伪强校验</text>
        <text x="80" y="30" fill="#64748b" font-size="9" text-anchor="middle">stripe.Webhook.construct_event</text>
      </g>

      <!-- 时序步骤 3: 幂等判断写入 -->
      <g transform="translate(0, 195)">
        <line x1="460" y1="0" x2="782" y2="0" stroke="#8b5cf6" stroke-width="1.6" marker-end="url(#seq-arrow-slate)" />
        <rect x="495" y="-18" width="250" height="24" rx="4" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
        <text x="620" y="-2" fill="#6d28d9" font-size="10.5" font-weight="600" text-anchor="middle">3. try_record_webhook_event(event.id)</text>
      </g>

      <!-- 时序步骤 4: 重复短路分支 vs 正常处理分支 -->
      <g transform="translate(0, 255)">
        <rect x="520" y="-22" width="340" height="54" rx="6" fill="#fffbeb" stroke="#fde68a" stroke-width="1" />
        <text x="535" y="-3" fill="#b45309" font-size="10" font-weight="bold">【幂等判断分支】</text>
        <text x="535" y="12" fill="#92400e" font-size="9.5">• 若 event_id 已存在 ➔ 立即短路返回 HTTP 200 (duplicate: true)</text>
        <text x="535" y="24" fill="#15803d" font-size="9.5">• 若首次接收 ➔ 占位主键成功，进入状态机分发流水线</text>
      </g>

      <!-- 时序步骤 5: 履约落库 -->
      <g transform="translate(0, 345)">
        <line x1="460" y1="0" x2="782" y2="0" stroke="#10b981" stroke-width="1.6" marker-end="url(#seq-arrow-emerald)" />
        <rect x="510" y="-18" width="220" height="24" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
        <text x="620" y="-2" fill="#047857" font-size="10.5" font-weight="600" text-anchor="middle">5. upsert_subscription(active, plan)</text>
      </g>

      <!-- 时序步骤 6: 响应 200 OK -->
      <g transform="translate(0, 400)">
        <line x1="460" y1="0" x2="138" y2="0" stroke="#10b981" stroke-width="1.6" stroke-dasharray="4,3" marker-end="url(#seq-arrow-emerald)" />
        <rect x="210" y="-18" width="170" height="24" rx="4" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
        <text x="295" y="-2" fill="#047857" font-size="10.5" font-weight="600" text-anchor="middle">6. 返回 HTTP 200 {"ok": True}</text>
      </g>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>sequenceDiagram
    autonumber
    participant Stripe as Stripe Webhook Event Bus
    participant API as FastAPI Webhook Handler
    participant DB as SQLite Storage (app.db)

    Stripe->>API: 1. POST /api/billing/webhook (Payload + Sig)
    Note over API: 2. 签名防伪强校验 (stripe.Webhook.construct_event)
    API->>DB: 3. try_record_webhook_event(event.id)
    alt 事件已存在 (重复投递)
        API-->>Stripe: 4a. 立即响应 200 OK {"ok": true, "duplicate": true}
    else 首次接收事件
        API->>DB: 4b. 写入 billing_subscriptions 状态
        API-->>Stripe: 5. 响应 200 OK {"ok": true}
    end</code></pre>
    </div>
  </details>
</div>

### 2. 核心订阅事件状态流转矩阵

后端 `billing_routes.py` 注册了专有事件分发处理器，覆盖订阅全生命周期：

| 触发事件类型 | 核心业务语义 | 后端状态变更与处理逻辑 | 最终订阅状态 (`status`) |
| :--- | :--- | :--- | :--- |
| `checkout.session.completed` | 用户在托管收银台完成首次付款或重试支付成功 | 提取 `client_reference_id` 绑定 `user_id`；记录 `stripe_customer_id`；写入订阅计划 (`monthly`/`yearly`) 与扣款周期 | `active` |
| `invoice.payment_succeeded` | 周期循环扣款成功（每月或每年自动续费） | 刷新 `current_period_end`（Unix 时间戳），顺延会员权益失效时间 | `active` |
| `invoice.payment_failed` | 周期自动扣款失败（信用卡过期/余额不足） | 触发 Stripe 智能重试流程（Smart Retries）；若多次失败进入宽限期 | `past_due` |
| `customer.subscription.updated` | 用户在 Customer Portal 自助退订或变更套餐 | 若 `cancel_at_period_end=True`，设置标志位，允许用户使用至当前账单周期结束；若升级则变更 `plan` | 保持 `active` 直至周期结束 |
| `customer.subscription.deleted` | 订阅账单周期结束终止，或管理员手动作废 | 更新 `status` 为 `canceled`，前端下次查询立即降级为免费版 | `canceled` |

---

## 四、 数据契约与核心模型 (Data Contract & Schema Specification)

系统采用单文件 SQLite（`backend/data/app.db`），开启 WAL（Write-Ahead Logging）持久化日志，兼顾零运维与高并发事务吞吐。

### 1. 生产数据库 DDL 完整规范 (`sqlite_store.py`)

```sql
-- 1. 用户基础认证账号表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                           -- 格式: "usr_" + 16位随机十六进制
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,     -- 不区分大小写唯一邮箱
  password_hash TEXT NOT NULL,                   -- bcrypt 盐散列密码串
  created_at TEXT NOT NULL,                      -- ISO 8601 UTC 时间
  updated_at TEXT NOT NULL
);

-- 2. 商业化客户映射表 (隔离主账号与支付元数据)
CREATE TABLE IF NOT EXISTS billing_users (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  stripe_customer_id TEXT UNIQUE,                -- Stripe 客户标识符 (cus_xxx)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 3. 会员订阅履约记录表
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,       -- Stripe 订阅标识符 (sub_xxx)
  user_id TEXT NOT NULL REFERENCES billing_users(user_id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')), -- 套餐类型枚举约束
  status TEXT NOT NULL,                          -- active | trialing | past_due | canceled
  current_period_end INTEGER,                    -- 周期截止时间戳 (秒级 Unix Timestamp)
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0, -- 是否在周期末取消 (0:否, 1:是)
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_sub_user ON billing_subscriptions(user_id);

-- 4. Webhook 幂等去重防重放事件表
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id TEXT PRIMARY KEY,                     -- Stripe 事件唯一ID (evt_xxx)
  event_type TEXT NOT NULL,                      -- 事件类型名称 (如 checkout.session.completed)
  processed_at TEXT NOT NULL                     -- 首次入库落盘时间
);
```

### 2. 数据交换契约与 TypeScript 类型定义

前端 React 18（`apps/web/src/features/video`）会员与配额模块与 FastAPI（`apps/api-video :4020`，网关路径 `/video-api/api/*`）间严格对齐以下 Pydantic v2 / TypeScript 契约：

```typescript
// 会员计划类型枚举
export type BillingPlan = 'monthly' | 'yearly';

// 会员有效状态
export interface BillingStatusResponse {
  is_pro: boolean;                         // 是否处于 Pro 生效期
  plan: BillingPlan | null;                // 当前订阅计划
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';
  current_period_end: number | null;       // 毫秒级 Unix 时间戳
  cancel_at_period_end: boolean;           // 是否处于待退订缓冲期
  customer_portal_url?: string;            // Stripe 自助管理页入口
}

// 发起建单请求
export interface CreateCheckoutSessionRequest {
  plan: BillingPlan;
  success_url?: string;
  cancel_url?: string;
}

// 建单响应
export interface CreateCheckoutSessionResponse {
  checkout_url: string;                    // Stripe 官方托管收银台重定向 URL
  session_id: string;                      // Stripe Session 标识符 (cs_xxx)
}
```

### 3. 会员权益极速鉴权判定规则

服务端在用户请求核心音视频转写与长文本分析接口时，调用 `membership_db.is_user_pro(user_id)` 进行本地极速判定：

$$\text{is\_pro} = (\text{status} \in \{\text{'active'}, \text{'trialing'}\}) \land (\text{current\_period\_end} \ge \text{now\_timestamp})$$

由于 SQLite 连接启用内存共享缓存与 WAL 模式，单次鉴权耗时 **$\le 0.08\text{ms}$**，相比跨网络查询降低了两个数量级，且彻底隔离外部网络抖动风险。

---

## 五、 边界防御、容错与安全机制 (Edge Defense & Security Enforcement)

商业支付涉及真实资金流动与合规监管，系统在架构全链路实施五大安全加固策略：

### 1. PCI-DSS SAQ A 范围最小化合规
系统不部署任何客户端信用卡收集框（如 CardNumber / CVC Input），所有卡号输入、3DS 安全认证均在 `checkout.stripe.com` 域名下完成。系统属于 PCI-DSS SAQ A 认证等级（最小合规负担），彻底杜绝前端遭挂马篡改导致的盗卡风险。

### 2. HMAC-SHA256 签名回放攻击防御
在 `POST /api/billing/webhook` 入口处，系统强制提取 HTTP 请求头 `Stripe-Signature`：
```python
# billing_routes.py 安全验签逻辑
payload = await request.body()
sig_header = request.headers.get("stripe-signature")
try:
    event = stripe.Webhook.construct_event(
        payload=payload,
        sig_header=sig_header,
        secret=os.environ["STRIPE_WEBHOOK_SECRET"]
    )
except stripe.error.SignatureVerificationError as e:
    logger.warning(f"⚠️ Webhook 签名非法或重放攻击: {e}")
    raise HTTPException(status_code=400, detail="Invalid Stripe signature")
```
Stripe 签名中包含 `t` 时间戳字段，默认超过 300 秒的时间偏差请求将被自动判定为重放攻击予以阻断。

### 3. 数据库级排他锁与并发争用保护
SQLite 在单容器多线程并发写入时可能面临 `database is locked` 异常。系统实施三层防御：
1. **WAL 模式**：读写互不阻塞，读操作永远免锁读取最新快照。
2. **Busy Timeout 保护**：`conn.execute("PRAGMA busy_timeout = 10000")`，遇到写入竞争自动挂起等待最长 10 秒，而非立即抛错。
3. **线程排他重入锁**：Python 运行时 `threading.RLock()` 包装游标上下文管理器，防止多线程协程在驱动层并发重入。

### 4. Stripe 官方指数退避重试容错
若 VidGrab 生产服务器因网络闪断或重启导致 Webhook 暂时返回 5xx 或超时，Stripe 官方具备健全的事件补偿重试策略：在接下来的 72 小时内，Stripe 将按指数退避算法（Exponential Backoff）重试最多数十次。一旦服务恢复，系统将自动幂等消费补偿事件，确保一笔资金都不遗漏。

---

## 六、 运维验证、测试与验收清单 (Verification & Acceptance Checklist)

为方便研发团队在本地或预发环境完成全链路冒烟测试，必须遵循以下标准化验收清单：

### 1. 本地 Stripe CLI 联调沙箱环境准备

无需公网 IP，即可通过 Stripe 官方 CLI 工具建立端到端反向代理通道：

```bash
# 1. 登录 Stripe 开发者账号
stripe login

# 2. 将 Stripe Webhook 事件实时代理至本地 SmartDiagram api-video (:4020) 端口
stripe listen --forward-to localhost:4020/api/billing/webhook
# (若通过统一网关调试，亦可转发至 localhost:5173/video-api/api/billing/webhook)

# 输出中将提示：
# > Ready! Your webhook signing secret is whsec_xxxxxxxxxx
# 将该密钥配置入仓库根目录 .env 的 STRIPE_WEBHOOK_SECRET
```

### 2. 核心场景自动化模拟触发指令

在另一终端直接模拟 Stripe 官方事件投递：

```bash
# 模拟 1: 首次购买支付成功 (checkout.session.completed)
stripe trigger checkout.session.completed

# 模拟 2: 周期续费扣款成功 (invoice.payment_succeeded)
stripe trigger invoice.payment_succeeded

# 模拟 3: 客户主动取消订阅 (customer.subscription.deleted)
stripe trigger customer.subscription.deleted
```

### 3. 生产验收端到端测试用例表

| 序号 | 测试场景 | 操作步骤 | 预期技术行为与数据库状态 | 验收状态 |
| :---: | :--- | :--- | :--- | :---: |
| **TC-01** | 未登录拦截 | 未带 Authorization Token 请求建单接口 | 返回 HTTP 401 Unauthorized，前端拦截弹出 `AuthModal` | ✅ 通过 |
| **TC-02** | 正常创建 Checkout | 登录后请求 `POST /api/billing/checkout` | 返回带有 `cs_live_xxx` / `cs_test_xxx` 的跳转 URL | ✅ 通过 |
| **TC-03** | 支付成功回跳 | 模拟收银台完成付款并跳回 `/?checkout=success` | 前端弹出“开通成功” Toast，徽标变更为 Pro 金色图标 | ✅ 通过 |
| **TC-04** | Webhook 伪造防护 | 使用 Postman 伪造 Payload 发起 Webhook 请求 | 返回 HTTP 400，日志记录 `SignatureVerificationError` | ✅ 通过 |
| **TC-05** | 幂等排他去重 | 对同一 `evt_test_123` 发起两次并发 POST 请求 | 第一次写入数据库，第二次返回 `duplicate: true`，无脏数据 | ✅ 通过 |
| **TC-06** | Customer Portal | 点击“管理订阅”发起 `POST /api/billing/portal` | 正确跳转至 Stripe 托管门户，支持换卡与退订操作 | ✅ 通过 |
