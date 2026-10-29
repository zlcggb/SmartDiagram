# SmartDiagram AI 智能体专项评测与全链路质量工程白皮书

> **文档性质**：SmartDiagram 多智能体协同办公与可视化平台（涵盖 `/diagram` 10 路图表引擎、`/ppt` AI 演示文稿、`/recruit` AI 招聘初筛、`/video` 视频学习助手）的 **AI Agent 质量工程基准规范（QA & Evaluation Baseline Specification v2.9.0 · 2026-10）**。  
> **核心理念**：坚守 **“用零 LLM 开销的确定性工程护栏（Guardrails）收敛非确定性概率生成，以毫秒级离线双轨评测（83 样本）+ 流式混沌故障注入（Playwright E2E）+ 异步高并发压测（50 路 SSE）驱动持续交付”** 的第一性质量工程原则。

---

## 全景架构拓扑：六维一体 AI 质量工程防御矩阵

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">SmartDiagram v2.9.0 AI 智能体专项评测与全链路质量工程架构图 (End-to-End QA &amp; Evaluation Architecture)</span>
    </div>
    <span class="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full dark:bg-emerald-950/60 dark:text-emerald-400">83 样本双轨评测 · 19 算子自愈 · 50 路 SSE 并发 · 207 单测</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 1080 460" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[820px] text-xs">
      <defs>
        <filter id="qa-card-shadow" x="-4%" y="-3%" width="108%" height="108%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.06"/>
        </filter>
        <marker id="qa-arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <marker id="qa-arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981"/>
        </marker>
        <marker id="qa-arrow-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6"/>
        </marker>
        <marker id="qa-arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b"/>
        </marker>
      </defs>

      <!-- 模块 1：四层测试金字塔 (左上) -->
      <g transform="translate(16, 16)" filter="url(#qa-card-shadow)">
        <rect width="332" height="202" rx="10" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
        <rect width="332" height="32" rx="10" fill="#0284c7" />
        <rect y="18" width="332" height="14" fill="#0284c7" />
        <text x="14" y="21" fill="#ffffff" font-size="11.5" font-weight="bold" font-family="-apple-system, sans-serif">🏛️ 1. 四层测试金字塔 (Test Pyramid · 207 Pytest + TS)</text>
        <g transform="translate(12, 40)" font-family="-apple-system, sans-serif" font-size="10">
          <rect width="308" height="34" rx="5" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
          <text x="8" y="15" fill="#0369a1" font-weight="bold">L1 双栈单测与契约审计 (207 Pytest + 6 包 TS 单测)</text>
          <text x="8" y="28" fill="#475569" font-size="9">Env 契约 · bash -n · Prisma 破坏性 SQL 拦截 · SVG 计算几何</text>

          <rect y="40" width="308" height="34" rx="5" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
          <text x="8" y="55" fill="#0369a1" font-weight="bold">L2 离线确定性 Agent 评测 (83 样本 · P50 &lt; 1.3ms)</text>
          <text x="8" y="68" fill="#475569" font-size="9">图表多智能体 (53) + 招聘/视频/PPT 跨模块多模态 (30)</text>

          <rect y="80" width="308" height="34" rx="5" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
          <text x="8" y="95" fill="#0369a1" font-weight="bold">L3 零外部 LLM E2E 与异步 SSE 并发压测</text>
          <text x="8" y="108" fill="#475569" font-size="9">Playwright 6 场景故障注入 + 50 路并发 (3,611+ streams/s)</text>

          <rect y="120" width="308" height="34" rx="5" fill="#ffffff" stroke="#bae6fd" stroke-width="1" />
          <text x="8" y="135" fill="#0369a1" font-weight="bold">L4 生产容器探活与 7 大业务域 Smoke 冒烟</text>
          <text x="8" y="148" fill="#475569" font-size="9">enterprise · knowledge · runtime · office · recruit · budget · ops</text>
        </g>
      </g>

      <!-- 模块 2：四层确定性收敛漏斗 (中上) -->
      <g transform="translate(374, 16)" filter="url(#qa-card-shadow)">
        <rect width="332" height="202" rx="10" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <rect width="332" height="32" rx="10" fill="#10b981" />
        <rect y="18" width="332" height="14" fill="#10b981" />
        <text x="14" y="21" fill="#ffffff" font-size="11.5" font-weight="bold" font-family="-apple-system, sans-serif">🛡️ 2. 四层确定性收敛漏斗 (Pass@1 0% ➔ Pass@Repair 100%)</text>
        <g transform="translate(12, 40)" font-family="-apple-system, sans-serif" font-size="10">
          <rect width="308" height="34" rx="5" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
          <text x="8" y="15" fill="#047857" font-weight="bold">① StreamingTagParser (流式边界与增量图元提取)</text>
          <text x="8" y="28" fill="#475569" font-size="9">30 字符安全窗口 · _brace_depth 括号计数 · 剥离寒暄与围栏</text>

          <rect y="40" width="308" height="34" rx="5" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
          <text x="8" y="55" fill="#047857" font-weight="bold">② Validator Agent (零 LLM AST/Schema/安全校验)</text>
          <text x="8" y="68" fill="#475569" font-size="9">9 大引擎结构校验 · ECharts JS 函数阻断 · HTML XSS 扫描</text>

          <rect y="80" width="308" height="34" rx="5" fill="#ecfdf5" stroke="#34d399" stroke-width="1.2" />
          <text x="8" y="95" fill="#065f46" font-weight="bold">③ Repair Agent (19 条确定性修复算子 · 耗时 0.035ms)</text>
          <text x="8" y="108" fill="#047857" font-size="9">自动补齐 nodes/edges、闭合 &lt;/mxfile&gt;、转义 Mermaid 边括号</text>

          <rect y="120" width="308" height="34" rx="5" fill="#ffffff" stroke="#a7f3d0" stroke-width="1" />
          <text x="8" y="135" fill="#047857" font-weight="bold">④ Consistency Agent (RAG 强约束词抗幻觉阻断)</text>
          <text x="8" y="148" fill="#475569" font-size="9">核查 required/forbidden_terms ➔ 异常触发 needs_user_input</text>
        </g>
      </g>

      <!-- 模块 3：83 样本双轨评测集 (右上) -->
      <g transform="translate(732, 16)" filter="url(#qa-card-shadow)">
        <rect width="332" height="202" rx="10" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <rect width="332" height="32" rx="10" fill="#8b5cf6" />
        <rect y="18" width="332" height="14" fill="#8b5cf6" />
        <text x="14" y="21" fill="#ffffff" font-size="11.5" font-weight="bold" font-family="-apple-system, sans-serif">📊 3. 双轨量化评测基准体系 (83 样本 = 53 + 30 · 100%)</text>
        <g transform="translate(12, 40)" font-family="-apple-system, sans-serif" font-size="10">
          <rect width="308" height="38" rx="5" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
          <text x="8" y="15" fill="#6d28d9" font-weight="bold">图表多智能体基准 (53 样本: 33 Golden + 20 Badcase)</text>
          <text x="8" y="29" fill="#475569" font-size="9">6 大指标 100% 达标 · P50 0.033ms / P95 0.203ms</text>

          <rect y="44" width="308" height="34" rx="5" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
          <text x="8" y="59" fill="#6d28d9" font-weight="bold">AI 招聘 Rubric-v3 专项评测 (10 样本 · 100%)</text>
          <text x="8" y="72" fill="#475569" font-size="9">无原文证据强制降级 level=1 · Knockout 一票否决封顶 ≤59 分</text>

          <rect y="84" width="308" height="34" rx="5" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
          <text x="8" y="99" fill="#6d28d9" font-weight="bold">视频助手 System 1/2 门控与测验评测 (13 样本 · 100%)</text>
          <text x="8" y="112" fill="#475569" font-size="9">先验正则 + Jeff 零样本误判门控修正回 video_qa + 4 题型判分</text>

          <rect y="124" width="308" height="30" rx="5" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
          <text x="8" y="143" fill="#6d28d9" font-weight="bold">PPT LangGraph Send 扇出扇入与单页容错 (7 样本 · 100%)</text>
        </g>
      </g>

      <!-- 模块 4：Playwright SSE 混沌故障注入 (左下) -->
      <g transform="translate(16, 242)" filter="url(#qa-card-shadow)">
        <rect width="332" height="202" rx="10" fill="#fffbeb" stroke="#f59e0b" stroke-width="1.5" />
        <rect width="332" height="32" rx="10" fill="#f59e0b" />
        <rect y="18" width="332" height="14" fill="#f59e0b" />
        <text x="14" y="21" fill="#ffffff" font-size="11.5" font-weight="bold" font-family="-apple-system, sans-serif">🎭 4. Playwright Web UI 与 SSE 混沌故障注入 (6/6 PASS)</text>
        <g transform="translate(12, 40)" font-family="-apple-system, sans-serif" font-size="10">
          <rect width="308" height="34" rx="5" fill="#ffffff" stroke="#fde68a" stroke-width="1" />
          <text x="8" y="15" fill="#b45309" font-weight="bold">SpaTestServer + Headless Chromium (零外部 LLM)</text>
          <text x="8" y="28" fill="#475569" font-size="9">内置轻量级 SPA History 路由静态服 + page.route 帧级拦截</text>

          <rect y="40" width="308" height="34" rx="5" fill="#ffffff" stroke="#fde68a" stroke-width="1" />
          <text x="8" y="55" fill="#b45309" font-weight="bold">场景 1~2：多工作台导航保活 &amp; 标准 SSE 全链路</text>
          <text x="8" y="68" fill="#475569" font-size="9">KeepAliveWorkspace 切换 + 遥测事件流驱动画布渲染</text>

          <rect y="80" width="308" height="34" rx="5" fill="#ffffff" stroke="#fde68a" stroke-width="1" />
          <text x="8" y="95" fill="#b45309" font-weight="bold">场景 3~4：流中途 Error 熔断 &amp; 半截畸形 JSON 帧容错</text>
          <text x="8" y="108" fill="#475569" font-size="9">验证 isStreaming 复位不卡死、processSSELine 忽略坏帧继续渲染</text>

          <rect y="120" width="308" height="34" rx="5" fill="#ffffff" stroke="#fde68a" stroke-width="1" />
          <text x="8" y="135" fill="#b45309" font-weight="bold">场景 5~6：HTTP 429 突发限流提示 &amp; 502 重试自愈</text>
          <text x="8" y="148" fill="#475569" font-size="9">全套 6 场景总耗时 ~2.9s，Flaky 抖动率 0%</text>
        </g>
      </g>

      <!-- 模块 5：50 路异步高并发与护栏压测 (中下) -->
      <g transform="translate(374, 242)" filter="url(#qa-card-shadow)">
        <rect width="332" height="202" rx="10" fill="#eef2ff" stroke="#6366f1" stroke-width="1.5" />
        <rect width="332" height="32" rx="10" fill="#6366f1" />
        <rect y="18" width="332" height="14" fill="#6366f1" />
        <text x="14" y="21" fill="#ffffff" font-size="11.5" font-weight="bold" font-family="-apple-system, sans-serif">⚡ 5. 异步多租户 SSE 高并发压测基准 (5/5 PASS · ~50ms)</text>
        <g transform="translate(12, 40)" font-family="-apple-system, sans-serif" font-size="10">
          <rect width="308" height="34" rx="5" fill="#ffffff" stroke="#c7d2fe" stroke-width="1" />
          <text x="8" y="15" fill="#4338ca" font-weight="bold">50 路并发 SSE 吞吐: 3,611+ streams/s · 92,951+ chunks/s</text>
          <text x="8" y="28" fill="#475569" font-size="9">TTFT P50 0.19~0.21ms · 增量提取 65 图元 · 成功率 100%</text>

          <rect y="40" width="308" height="34" rx="5" fill="#ffffff" stroke="#c7d2fe" stroke-width="1" />
          <text x="8" y="55" fill="#4338ca" font-weight="bold">100 并发 5 租户突发限流: 放行 40/40 · 拦截 60/60</text>
          <text x="8" y="68" fill="#475569" font-size="9">滑动窗口水位线精度 100.0% · 跨租户串扰 0 · P95 0.41ms</text>

          <rect y="80" width="308" height="34" rx="5" fill="#ffffff" stroke="#c7d2fe" stroke-width="1" />
          <text x="8" y="95" fill="#4338ca" font-weight="bold">30 并发 StreamLoopGuard &amp; 40 并发 Token 预算三级矩阵</text>
          <text x="8" y="108" fill="#475569" font-size="9">死循环熔断 100% (拦截 4040 事件) · 18k 降级 / 32k 硬阻断 100%</text>

          <rect y="120" width="308" height="34" rx="5" fill="#ffffff" stroke="#c7d2fe" stroke-width="1" />
          <text x="8" y="135" fill="#4338ca" font-weight="bold">40 并发 Redis 断连混沌注入: memory_fallback 100%</text>
          <text x="8" y="148" fill="#475569" font-size="9">Fail-Open 无缝回退本地内存限流 (放行 24/24, 拦截 16/16)</text>
        </g>
      </g>

      <!-- 模块 6：左移门禁、脱敏告警与 HTML 大盘 (右下) -->
      <g transform="translate(732, 242)" filter="url(#qa-card-shadow)">
        <rect width="332" height="202" rx="10" fill="#fdf2f8" stroke="#db2777" stroke-width="1.5" />
        <rect width="332" height="32" rx="10" fill="#db2777" />
        <rect y="18" width="332" height="14" fill="#db2777" />
        <text x="14" y="21" fill="#ffffff" font-size="11.5" font-weight="bold" font-family="-apple-system, sans-serif">🚀 6. 左移门禁、脱敏自诊断与离线 HTML 总控大盘</text>
        <g transform="translate(12, 40)" font-family="-apple-system, sans-serif" font-size="10">
          <rect width="308" height="34" rx="5" fill="#ffffff" stroke="#fbcfe8" stroke-width="1" />
          <text x="8" y="15" fill="#be185d" font-weight="bold">Git pre-push 本地 8 秒极速门禁 (local-preflight.sh)</text>
          <text x="8" y="28" fill="#475569" font-size="9">Env 契约 + Shell 语法 + 破坏性 SQL 扫描 + Pytest + Strict Eval</text>

          <rect y="40" width="308" height="34" rx="5" fill="#ffffff" stroke="#fbcfe8" stroke-width="1" />
          <text x="8" y="55" fill="#be185d" font-weight="bold">GitHub Actions 4-Job 并发门禁 (qa-ci.yml)</text>
          <text x="8" y="68" fill="#475569" font-size="9">自动将评测报告渲染至 $GITHUB_STEP_SUMMARY 并归档构件</text>

          <rect y="80" width="308" height="34" rx="5" fill="#ffffff" stroke="#fbcfe8" stroke-width="1" />
          <text x="8" y="95" fill="#be185d" font-weight="bold">remote-deploy.sh + deploy-notify.sh 脱敏自诊断</text>
          <text x="8" y="108" fill="#475569" font-size="9">镜像预构建后再备份 · ERR Trap 0600 报告 · [REDACTED] 告警</text>

          <rect y="120" width="308" height="34" rx="5" fill="#fdf2f8" stroke="#f472b6" stroke-width="1.2" />
          <text x="8" y="135" fill="#9d174d" font-weight="bold">离线可交互 HTML 质量总控大盘 (latest_qa_dashboard.html)</text>
          <text x="8" y="148" fill="#be185d" font-size="9">聚合 4 大评测/E2E/压测报告 · 零 CDN 依赖 · 严防 XSS 转义</text>
        </g>
      </g>

      <!-- 模块间流转箭头 -->
      <path d="M 348 117 L 372 117" fill="none" stroke="#0284c7" stroke-width="2" marker-end="url(#qa-arrow-blue)" />
      <path d="M 706 117 L 730 117" fill="none" stroke="#10b981" stroke-width="2" marker-end="url(#qa-arrow-emerald)" />
      <path d="M 348 343 L 372 343" fill="none" stroke="#f59e0b" stroke-width="2" marker-end="url(#qa-arrow-amber)" />
      <path d="M 706 343 L 730 343" fill="none" stroke="#8b5cf6" stroke-width="2" marker-end="url(#qa-arrow-purple)" />
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>flowchart LR
    P1["1. 四层测试金字塔 (207 Pytest + TS)"] --> P2["2. 四层确定性收敛漏斗 (19 算子自愈)"]
    P2 --> P3["3. 83 样本双轨评测基准 (53 图表 + 30 多模态)"]
    P4["4. Playwright SSE 混沌注入 (6 场景)"] --> P5["5. 50 路异步 SSE 并发压测 (3,611+ streams/s)"]
    P5 --> P6["6. Git pre-push + 脱敏告警 + HTML 总控大盘"]</code></pre>
    </div>
  </details>
</div>

---

## 一、 架构背景与第一性原理：为什么传统软件测试测不动大模型与多智能体？

在传统确定性软件工程中，质量保障建立在 **「给定输入 $X$，系统必然走确定性分支并输出唯一精确的字符串 $Y$」** 的假设之上。然而，当系统演进为以 **SmartDiagram** 为代表的企业级多智能体协同办公平台（融合 `/diagram` 10 路图表生成、`/ppt` 智能演示文稿、`/recruit` AI 招聘初筛、`/video` 视频学习助手）时，传统黑盒与接口测试面临四大结构性失效：

1. **概率生成与语法契约的天然冲突（Non-Determinism vs. Strict Schema）**：  
   大语言模型（LLM）本质上是基于自回归采样（Temperature $> 0$）的概率状态机。同一句自然语言指令，每次生成的节点文案、拓扑坐标都不同，导致传统的 `assert response == expected_str` 或 UI 像素截图对比（Pixel Diff）100% 失效；与此同时，下游渲染引擎（Mermaid、React Flow、Excalidraw、ECharts、Draw.io XML、SmartSlide IR）却要求 **100% 零容忍的严格语法契约**——哪怕多包了一层 ` ```json ` 围栏、漏写了一个 `edges: []` 空数组或未转义边标签括号，都会直接引发前端画布白屏崩溃。
2. **多智能体长链路耦合导致排障黑盒化（Multi-Agent Orchestration Opacity）**：  
   一次生成请求需跨越「意图路由（Router）$\rightarrow$ 复杂度规划（Planner）$\rightarrow$ 企业 RAG 权限检索（Knowledge）$\rightarrow$ 领域生成（Engine Agent）$\rightarrow$ 语法校验与自愈（Validator & Repair）$\rightarrow$ 知识一致性核查（Consistency）$\rightarrow$ 导出渲染（Export）」。若只做端到端黑盒抽测，一旦输出异常，根本无法区分是 **Router 切题死锁、RAG 检索越界/超时、模型幻觉编造证据，还是 SSE 流式半截断帧**。
3. **真实 LLM 调用的“慢、贵、抖（Flaky）”无法充当 CI/CD 秒级门禁**：  
   如果自动化测试直接调用公网大模型 API，单次流式生成耗时 $5\sim 20\text{s}$，跑完几十条用例动辄十几分钟且受制于公网限流抖动；一旦本地门禁超过 15 秒，研发人员就会使用 `--no-verify` 绕过门禁，导致带病代码频繁合入。
4. **多模态跨业务域的特殊幻觉与安全红线**：  
   在 AI 招聘初筛中，LLM 可能“无中生有”替候选人捏造项目经历（幻觉抬分）或无视学历/届次硬性门槛；在视频助手快慢双系统中，零样本小模型可能将普通内容提问误判为“下载视频”；在办公 HTML 与 ECharts 生成中，模型输出可能夹带 `<script>`、`javascript:` 伪协议或可执行 `function()` 造成 XSS 攻击。

### SmartDiagram 质量工程的三大第一性破局原则

- **原则一：用确定性工程护栏（Guardrails）收敛非确定性概率生成** —— 绝不信任 LLM 的裸输出直接上画布，也不靠昂贵慢速的二次 LLM 重试去赌概率；而是在 LangGraph 编排内部后置零 Token 开销的 **`Validator + Repair (19 算子) + Consistency`** 状态机，将概率性输出收敛为 100% 合规的结构化产物。
- **原则二：将外部 LLM I/O 与节点决策逻辑彻底解耦（Offline Deterministic Harness）** —— 把测试左移至白盒节点契约与合成故障载荷层，构建 **83 样本双轨评测基准（53 图表域 + 30 多模态域）**，在纯内存环境下以毫秒级（P50 `< 1.3ms`）完成 100% 确定性门禁考核。
- **原则三：用帧级故障注入与异步高并发压测验证极端边界（Chaos & Concurrency Engineering）** —— 通过 Playwright `page.route` 帧级 SSE 故障注入模拟断流/坏帧/429/502，结合 `asyncio` 50 路并发 SSE 压测与 100 并发多租户限流压测，确保系统在弱网、死循环风暴与 Redis 宕机时具备 100% 韧性。

---

## 二、 四层确定性收敛漏斗：`StreamingTagParser` + `Validator Agent` + `Repair Agent` (19 条自愈算子) + `Consistency Agent`

在 `apps/api-diagram/app/agents/orchestrator.py` 与 `apps/api-diagram/app/api/routes.py` 中，任何大模型生成的图表或办公产物都必须依次穿过以下 **四层零 LLM 开销的确定性收敛漏斗**，才能推送至前端画布或进入导出队列：

### 2.1 第一层：协议与流式边界解析器（`StreamingTagParser`）

大模型在流式吐字（SSE `text/event-stream`）时，常在 `<design_concept>` 与 `<code>` 标签前后夹带寒暄废话，或将标签跨多个网络 Chunk 截断（例如前一个 Chunk 结尾是 `<design_`，后一个 Chunk 开头是 `concept>`）。
- **30 字符安全缓冲窗口**：`StreamingTagParser`（位于 `apps/api-diagram/app/api/routes.py`）维护滑动缓冲区 `safe_len = max(0, len(self.buffer) - 30)`，确保跨 Chunk 标签 100% 精准识别，绝不漏标或将标签碎片直接吐给前端。
- **字符级大括号深度计数（`_brace_depth`）增量提取**：针对 React Flow 与 Excalidraw 等 JSON 图元引擎，解析器在 `<code>` 流尚未结束时，通过跟踪字符串转义状态（`in_string`、`escape`）与大括号嵌套深度（`brace_depth`），每当闭合一个顶层图元对象即实时发射 `{"type": "element"}` 事件，实现画布毫秒级渐进式渲染。

### 2.2 第二层：零 LLM 确定性语法与安全校验器（`Validator Agent`）

当模型完成输出后，工作流进入 `validator_agent_node`（`apps/api-diagram/app/agents/validator_agent.py`），底层调用 `validate_output(engine_type, code)`（`apps/api-diagram/app/services/output_validation.py`）：
- 按目标引擎（`mermaid`、`flow`、`excalidraw`、`charts`、`drawio`、`mindmap`、`infographic`、`html_email`、`web_report_html`）执行严格的 AST / JSON Schema / XML 根节点校验。
- 执行 **安全红线扫描**：递归扫描 ECharts JSON 树拦截可执行 JS 函数（`_contains_executable_js` 正则匹配 `\bfunction\s*\(|=>`），扫描 Office HTML 产物拦截非白名单外链（`_unsafe_links` 仅允许 `https://`、`mailto:`、`/`、`#`）及高危标签（`html_policy.py` 阻断 `<script>`、`<iframe>`、`<object>`、`<embed>`、`<form>` 与内联 `on*=` 事件）。
- 输出结构化 `ValidationResult(ok, engine_type, errors, warnings, normalized_code, repairable)`。

### 2.3 第三层：19 条确定性算子自愈引擎（`Repair Agent`）

针对 `Validator Agent` 检出的可修复结构性瑕疵（`repairable=True`），`repair_agent_node`（`apps/api-diagram/app/agents/repair_agent.py`）立即调用 `repair_output`（`apps/api-diagram/app/services/output_repair.py` 与 `mermaid_sanitizer.py`），通过 **19 条确定性修复算子** 进行毫秒级外科手术式自愈，并在修复后自动重跑 `validate_output` 二次确认：

| 序号 | 规则标识 (`rule_id`) | 适用引擎 | 根治的大模型高频非确定性通病与自愈逻辑 | 评测集触发频次 |
|:---:|---|---|---|:---:|
| 1 | `common.strip_code_fences` | 全引擎通用 | 剥离模型在 `<code>` 内部重复包裹的 ```` ```json ```` / ```` ```xml ```` 围栏 | 10 |
| 2 | `mermaid.trimmed_code_fences` | `mermaid` | 清理 Mermaid 源码首尾残留的 Markdown 围栏与空白行 | 2 |
| 3 | `mermaid.quote_flowchart_edge_labels` | `mermaid` | 自动为含括号/斜杠/冒号的高风险边标签（如 `-->|审批(通过)|`）补齐双引号转义 | 1 |
| 4 | `mermaid.stabilize_flowchart_edges` | `mermaid` | 将包含复杂特殊字符的行内边标签重构为独立的关系中间件节点 `Rel_N["..."]:::relation` | 1 |
| 5 | `flow.add_missing_nodes` | `flow` | 当 React Flow JSON 缺失 `nodes` 列表时，自动补齐合法空数组或默认节点列表 | 2 |
| 6 | `flow.add_missing_edges` | `flow` | 当 React Flow JSON 仅生成节点漏写 `edges` 字段时，自动补齐 `"edges": []` | 2 |
| 7 | `excalidraw.wrap_single_element` | `excalidraw` | 当模型只返回单个图元 `dict` 而非数组时，自动封装为 `[element]` 列表 | 1 |
| 8 | `excalidraw.add_empty_elements` | `excalidraw` | 当返回对象缺少 `elements` 键时，自动补齐 `"elements": []` 容器契约 | 1 |
| 9 | `charts.add_empty_series` | `charts` | 当 ECharts 配置缺失核心 `series` 数组（且无 JS 注入风险）时，补齐 `"series": []` | 1 |
| 10 | `drawio.add_missing_closing_mxfile` | `drawio` | 当 Draw.io XML 因长文本截断漏掉末尾闭合标签时，自动补齐 `</diagram></mxfile>` | 2 |
| 11 | `mindmap.add_root_heading` | `mindmap` | 当思维导图列表未以 `# ` 一级 Markdown 标题起始时，自动注入 `# 核心主题` 根节点 | 1 |
| 12 | `infographic.wrap_value` | `infographic` | 当信息图 DSL 缺失顶层结构或语法头时，自动包装合规容器结构 | 1 |
| 13 | `office.set_artifact_type` | `html_email` / `web_report_html` | 自动校准或补齐办公产物 JSON 中的 `artifact_type` 字段契约 | 2 |
| 14 | `office.title_default` | `html_email` / `web_report_html` | 缺失文档标题 `title` 时，按上下文自动注入默认合规标题 | 1 |
| 15 | `office.email_subject_default` | `html_email` | 商务 HTML 邮件缺失 `subject` 主题行时，自动衍生默认邮件主题 | 1 |
| 16 | `office.add_sections_from_body` | `html_email` | 模型将正文直接写在顶层 `body` 而非 `sections` 数组时，自动转换为标准段落区块 | 1 |
| 17 | `office.normalize_unsafe_href` | `html_email` / `web_report_html` | 将 CTA 按钮中的 `http://` 升级或将非安全/未知外链清洗替换为安全锚点 `#` | 1 |
| 18 | `office.remove_unsupported_section_type` | `web_report_html` | 过滤模型臆造的未知区块类型，保留合法的 `hero`/`metrics`/`table`/`callout` 等区块 | 1 |
| 19 | `office.wrap_plain_section` | `web_report_html` | 将散落的字符串条目自动封装为标准结构化 `section` 对象 | 1 |

> **量化成效（`Pass@1` vs `Pass@Repair`）**：在收录的 **17 个线上真实可自愈残缺样本** 中，原始模型输出的首次合格率 **`Pass@1` 为 `0.00%`**（100% 触发前端解析异常），经 `Repair Agent` 的 19 条算子自愈后，**`Pass@Repair` 跃升至 `100.00%`（17/17）**，单样本平均自愈耗时仅 **`0.035ms`**，零额外 LLM Token 消耗。

### 2.4 第四层：RAG 知识库一致性抗幻觉核查器（`Consistency Agent`）

在企业级场景下，语法合法并不代表业务合规。`consistency_agent_node`（`apps/api-diagram/app/agents/consistency_agent.py`）调用 `check_knowledge_consistency`（`apps/api-diagram/app/services/knowledge_consistency.py`）：
- 自动从 `knowledge_agent` 检索出的授权知识切片（`chunks`）中提取显式强约束指令（正则匹配 `required_terms` / `必须包含` / `关键节点` 与 `forbidden_terms` / `禁止包含` / `不得包含`）。
- 对生成代码执行归一化与去空白双模匹配（`_term_in_code`），精确计算 **`coverage_ratio`（必选术语覆盖率）**。
- 一旦发现任何 `missing_required_terms`（如漏掉“法务复核”节点）或 `forbidden_terms_present`（如泄露“内部底价”），立即将 `needs_user_input` 置为 `True`，在条件边 `route_after_consistency` 中 **直接短路切向 `END`，阻断 `export_agent` 自动导出**，并向前端推送带知识库溯源引用（`citations`）的告警卡片。

---

## 三、 双轨评测基准体系（83 样本）：图表多智能体（53 样本）+ 跨模块多模态办公 Agent（30 样本）

为彻底告别“改完 Prompt 靠肉眼抽测”的粗放模式，我们在 `apps/api-diagram/evals/` 下构建了零外部 LLM 依赖、可嵌入 Git 门禁的 **83 样本双轨量化评测基准体系**，由图表多智能体套件（`evaluator.py`，53 样本）与跨模块多模态套件（`multimodal_evaluator.py`，30 样本）共同组成。

### 3.1 第一轨：图表多智能体专项评测（53 样本 = 33 Golden Cases + 20 Badcases）

运行 `npm run eval:agent`（底层调用 `scripts/run_agent_evals.py --strict`），对 `datasets/golden_cases.jsonl`（33 条正向基准）与 `datasets/badcases.jsonl`（20 条缺陷与红队回归）进行考核，节点耗时 **P50 `0.033ms` / P95 `0.203ms`**：

| 序号 | 核心量化指标 | 样本数 | 实测得分 | 准出红线 (`--strict`) | 考核技术锚点 |
|:---:|---|:---:|:---:|:---:|---|
| 1 | **意图路由准确率** (`intent_routing_accuracy`) | 14 | **`100.00%`** | `>= 95.0%` | 覆盖 10 大引擎 `@tag` 短路、关键词计分、多轮 `current_engine` 上下文延续与中途强关键词切题 |
| 2 | **任务规划与 RAG 门控准确率** (`planner_rag_gate_accuracy`) | 7 | **`100.00%`** | `>= 95.0%` | 考核 `planner_agent.py` 新建/编辑模式推断、复杂度分级与企业域 RAG 按需启停门控 |
| 3 | **RAG 知识一致性抗幻觉准确率** (`knowledge_consistency_accuracy`) | 6 | **`100.00%`** | `>= 95.0%` | 考核 `required_terms` 覆盖率计算、`forbidden_terms` 违规检出及 `needs_user_input` 导出阻断 |
| 4 | **运行时安全与注入护栏拦截率** (`security_guardrail_block_rate`) | 6 | **`100.00%`** | `== 100.0%` | 考核滑动窗口限流、大上下文 Token 预算降级/熔断、Redis Fail-Open 回退与 HTML 策略拦截 |
| 5 | **可修复 Badcase 自愈率** (`Pass@1` $\rightarrow$ `Pass@Repair`) | 17 | **`0.0%` $\rightarrow$ `100.0%`** | `>= 95.0%` | 考核 9 大渲染引擎 17 类结构残缺样本经 19 条规则修复后的二次校验通过率 |
| 6 | **恶意安全 Badcase 阻断率** (`unrepairable_security_badcase_block_rate`) | 3 | **`100.00%`** | `== 100.0%` | 考核 ECharts `function(params)` / `=>` 箭头函数注入与 HTML `<script>` / `javascript:` 100% 阻断 |

### 3.2 第二轨：跨模块多模态办公 Agent 专项评测（30 样本 = 招聘 10 + 视频 13 + PPT 7）

运行 `npm run eval:multimodal`（底层调用 `scripts/run_multimodal_evals.py --strict`），对 `datasets/multimodal_cases.jsonl` 中的三大多模态办公业务域进行白盒确定性评测，**30/30 样本 100% 通过**（P50 `1.284ms` / P95 `14.487ms`）：

#### （1）AI 招聘初筛 `Rubric-v3` 防幻觉证据降级与一票否决熔断（`recruit_ats_rubric` · 10 样本）
在 `apps/api-diagram/app/services/recruit_Screening_service.py`（及 `recruit_ats_service.py`）中，针对大模型简历评估最致命的 **“编造简历原文抬高打分（Hallucination）”** 与 **“忽略硬性门槛（Knockout）”** 两大痛点，设计了严密的后置确定性护栏：
- **证据原文定位防幻觉降级（`REC-002` ~ `REC-004`）**：`Rubric-v3` 要求 LLM 对每个能力维度给出 `0~3` 级评分时，必须附带简历原文引用 `evidence`。后置校验器调用 `_evidence_exists_in_resume(evidence, resume_text)`：若 LLM 给出高分（`level >= 2`），但提供的 `evidence` 有效字符长度 `< 4` 或在候选人真实简历原文中找不到高达标匹配（即 LLM 捏造了“千万级 RAG 架构”或“跨国联邦学习”经历），系统**强制将该维度评分降级为 `level = 1`（仅概念提及）**，并在审计日志中追加 `"[防幻觉降级：原评分缺乏简历原文证据支撑，已自动降级]"`（拦截率 **`100.00%`**）。
- **Knockout 一票否决硬顶熔断（`REC-005` ~ `REC-007`）**：针对学历（如要求本科但候选人为大专，或要求硕士但候选人为本科）与毕业届次（如要求 2027 届校招但候选人为 2025 届往届生）等一票否决项（`knockout_results`），即便候选人技术能力得分高达 `94` 分，一旦任一 Knockout 项 `passed=False`，系统强制触发 `capped = True`，**将总分封顶在 `<= 59.0` 分（直接归入 `D` 档淘汰）**（封顶准确率 **`100.00%`**）。
- **加分项最高分取优与无 LLM 规则兜底（`REC-008` ~ `REC-010`）**：验证多项 Bonus 同时命中仅取最高单向加分，以及当外部 LLM 不可用时 `build_fallback_rubric` + `assess_by_rule` 与 ATS 评分融合的 100% 确定性兜底。

#### （2）视频学习助手 System 1/2 意图先验与 Jeff 零样本门控修正（`video_intent_and_quiz` · 13 样本）
在 `apps/api-video/services/intent_router.py` 与 `quiz_generator.py` 中，验证快慢双系统认知路由与智能测验判分：
- **第一层高确定性先验路由（`VID-001` ~ `VID-006`）**：毫秒级精准分流时间戳跳转（`seek_player`，提取 `target_time` 秒数）、随堂测验生成（`make_quiz`）、多语种翻译（`translate`）、本地下载（`download`）、日常寒暄（`chitchat`），以及宏观总结提问自动归入 `video_qa` 且设置 `needs_transcript=False`（免除注入万字长字幕，大幅节省 Token 与首字延迟）。
- **第二层 `Jeff` 零样本误判门控修正与超时降级（`VID-007` ~ `VID-009`）**：当第一层未命中、交由本地零样本分类模型 `Jeff (:8001, gliformer-large-v1)` 推理时，若 `Jeff` 将普通内容提问（如“视频里提到的缓存击穿怎么解决？”）误判为功能类意图 `download`，或以低置信度（`< 0.78`）将含时间戳的细节追问判为 `seek_player`，后置语义锚点门控（动作词校验 + `0.78` 阈值）会 **100% 将其拦截并归正回 `video_qa`**；当 `Jeff` 服务超时抛出异常时，自动优雅降级至 `video_qa (fallback=True)`。
- **四题型智能测验确定性判分（`VID-010` ~ `VID-013`）**：覆盖单选题（字母与选项前缀映射）、多选题（漏选/错选严格判 0 分，支持文本与字母混合匹配）、判断题（支持 `×`/`false`/`错` 归一化匹配）与简答题（标点归一化与多同义备选答案命中），加权百分制四舍五入准确率 **`100.00%`**。

#### （3）PPT LangGraph `Send` 扇出扇入并行编排与单页异常隔离（`ppt_langgraph_pipeline` · 7 样本）
在 `apps/api-ppt/src/ppt_agent_api/agents/graph.py` 中，验证基于 LangGraph `Send` API 的多页并发生成状态机：
- **多模式路由与状态复用（`PPT-001` ~ `PPT-005`）**：全面覆盖 `topic` 全链路模式（`interview -> research -> outline -> N页并行 search -> N页并行 draft -> N页并行 design -> finalize`）、`paste` 粘贴资料模式（自动跳过 `brief` 与 `research`）、`draft` 草稿模式与 `skip_design=True`（在 `fan_out_design` 阶段直接短路跳向 `finalize`），以及已有大纲的增量复用编排。
- **单页渲染异常隔离与全页检索熔断（`PPT-006` ~ `PPT-007`）**：当并发执行的第 2 页 `design_page` 抛出异常时，节点捕获异常写入 `errors` 列表，**绝不阻断第 1 页和第 3 页并行完成渲染与最终汇总**；而当所有页面的前置检索 `search_page` 全部失败时，`fan_out_draft` 触发熔断保护直接跳转 `finalize`，防止在无上下文状态下盲目调用大模型烧钱。

---

## 四、 Playwright Web UI 自动化与 SSE 流式混沌故障注入（`SpaTestServer` + 6 大端到端韧性场景）

传统 Web UI 自动化在测试 AI 流式应用时，常因依赖真实后端与大模型而陷入“启动重、耗时长、无法复现半途断流”的泥潭。我们在 `apps/api-diagram/e2e/` 下构建了基于 **Headless Chromium + `SpaTestServer` + `sse_fault_injector.py`** 的零外部 LLM 依赖端到端测试套件（运行 `npm run test:e2e`，总耗时仅 **`2.93s`**，**6/6 场景 100% 通过**）。

### 4.1 架构设计：`SpaTestServer` 与 `page.route` 确定性帧注入

1. **内置多线程 `SpaTestServer`（`test_playwright_e2e.py`）**：测试启动时自动在随机空闲端口拉起支持 HTML5 History API 回退（SPA Fallback）的轻量静态服务器托管 `apps/web/dist` 生产构建产物，无需启动庞大的 Docker 容器集群。
2. **确定性 SSE 故障注入器（`apps/api-diagram/e2e/sse_fault_injector.py`）**：利用 Playwright 的 `page.route("**/api/chat/stream", ...)` 拦截前端流式请求，按预设剧本吐出精确到字节的 `text/event-stream` 二进制帧序列（涵盖 `route`、`planner_plan`、`knowledge_context`、`design_start/design/design_end`、`code_start/code/code_complete/code_end`、`validator_agent`、`repair_agent`、`consistency_agent`、`error`）。

### 4.2 六大端到端 UI 与流式混沌注入场景矩阵

| 场景编号 | 测试用例标识 | 注入故障类型 (`Fault Injection`) | 核心验证断言（前端状态机与 DOM 韧性） | 实测耗时 | 结果 |
|:---:|---|---|---|:---:|:---:|
| **场景 1** | `test_e2e_home_and_multi_module_navigation` | 无（多工作台挂载与路由切换） | 验证统一桌面壳 `AppShell` 正常挂载，跨 `/diagram` 等模块路由切换无白屏、无 Console Error | `223.8ms` | **PASS** |
| **场景 2** | `test_e2e_diagram_sse_happy_path_and_agent_telemetry` | `healthy_flow_sse_stream` | 注入完整多智能体遥测帧序列，验证前端实时展示 Agent 思考步骤并将 React Flow 图表成功渲染上画布 | `991.8ms` | **PASS** |
| **场景 3** | `test_e2e_sse_midstream_error_graceful_handling` | `midstream_error_sse_stream` | 在吐出半截 `code` 后突然注入 `RuntimeGuardError: StreamLoopGuard max_events exceeded`，断言前端捕获错误、展示可读提示且 **`finally` 块将 `isStreaming` 复位为 `false`（发送按钮恢复可用，绝不无限转圈）** | `175.4ms` | **PASS** |
| **场景 4** | `test_e2e_sse_malformed_truncated_frame_resilience` | `malformed_frame_recovery_sse_stream` | 在流中间插入缺失右括号的损坏帧 `data: {"type":"code","content":"unterminated...`，验证 `processSSELine` 捕获 JSON 解析异常并忽略坏帧，后续正常帧依然驱动画布完成渲染 | `172.3ms` | **PASS** |
| **场景 5** | `test_e2e_http_429_rate_limit_guard_feedback` | `rate_limit_429_response` (`HTTP 429`) | 注入 `status=429` 与 `{"detail":{"reason":"rate_limited","retry_after_seconds":18}}`，验证前端正确解析非 200 限流响应并向用户展示配额冷却提示 | `174.7ms` | **PASS** |
| **场景 6** | `test_e2e_http_502_fault_recovery_on_retry` | `gateway_502_response` $\rightarrow$ `healthy_flow_sse_stream` | 首次请求注入 `HTTP 502 Bad Gateway` 触发异常兜底，二次请求自动切换路由为健康流，验证用户再次发送后画布状态从失败平滑自愈至完成态 | `232.5ms` | **PASS** |

---

## 五、 异步多租户 SSE 高并发吞吐与运行时护栏压测基准（`sse_concurrency_bench.py`）

为了验证后端流式解析器与运行时护栏（`runtime_guard_service.py`）在高并发风暴下的吞吐极限、限流精度与故障容灾能力，我们在 `apps/api-diagram/evals/benchmark/sse_concurrency_bench.py` 中研发了基于 `asyncio.gather` 的纯异步压测引擎（运行 `npm run bench:sse`，套件总耗时 **`49.73ms`**，**5/5 压测场景 100% 达标**）。

### 5.1 五大高并发与混沌韧性压测成绩单

| 压测场景 ID | 场景名称与并发规模 | 核心吞吐量 / 拦截精度实测指标 | 延迟分布 (P50 / P95 / P99) | 门禁结论 |
|---|---|---|---|---|
| **`sse_stream_50_concurrent_throughput`** | **50 路并发 SSE 流式分片解析与增量图元提取压测**（覆盖 `flow`/`excalidraw`/`mermaid`/`drawio` 四大引擎，共 `1,287` 个随机长度碎片 Chunk） | 流吞吐量：**`3,611.17 streams/s`**<br/>分片吞吐量：**`92,951.59 chunks/s`**<br/>首字延迟 (TTFT)：**P50 `0.207ms` / P95 `0.330ms`**<br/>增量提取图元：`65` 个，成功率 **`100.0% (50/50)`** | `12.608ms` / `13.481ms` / `13.495ms` | **PASS** |
| **`multi_tenant_burst_rate_limit_precision`** | **100 并发 5 租户突发流量滑动窗口限流精度压测**（5 个独立租户 `tenant-bench-1~5`，单窗口配额 `limit=8`，每租户瞬间并发打入 `20` 请求） | 精确放行：**`40/40`**（每租户严格放行前 8 个）<br/>精确拦截：**`60/60`**（每租户严格拦截后 12 个）<br/>限流水位线精度：**`100.0%`**，跨租户串扰：**`0`** | `0.289ms` / `0.406ms` / `0.416ms` | **PASS** |
| **`concurrent_stream_loop_guard_breaker`** | **30 并发流式死循环风暴下的 `StreamLoopGuard` 熔断压测**（15 路正常 8 节点流 + 15 路恶意重入/超长死循环流混合并发） | 正常流完成：**`15/15`（误杀率 `0.0%`）**<br/>死循环流熔断：**`15/15`（熔断率 `100.0%`）**<br/>成功拦截无效事件：**`4,040` 个**（防止算力耗尽） | `0.187ms` / `0.541ms` / `0.542ms` | **PASS** |
| **`token_budget_degradation_and_hard_stop_matrix`** | **40 并发多轮长上下文 Token 预算三级矩阵压测**（软降级线 `18,000 tokens`，硬阻断线 `32,000 tokens`） | 正常放行 (`normal`)：**`15/15`**<br/>自动平滑降级 (`degraded=True`)：**`15/15`**<br/>超限硬阻断 (`hard_stop`)：**`10/10`**<br/>三级预算分类准确率：**`100.0% (40/40)`** | `6.838ms` / `29.444ms` / `31.957ms` | **PASS** |
| **`redis_outage_memory_fallback_chaos`** | **40 并发 Redis 断连故障注入下的 `memory_fallback` 韧性压测**（底层注入 `ConnectionRefusedError` 与 `TimeoutError`） | 自动触发 Fail-Open 回退：**`40/40 (100.0%)`**<br/>回退态内存限流准确性：放行 **`24/24`**，拦截 **`16/16`**<br/>未捕获崩溃异常：**`0` 个** | `0.350ms` / `0.507ms` / `0.581ms` | **PASS** |

---

## 六、 质量左移门禁（`.git/hooks/pre-push`）、远程一键部署（`remote-deploy.sh`）、故障自诊断脱敏告警（`deploy-notify.sh`）与离线 HTML 质量总控大盘（`latest_qa_dashboard.html`）

我们将上述评测、单测、E2E 与压测能力全面编织进研发日常提交与生产交付流水线，构建了“左移预防 + 过程阻断 + 生产自诊断 + 可视化总控”的完整工程闭环：

### 6.1 开发者本地 8 秒左移门禁（`scripts/local-preflight.sh`）
通过执行 `npm run preflight:install-hook`，将 `local-preflight.sh --fast` 挂载至 `.git/hooks/pre-push`。开发者每次执行 `git push` 时，系统在 **8 秒内** 自动完成五步预检：
1. `.env.example` 环境变量契约完整性校验；
2. 仓库全部 `*.sh` 运维与部署脚本 `bash -n` 语法静态检查；
3. `prisma/migrations/*/migration.sql` 破坏性 SQL 静态审计（正则严禁未授权的 `DROP TABLE`、`TRUNCATE`、`DELETE FROM`）；
4. Python 双栈核心单元测试（`apps/api-diagram/tests` + `apps/api-ppt/tests`，共 **207 项 Pytest 用例**）；
5. AI Agent 专项评测严格门禁（`run_agent_evals.py --strict`）。

### 6.2 远程一键安全部署与“镜像预构建后再备份”防呆设计（`remote-deploy.sh` & `deploy.sh`）
- **本地门禁先行**：执行 `npm run deploy:remote`（`scripts/remote-deploy.sh`）时，必须先通过本地 `local-preflight.sh --fast` 门禁，随后通过 SSH 校验远端工作区干净度并触发 `./deploy.sh --update --with-worker`。
- **先构建镜像、再执行备份**：在 `deploy.sh` 中，我们将 `DEPLOY_STAGE="image_build"` 置于 `data_backup` 之前——只有当全部应用容器镜像编译成功后，才执行 PostgreSQL 数据库快照备份与迁移（迁移期间自动 `pause_writers`，完成后 `resume_writers` 并强制 `force-recreate gateway` 刷新 Nginx 上游 DNS 缓存），彻底根治“因代码编译失败反复重试导致无效备份撑爆服务器磁盘”的运维事故。

### 6.3 故障自诊断报告与多层正则脱敏告警（`scripts/deploy-notify.sh`）
- **Bash `ERR` Trap 自动接管**：`deploy.sh` 顶部挂载 `trap 'on_error "$LINENO"' ERR`。一旦任何阶段失败，立即恢复写容器并生成权限严格受控（目录 `0700` / 文件 `0600`，且防 `../` 路径穿越）的诊断报告 `backups/deploy-reports/deploy-latest.md/.json`（含失败阶段、失败行号、Git SHA、`df -h` 磁盘余量、容器状态表与异常容器尾部 60 行日志），并由 `remote-deploy.sh` 自动拉回本地终端展示。
- **敏感凭证 100% 自动脱敏（`scrub_text`）**：在写入磁盘报告或推送飞书 / 企业微信 / 钉钉 / Slack Webhook（强制校验仅允许 `https://`）前，自动扫描环境变量中匹配 `KEY|SECRET|PASSWORD|TOKEN|DSN|DATABASE_URL|WEBHOOK` 的敏感值及 `sk-*`、数据库连接串密码、Bearer Token，全部替换为 `[REDACTED]`。

### 6.4 离线可交互 HTML 质量总控大盘（`latest_qa_dashboard.html`）
运行 `npm run qa:dashboard`（底层调用 `apps/api-diagram/scripts/generate_qa_dashboard.py`），系统自动聚合 **图表 Agent 评测（53 样本）+ 跨模块多模态评测（30 样本）+ Playwright SSE 混沌 E2E（6 场景）+ 异步 SSE 并发压测（5 场景）** 四大 JSON 报告，生成单文件、零外部 CDN 依赖、内置 SVG 环形图与柱状图的离线可交互质量总控大盘 `apps/api-diagram/evals/reports/latest_qa_dashboard.html`（所有动态文本均经过 `html.escape` 严格转义，并通过 `test_qa_dashboard.py` 防 XSS 注入单测验证）。

---

## 七、 核心评测与压测命令速查表 & 延伸文档导航

### 7.1 全链路质量门禁与评测命令速查表

| 阶段 / 维度 | 标准执行命令 | 底层入口脚本 | 核心考核指标与产出物 |
|---|---|---|---|
| **图表 Agent 评测 (53 样本)** | `npm run eval:agent` | `apps/api-diagram/scripts/run_agent_evals.py --strict` | 6 大指标 100% 达标，`Pass@Repair 100%`，输出 `latest_eval_report.md` |
| **多模态 Agent 评测 (30 样本)** | `npm run eval:multimodal` | `apps/api-diagram/scripts/run_multimodal_evals.py --strict` | 招聘 `Rubric-v3` 防幻觉/Knockout + 视频 Jeff 门控 + PPT 并行编排 `100%` |
| **Playwright E2E 与故障注入** | `npm run test:e2e` | `apps/api-diagram/scripts/run_playwright_e2e.py` | `SpaTestServer` + 6 大 SSE 断流/坏帧/429/502 混沌场景 `6/6 PASS` |
| **异步 SSE 高并发压测** | `npm run bench:sse` | `apps/api-diagram/scripts/run_sse_benchmark.py --strict` | 50 路并发 `3,611+ streams/s` + 100 并发租户限流精度 `100%` |
| **QA 总控可交互 HTML 大盘** | `npm run qa:dashboard` | `apps/api-diagram/scripts/generate_qa_dashboard.py` | 生成单文件离线大盘 `apps/api-diagram/evals/reports/latest_qa_dashboard.html` |
| **Python 全量单元测试** | `npm run test:python` | `pytest apps/api-diagram/tests apps/api-ppt/tests` | **207 项** Python 白盒、接口、安全、评测与大盘转义单测 `100% PASS` |
| **TypeScript 全栈单元测试** | `npm run test:typescript` | `pnpm --filter ... test` | 覆盖 `slide-ir`、`shared`、`agents`（含 SVG 几何碰撞）、`ppt-renderer`、`web` |
| **本地 Git Pre-push 预检** | `npm run preflight` | `scripts/local-preflight.sh --fast` | 8 秒内完成 Env 契约、Shell 语法、破坏性 SQL、Pytest 与 Agent 评测 |
| **远程一键安全发布** | `npm run deploy:remote` | `scripts/remote-deploy.sh` | 本地预检 $\rightarrow$ 远端同步 $\rightarrow$ 镜像预构建与备份迁移 $\rightarrow$ 健康探活 $\rightarrow$ 诊断回传 |

### 7.2 延伸文档与面试答辩专题导航

- 🎯 **[AI 智能体测试组长深度面试题库与答辩手册](AI智能体测试组长深度面试题库与答辩手册.md)**（在线文档路由：`/video/docs/ai-agent-interview-playbook` · 仓库原件：[`docs/qa/INTERVIEW_PLAYBOOK_AI_AGENT_QA_LEAD.md`](../qa/INTERVIEW_PLAYBOOK_AI_AGENT_QA_LEAD.md)）
- 📄 **[AI 智能体测试组长定制简历与 STAR 项目指南](AI智能体测试组长定制简历与STAR项目指南.md)**（在线文档路由：`/video/docs/ai-agent-resume-guide` · 仓库原件：[`docs/qa/RESUME_TAILORED_AI_AGENT_QA_LEAD.md`](../qa/RESUME_TAILORED_AI_AGENT_QA_LEAD.md)）
- 🛠️ **[端到端质量保障、AI Agent 量化评测与自动化部署手册](../qa/AI_AGENT_QA_AND_DEPLOY_GUIDE.md)**
- 📋 **[执行记录：AI Agent 专项量化评测、SSE 混沌压测与部署可观测性](../plans/2026-10-26-ai-agent-qa-eval-and-deploy-observability.md)**
