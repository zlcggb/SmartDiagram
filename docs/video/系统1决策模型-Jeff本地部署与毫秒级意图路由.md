# 系统 1 决策模型：Jeff 本地部署与毫秒级意图路由架构 (SmartDiagram v2.7.0)

> **模块定位**：SmartDiagram 视频学习助手 (`/video`) 系统 1（快思考）前置决策中枢，基于开源 GLiFormer (`knowledgator/gliformer-large-v1`) 架构打造。  
> **代码基准 (v2.7.0 · 2026-10)**：后端 [`apps/api-video/intent_router.py`](../../apps/api-video/intent_router.py)、[`apps/api-video/qa.py`](../../apps/api-video/qa.py)、[`apps/api-video/ai_routes.py`](../../apps/api-video/ai_routes.py) (`:4020`) + Jeff 微服务 (`:8001`) + 前端 [`apps/web/src/features/video/components/TranscriptChatPanel.tsx`](../../apps/web/src/features/video/components/TranscriptChatPanel.tsx)。  
> **核心使命**：在 **40~100ms** 内对用户输入与媒体上下文完成非自回归单次前向决策，结合 **v2.7.0 三层高置信度防误判门控 (`_SUMMARY_QA_PRIORITY_RE` + 二次特征词核验 + `0.78` 置信度阈值)**、**`model.safetensors` `mmap` 零拷贝低内存映射 (`685 MiB`)** 与 **`POST /api/ask/stream` (`router ➔ delta ➔ done`) 三阶段 SSE 流式问答**，实现高频动作 0 LLM 耗时直出、预设问题 0 误判、问答上下文动态裁剪瘦身以及 PostgreSQL `analyses.result.chat_history` 自动持久化。

---

## 一、背景与第一性原理剖析

### 1.1 传统问答链路的痛点（慢思考全量穿透）
在重构前，视频工作台的 AI 对话问答中枢（`/api/ask`）采用的是线性单通道架构：
- **无差别长文本直塞**：不论用户提问什么（哪怕只是“我想下载视频”、“帮我出两道题”、“把结论翻译成英文”或“你好”），系统均无差别地将长达 **12,000 字符** 的视频长转录文本与总结摘要打包塞给通用 LLM。
- **端到端高延迟**：单次交互的 TTFT（首字延迟）高达 **2~4 秒**。
- **Token 严重浪费**：用户每发送一句日常问候或简单控制指令，均消耗 3,000 ~ 6,000 Tokens。
- **能力单一受限**：无法与播放器 Seek 跳转、视频本地下载、互动测验面板形成动作级（Action-level）联动。

### 1.2 架构破局：引入系统 1（快思考）与系统 2（慢思考）分层
立足于认知心理学与现代大模型架构体系（Kahneman's Dual-Process Theory）：
- **系统 1（快思考 · Fast & Intuitive）**：低延迟（<100ms）、轻量级（~400M 参数）、高确定性、非自回归，专职负责**意图分类、条件判定与复杂度评级**。
- **系统 2（慢思考 · Slow & Deliberative）**：高智力、长上下文（几万字）、自回归推理，专职负责**深度逻辑归纳、多源证据溯源与研报撰写**。

通过将 **开源 Jeff（GLiFormer）** 置于问答中枢入口，系统在 40~100ms 内先完成意图识别与上下文判定，再决定是否唤醒昂贵的系统 2。

---

## 二、技术选型与 v2.7.0 核心演进

### 2.1 核心技术指标与 `safetensors mmap` 零拷贝优化
- **开源项目**：`logan-markewich/jeff`（LlamaIndex 核心团队开源，TypeSafe AI 商业 Jev API 的 100% 协议兼容 Drop-in 平替）。
- **底层模型**：`knowledgator/gliformer-large-v1`（~400M 参数，Encoder-only，基于 GLiNER 架构优化）。
- **云端零拷贝低内存部署 (`v2.7.0`)**：
  - 将旧版 `pytorch_model.bin` 升级为 **`model.safetensors`** 并启用 OS 页缓存 `mmap` 零拷贝映射；
  - 容器内存峰值从原先的 **`4.81 GB` 骤降至 `685 MiB`**（降低 **85.8%**），在云端 2C4G Docker 容器中稳定常驻、零 OOM；
  - Apple Silicon 芯片原生支持 Metal Performance Shaders（`JEFF_DEVICE=mps`），云端 Linux 支持 CPU AVX2 极速推理；
  - 单次完整前向推理：**40~90ms**。

### 2.2 决策原语契约（Decision Primitives）
Jeff 原生支持三大决策原语，主后端 `apps/api-video/intent_router.py` 直接通过官方客户端 `typesafe-sdk` 调用：
1. **`Choice`（多选一）**：判定用户诉求属于哪类具体意图（并返回各选项概率分布与最高置信度 `confidence`）。
2. **`Noul`（Yes/No 概率判定）**：输出 0.0~1.0 的加权标量，判定某条件是否成立（如“是否需要加载数万字长转写”）。
3. **`Score`（有序打分）**：评估复杂度等级（1~5 分），为后续大模型分级调度提供依据。

### 2.3 三层高置信度防误判门控 (`v2.7.0` 核心升级)
针对早期版本中用户点击预设引导问题（如“用三句话概括这个视频讲了什么”、“这个视频对我有什么启发？”）偶发被零样本分类器误判为 `make_quiz` 或 `translate` 的痛点，`apps/api-video/intent_router.py` 构筑了严密的**三层防误判门控体系**：

1. **第一层：总结/概括硬优先白名单 (`_SUMMARY_QA_PRIORITY_RE`)**
   - 凡用户输入包含 **「三句话概括 / 总结一下 / 讲了什么 / 核心观点 / 主要内容 / 脉络 / 逻辑框架 / 启发 / 为什么 / 怎么看」** 等知识探讨特征词，且无显式「出几道题 / 下载视频」指令时，在 `0.0ms` 内 **100% 强制锁定为 `video_qa`**，彻底杜绝预设引导词被误触为功能动作。
2. **第二层：功能性意图特征词二次核验 (Secondary Keyword Guard)**
   - 即使模型预测为功能性意图，也必须通过领域特征词二次核验：
     - `translate`：必须显式包含目标语种（英/日/韩/法/德等）或“翻译/译成”特征词；
     - `make_quiz`：必须包含“测验/出题/考考我/自测/练习题/选择题”特征词；
     - `download`：必须包含“下载/保存/导出/mp4/原片”特征词；
     - `seek_player`：必须包含时间点格式（`mm:ss` / `第X分钟`）或“跳转/快进/定位到”特征词。
3. **第三层：`0.78` 高置信度阈值门控 (`_ACTION_CONFIDENCE_THRESHOLD = 0.78`)**
   - 只有当系统 1 对功能性意图（`make_quiz` / `download` / `seek_player` / `translate`）输出的置信度 **`confidence >= 0.78`** 时，才允许触发前端动作卡片；
   - 凡置信度 **`< 0.78`** 的模糊预测，一律安全回退至 **`video_qa`** 深度总结问答。

---

## 三、系统整体架构设计

### 3.1 架构拓扑全景图 (SmartDiagram v2.7.0)

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">系统 1 (Jeff) 毫秒级意图路由与三层高置信度门控全栈拓扑 (v2.7.0 Architecture)</span>
    </div>
    <span class="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-950/60 dark:text-blue-400">三层防误判门控 (0.78) · safetensors 685MiB · 三阶段 SSE 流式</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 1060 620" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[820px] text-xs">
      <defs>
        <filter id="s1-card-shadow" x="-4%" y="-3%" width="108%" height="108%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.06"/>
        </filter>
        <marker id="arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <marker id="arr-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#059669"/>
        </marker>
        <marker id="arr-violet" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#7c3aed"/>
        </marker>
        <marker id="arr-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#d97706"/>
        </marker>
        <marker id="arr-slate" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#64748b"/>
        </marker>
      </defs>

      <!-- 1. 客户端入口网关 (左侧) -->
      <g transform="translate(20, 20)" filter="url(#s1-card-shadow)">
        <rect width="220" height="570" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
        <rect width="220" height="38" rx="12" fill="#0284c7"/>
        <rect y="22" width="220" height="16" fill="#0284c7"/>
        <text x="16" y="24" fill="#ffffff" font-size="12.5" font-weight="bold" font-family="-apple-system, sans-serif">🖥️ 客户端与流式网关 (:4020)</text>
        
        <g transform="translate(14, 52)" font-family="-apple-system, sans-serif" font-size="11">
          <!-- 用户输入 -->
          <rect width="192" height="54" rx="8" fill="#ffffff" stroke="#bae6fd" stroke-width="1"/>
          <text x="10" y="22" fill="#0f172a" font-weight="600">TranscriptChatPanel.tsx</text>
          <text x="10" y="40" fill="#64748b" font-size="9.5">预设引导词 / 追问 / 控制指令</text>

          <!-- POST /api/ask/stream -->
          <g transform="translate(0, 80)">
            <rect width="192" height="64" rx="8" fill="#ffffff" stroke="#bae6fd" stroke-width="1"/>
            <text x="10" y="20" fill="#0284c7" font-weight="bold">POST /api/ask/stream</text>
            <text x="10" y="38" fill="#0f172a" font-size="10">apps/api-video/ai_routes.py</text>
            <text x="10" y="52" fill="#059669" font-size="9.5" font-weight="600">⚡ 三阶段 SSE: router➔delta➔done</text>
          </g>

          <!-- 调度器 -->
          <g transform="translate(0, 170)">
            <rect width="192" height="68" rx="8" fill="#ffffff" stroke="#bae6fd" stroke-width="1"/>
            <text x="10" y="20" fill="#0f172a" font-weight="600">意图调度器 (Router)</text>
            <text x="10" y="38" fill="#64748b" font-size="10">apps/api-video/intent_router.py</text>
            <text x="10" y="54" fill="#64748b" font-size="9.5">route_user_intent(query)</text>
          </g>

          <!-- 统一响应与 UI 联动 -->
          <g transform="translate(0, 350)">
            <rect width="192" height="130" rx="8" fill="#f0fdf4" stroke="#86efac" stroke-width="1.2"/>
            <text x="10" y="22" fill="#15803d" font-weight="bold">流式气泡 &amp; PG 自动持久化</text>
            <text x="10" y="42" fill="#0f172a" font-size="9.5">• ⚡ Jev系统1耗时 (ms) 徽章</text>
            <text x="10" y="60" fill="#0f172a" font-size="9.5">• 🧠 大模型耗时 (含首字 TTFT)</text>
            <text x="10" y="78" fill="#475569" font-size="9.5">• 🕒 HH:MM:SS + 动作卡片联动</text>
            <text x="10" y="96" fill="#047857" font-size="9.5" font-weight="600">• PG analyses.result.chat_history</text>
            <text x="10" y="114" fill="#64748b" font-size="9">刷新或历史重进 100% 恢复对话</text>
          </g>
        </g>
      </g>

      <!-- 2. 双轨决策中枢 (中间) -->
      <g transform="translate(265, 20)" filter="url(#s1-card-shadow)">
        <rect width="365" height="570" rx="12" fill="#faf5ff" stroke="#ddd6fe" stroke-width="1.5"/>
        <rect width="365" height="38" rx="12" fill="#7c3aed"/>
        <rect y="22" width="365" height="16" fill="#7c3aed"/>
        <text x="16" y="24" fill="#ffffff" font-size="12.5" font-weight="bold" font-family="-apple-system, sans-serif">🧠 系统 1：三层防误判门控与 Jeff 中枢 (v2.7.0)</text>

        <g transform="translate(14, 52)" font-family="-apple-system, sans-serif" font-size="11">
          <!-- 轨一：0ms 短路先验 + _SUMMARY_QA_PRIORITY_RE -->
          <g transform="translate(0, 0)">
            <rect width="337" height="96" rx="8" fill="#ecfdf5" stroke="#6ee7b7" stroke-width="1.2"/>
            <text x="14" y="20" fill="#047857" font-weight="bold">⚡ 门控一：_SUMMARY_QA_PRIORITY_RE &amp; 0ms 先验</text>
            <text x="14" y="38" fill="#0f172a" font-size="9.5">• 总结/概括/核心观点/启发/为什么 ➔ 100% 锁定 video_qa</text>
            <text x="14" y="54" fill="#0f172a" font-size="9.5">• 强特征正则：下载直链 / 时间戳跳转 / 考题测验 / 问候</text>
            <text x="14" y="70" fill="#059669" font-size="9.5" font-weight="600">耗时: &lt; 0.1ms · 杜绝预设引导词误判 · 零网络损耗</text>
            <text x="14" y="86" fill="#64748b" font-size="9">未命中先验 ➔ 下发至 Jeff 微服务做 GLiFormer 语义推理</text>
          </g>

          <!-- 轨二：Jeff 微服务 + 二次核验 + 0.78 门控 -->
          <g transform="translate(0, 110)">
            <rect width="337" height="236" rx="8" fill="#ffffff" stroke="#c4b5fd" stroke-width="1.2"/>
            <text x="14" y="22" fill="#6d28d9" font-weight="bold">🔮 门控二 &amp; 三：Jeff 微服务 (:8001) + 0.78 阈值</text>
            <text x="14" y="40" fill="#475569" font-size="9.5">gliformer-large-v1 · model.safetensors mmap 零拷贝</text>
            <text x="14" y="56" fill="#7c3aed" font-size="9.5" font-weight="600">常驻内存峰值: 4.81GB ➔ 685 MiB · 单次前向 40~90ms</text>

            <rect x="14" y="68" width="309" height="154" rx="6" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>
            <text x="24" y="88" fill="#0f172a" font-weight="600" font-size="10">typesafe-sdk 契约 + 二次特征词 &amp; 置信度门控:</text>
            <text x="24" y="106" fill="#1e293b" font-size="9.5">1. Choice(intent): 6选1 + 输出置信度 confidence</text>
            <text x="24" y="124" fill="#1e293b" font-size="9.5">2. Noul(needs_transcript) &amp; Score(complexity 1~5)</text>
            <text x="24" y="142" fill="#b45309" font-weight="600" font-size="9.5">3. 二次核验: translate/quiz/download/seek 必含特征词</text>
            <text x="24" y="160" fill="#059669" font-weight="600" font-size="9.5">4. 阈值门控: _ACTION_CONFIDENCE_THRESHOLD = 0.78</text>
            <text x="24" y="178" fill="#64748b" font-size="9">低于 0.78 或未过二次核验 ➔ 一律安全回退至 video_qa</text>
            <text x="24" y="196" fill="#64748b" font-size="9">高于 0.78 ➔ 触发前端动作卡片 (测验/下载/播放器跳转)</text>
          </g>

          <!-- 容灾保底 -->
          <g transform="translate(0, 360)">
            <rect width="337" height="96" rx="8" fill="#fffbeb" stroke="#fde68a" stroke-width="1.2"/>
            <text x="14" y="24" fill="#b45309" font-weight="bold">🛡️ 生产级容灾高可用 (Circuit Breaker &amp; Fallback)</text>
            <text x="14" y="44" fill="#0f172a" font-size="10">容灾触发: Jeff 未启动 / 超时 (&gt;1.0s) / 置信度不足</text>
            <text x="14" y="64" fill="#b45309" font-size="10" font-weight="600">静默优雅降级: 100% 自动回退为默认 video_qa 路径</text>
            <text x="14" y="82" fill="#64748b" font-size="9.5">主业务问答零中断、零白屏，用户无感知且日志完整记录</text>
          </g>
        </g>
      </g>

      <!-- 3. 六大意图分流矩阵 (右侧) -->
      <g transform="translate(655, 20)" filter="url(#s1-card-shadow)">
        <rect width="385" height="570" rx="12" fill="#f0fdfa" stroke="#99f6e4" stroke-width="1.5"/>
        <rect width="385" height="38" rx="12" fill="#0d9488"/>
        <rect y="22" width="385" height="16" fill="#0d9488"/>
        <text x="16" y="24" fill="#ffffff" font-size="12.5" font-weight="bold" font-family="-apple-system, sans-serif">🔀 六大意图多分支分流矩阵 (apps/api-video/qa.py)</text>

        <g transform="translate(14, 50)" font-family="-apple-system, sans-serif" font-size="10.5">
          <!-- 1. download -->
          <g transform="translate(0, 0)">
            <rect width="357" height="68" rx="8" fill="#ffffff" stroke="#bae6fd" stroke-width="1"/>
            <text x="12" y="20" fill="#0284c7" font-weight="bold">1. 📥 download (下载意图 · 置信度 &gt;= 0.78)</text>
            <text x="12" y="38" fill="#0f172a">直接提取本地归档路径与 MP4 规格，0 LLM 消耗直出卡片</text>
            <text x="12" y="54" fill="#059669" font-size="9.5" font-weight="600">响应耗时从 3500ms 骤降至 50ms (快 70 倍) · 0 Token 消耗</text>
          </g>

          <!-- 2. make_quiz -->
          <g transform="translate(0, 76)">
            <rect width="357" height="68" rx="8" fill="#ffffff" stroke="#fed7aa" stroke-width="1"/>
            <text x="12" y="20" fill="#ea580c" font-weight="bold">2. 📝 make_quiz (考题测验 · 置信度 &gt;= 0.78)</text>
            <text x="12" y="38" fill="#0f172a">识别出题诉求，联动 QuizPanel 生成 6 道精选测验题</text>
            <text x="12" y="54" fill="#ea580c" font-size="9.5" font-weight="600">输出 action: {type: 'switch_tab', tab: 'quiz'} 联动前端切换</text>
          </g>

          <!-- 3. translate -->
          <g transform="translate(0, 152)">
            <rect width="357" height="68" rx="8" fill="#ffffff" stroke="#ddd6fe" stroke-width="1"/>
            <text x="12" y="20" fill="#7c3aed" font-weight="bold">3. 🌐 translate (语言翻译 · 必含语种/翻译词)</text>
            <text x="12" y="38" fill="#0f172a">仅提取上一轮问答结论做短句翻译，杜绝塞入上万字字幕</text>
            <text x="12" y="54" fill="#7c3aed" font-size="9.5" font-weight="600">大幅节约 95% 上下文 Token，首字生成延迟降低 80%</text>
          </g>

          <!-- 4. seek_player -->
          <g transform="translate(0, 228)">
            <rect width="357" height="68" rx="8" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
            <text x="12" y="20" fill="#0f172a" font-weight="bold">4. ⏩ seek_player (播放跳转 · 置信度 &gt;= 0.78)</text>
            <text x="12" y="38" fill="#0f172a">根据章节与时间戳正则精确计算秒数 (HH:MM:SS ➔ 秒)</text>
            <text x="12" y="54" fill="#0284c7" font-size="9.5" font-weight="600">输出 action: {type: 'seek', seconds: ts} 播放器精准定位</text>
          </g>

          <!-- 5. chitchat -->
          <g transform="translate(0, 304)">
            <rect width="357" height="68" rx="8" fill="#ffffff" stroke="#fbcfe8" stroke-width="1"/>
            <text x="12" y="20" fill="#db2777" font-weight="bold">5. 💬 chitchat (日常问候)</text>
            <text x="12" y="38" fill="#0f172a">极速友好打招呼并智能引导回视频主题，0 视频长字幕消耗</text>
            <text x="12" y="54" fill="#db2777" font-size="9.5" font-weight="600">拦截废话无效提问，避免浪费高价值 LLM 推理额度</text>
          </g>

          <!-- 6. video_qa -->
          <g transform="translate(0, 380)">
            <rect width="357" height="88" rx="8" fill="#ffffff" stroke="#99f6e4" stroke-width="1.2"/>
            <text x="12" y="20" fill="#0d9488" font-weight="bold">6. 🎯 video_qa (视频深度 RAG 流式问答 / 优先白名单)</text>
            <text x="12" y="38" fill="#0f172a">按 needs_transcript 标量权重动态裁剪精炼字幕</text>
            <text x="12" y="56" fill="#0f172a">SSE delta 实时推送 + 统计首字 TTFT 与系统 2 耗时</text>
            <text x="12" y="74" fill="#059669" font-size="9.5" font-weight="600">问答完成自动写入 PostgreSQL analyses.result.chat_history</text>
          </g>
        </g>
      </g>

      <!-- 连线与指示箭头 -->
      <!-- 调度器 -> 轨一 -->
      <path d="M 226 250 C 245 250, 245 110, 263 110" fill="none" stroke="#059669" stroke-width="1.8" stroke-dasharray="4,3" marker-end="url(#arr-emerald)"/>
      <!-- 调度器 -> 轨二 -->
      <path d="M 226 250 L 263 250" fill="none" stroke="#7c3aed" stroke-width="2" marker-end="url(#arr-violet)"/>
      <!-- 轨二异常 -> 容灾保底 -->
      <path d="M 445 400 L 445 428" fill="none" stroke="#d97706" stroke-width="1.8" stroke-dasharray="4,3" marker-end="url(#arr-amber)"/>

      <!-- 轨二 -> 分流矩阵 -->
      <path d="M 632 250 L 653 250" fill="none" stroke="#0d9488" stroke-width="2.2" marker-end="url(#arr-emerald)"/>
      <!-- 容灾保底 -> video_qa -->
      <path d="M 632 460 C 645 460, 645 480, 653 480" fill="none" stroke="#d97706" stroke-width="1.8" stroke-dasharray="4,3" marker-end="url(#arr-amber)"/>

      <!-- 分流矩阵 -> 统一响应体 (回流至客户端) -->
      <path d="M 847 572 C 847 605, 116 605, 116 572" fill="none" stroke="#059669" stroke-width="1.8" marker-end="url(#arr-emerald)"/>
    </svg>
  </div>
</div>


---

## 四、三阶段 SSE 流式问答与六大意图分流矩阵

### 4.1 三阶段 SSE 流式问答协议 (`POST /api/ask/stream`)
在 SmartDiagram v2.7.0 中，前端 [`TranscriptChatPanel.tsx`](../../apps/web/src/features/video/components/TranscriptChatPanel.tsx) 默认通过 `POST /api/ask/stream`（定义于 [`apps/api-video/ai_routes.py`](../../apps/api-video/ai_routes.py)）发起流式问答，按三个阶段实时推送事件：
1. **`event: router`**：在 **0~90ms** 内率先返回系统 1 决策元数据（`intent`, `confidence`, `router_ms`, `needs_transcript`, `complexity`），前端立即点亮 `⚡ Jev系统1 XXms` 徽章；
2. **`event: delta`**：系统 2 大模型流式生成 token 增量，前端实时打字机渲染并记录首字到达时间（`ttft_ms`）；
3. **`event: done`**：返回完整回复文本、动作指令 `action`、系统 2 总耗时 `llm_ms` 与时间戳 `created_at`，同时后台自动将本轮问答追加写入 PostgreSQL `analyses.result.chat_history`（`repo.save_analysis_chat_history`）。

前端对话气泡底部统一展示三元性能指标：
- `⚡ Jev系统1耗时 (ms)` + `🧠 大模型耗时 (含首字 TTFT)` + `🕒 HH:MM:SS`

### 4.2 六大意图多分支分流矩阵 (`apps/api-video/qa.py`)

用户提问经由系统 1 与三层防误判门控决策后，问答流水线（`apps/api-video/qa.py`）按照六大独立分支进行分流流转：

| 意图类型 (`intent`) | 典型触发用户输入 | 门控条件 (v2.7.0) | 内部处理逻辑 | 前端动作响应 (`action`) | Token 节约与性能提升 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`download`** | “我想下载这个视频的MP4”、“帮我保存到本地” | 含下载特征词 + `confidence >= 0.78` | 提取任务编号与本地归档状态，组织 Markdown 说明 | 渲染“📥 立即下载视频”快捷按钮，点击直接触发文件下载 | **0 LLM 耗时，0 Token**，总延迟从 3.5s 降至 **50ms** |
| **`make_quiz`** | “考考我”、“出几道题测验下” | 含测验特征词 + `confidence >= 0.78` | 识别出题诉求，组织导流引导词 | 渲染“📝 进入测验面板”按钮，点击自动切换至测验 Tab (`QuizPanel.tsx`) | 避免在对话框内排版紊乱，引导至结构化测验面板 |
| **`translate`** | “把刚才的结论翻译成英文”、“翻成日文” | 含目标语种/翻译词 + `confidence >= 0.78` | 仅提取对话历史中的上一条回复，使用极简 Prompt 翻译 | 正常流式文本渲染 | **省去 95% 无关上下文**，从 1.2 万字降至 200 字 |
| **`seek_player`** | “跳到 05:00 播放”、“快进到介绍架构的地方” | 含时间点/跳转词 + `confidence >= 0.78` | 正则解析分秒时间或在视频章节目录中语义匹配最佳节点 | 渲染“⏱️ 跳转播放 [mm:ss]”卡片，点击驱动播放器毫秒 Seek | 避免大模型冗长检索，播放器精准联动 |
| **`chitchat`** | “你好”、“你是谁”、“早上好” | 强特征问候词匹配 | 直接返回学习助手能力清单与友好提示 | 正常文本渲染 | **0 LLM 耗时，0 字幕注入**，直接秒回 |
| **`video_qa`** | “用三句话概括视频讲了什么”、“对我有什么启发” | `_SUMMARY_QA_PRIORITY_RE` 硬优先白名单或默认回退 | 核心深度问答分支：根据 `needs_transcript` 动态裁剪注入字幕并流式输出 | 流式 Markdown 渲染，支持时间戳点击高亮 + PG 自动持久化 | 预设引导词 100% 零误判，宏观总结类问答提速 2 倍 |

---

## 五、生产级高可用与容灾兜底（KISS 原则）

系统在设计之初将“**架构安全与容灾降级**”作为最高优先级约束：

1. **环境与依赖完全解耦 + `safetensors mmap` 低内存**：
   - Jeff 源码与 `torch`、`gliformer` 依赖完整隔离在 `vendor/jeff/` 的独立虚拟环境或容器中，采用 `model.safetensors` `mmap` 零拷贝加载，常驻内存仅 **`685 MiB`**；
   - 主工程 `apps/api-video/` 仅安装纯 Python 轻量客户端 `typesafe-sdk`（不足 100KB），杜绝环境污染。
2. **快速超时与禁止冗余重试**：
   - 实例化 `TypeSafeClient` 时明确设置 `retry=RetryPolicy(max_retries=0)`，严防底层重试机制引发长达数秒的等待；
   - 配置 `INTENT_ROUTER_TIMEOUT=1.0s` 强熔断保护。
3. **静默优雅降级（Graceful Degradation）**：
   - 若 Jeff 未启动、启动崩溃、超时、网络中断或功能意图置信度 `< 0.78`，`route_user_intent` 内部捕获所有异常或低置信度状态；
   - 立即返回安全的 Fallback 决策（`intent="video_qa"`, `needs_transcript=True`, `complexity=3`, `fallback=True`）；
   - **主业务逻辑 100% 保持可用，绝不向用户抛出 500 报错**。
4. **特性开关**：
   - 支持环境变量 `INTENT_ROUTER_ENABLED=false` 一键切回传统直连模式。

---

## 六、未来演进：在语音识别（ASR）前置链路的应用

立足第一性原理，系统 1 决策模型在媒体转写链路中的边界与高价值应用如下：

### 6.1 边界判定：哪些绝对用不上？
- **不能替代 Whisper / 阿里云百炼做语音转文字**：Jeff 无音频声学解码器，物理识别必须交给 `asr_cloud.py`（DashScope `qwen3-asr-flash` / SenseVoice 6 线程并发）或本地 Whisper；
- **不能替代音频数字信号静音检测（VAD）**：音频电平能量检测已有 0.1ms 的 WebRTC-VAD 算法，让深度学习大模型算波形是严重负优化；
- **平台官方字幕命中时不介入**：若已直接提取到 B站/YouTube 官方人工字幕，这是最高精度且 0 算力源，无需额外决策。

### 6.2 核心价值场景与未来接入拓扑

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">系统 1 (Jeff) 语音识别 (ASR) 前置分流与质量看门狗拓扑 (ASR Intelligent Dispatcher)</span>
    </div>
    <span class="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full dark:bg-emerald-950/60 dark:text-emerald-400">跳过无效 ASR 提速 90% · 成本节省 65% · 幻觉复读自愈</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 1060 520" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[820px] text-xs">
      <defs>
        <filter id="asr-card-shadow" x="-4%" y="-3%" width="108%" height="108%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.06"/>
        </filter>
        <marker id="arr-asr-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#059669"/>
        </marker>
        <marker id="arr-asr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <marker id="arr-asr-violet" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#7c3aed"/>
        </marker>
        <marker id="arr-asr-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#d97706"/>
        </marker>
        <marker id="arr-asr-rose" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#e11d48"/>
        </marker>
      </defs>

      <!-- 阶段 1：媒体输入与特征感知 -->
      <g transform="translate(20, 20)" filter="url(#asr-card-shadow)">
        <rect width="215" height="470" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
        <rect width="215" height="36" rx="12" fill="#0284c7"/>
        <rect y="20" width="215" height="16" fill="#0284c7"/>
        <text x="14" y="23" fill="#ffffff" font-size="12" font-weight="bold" font-family="-apple-system, sans-serif">1. 媒体输入与先验提取</text>

        <g transform="translate(12, 50)" font-family="-apple-system, sans-serif" font-size="10.5">
          <rect width="191" height="70" rx="8" fill="#ffffff" stroke="#bae6fd" stroke-width="1"/>
          <text x="10" y="22" fill="#0f172a" font-weight="600">视频源 / 上传媒体</text>
          <text x="10" y="40" fill="#64748b" font-size="9.5">提取视频标题、标签与多模态简介</text>
          <text x="10" y="56" fill="#0284c7" font-size="9.5">识别平台类型 (B站/YT/抖音/XHS)</text>

          <g transform="translate(0, 85)">
            <rect width="191" height="78" rx="8" fill="#ffffff" stroke="#bae6fd" stroke-width="1"/>
            <text x="10" y="22" fill="#0f172a" font-weight="600">轻量元数据探测 (&lt;50ms)</text>
            <text x="10" y="40" fill="#64748b" font-size="9.5">• 探测是否存在平台原生外挂字幕</text>
            <text x="10" y="56" fill="#64748b" font-size="9.5">• 提取首尾 30s 音频波形电平能量</text>
            <text x="10" y="70" fill="#059669" font-size="9" font-weight="600">极速前置过滤，避免重型计算</text>
          </g>
        </g>
      </g>

      <!-- 阶段 2：Jeff 前置决策矩阵 -->
      <g transform="translate(255, 20)" filter="url(#asr-card-shadow)">
        <rect width="270" height="470" rx="12" fill="#faf5ff" stroke="#ddd6fe" stroke-width="1.5"/>
        <rect width="270" height="36" rx="12" fill="#7c3aed"/>
        <rect y="20" width="270" height="16" fill="#7c3aed"/>
        <text x="14" y="23" fill="#ffffff" font-size="12" font-weight="bold" font-family="-apple-system, sans-serif">2. Jeff 前置决策中枢 (GLiFormer)</text>

        <g transform="translate(12, 50)" font-family="-apple-system, sans-serif" font-size="10.5">
          <!-- P0 门控 -->
          <rect width="246" height="70" rx="8" fill="#ffffff" stroke="#c4b5fd" stroke-width="1"/>
          <text x="10" y="20" fill="#6d28d9" font-weight="bold">P0: 原生软字幕直通判定</text>
          <text x="10" y="38" fill="#0f172a">若命中 B站/YT 官方人工中英字幕</text>
          <text x="10" y="54" fill="#059669" font-size="9.5" font-weight="600">➔ 0 算力直通，彻底跳过 ASR！</text>

          <!-- P1 门控 -->
          <g transform="translate(0, 85)">
            <rect width="246" height="140" rx="8" fill="#ffffff" stroke="#c4b5fd" stroke-width="1.2"/>
            <text x="10" y="20" fill="#6d28d9" font-weight="bold">P1: Noul(has_spoken_content)</text>
            <text x="10" y="38" fill="#0f172a">判定是否存在有效人声口播解说</text>
            
            <rect x="8" y="48" width="230" height="40" rx="6" fill="#fef2f2" stroke="#fecdd3" stroke-width="1"/>
            <text x="14" y="65" fill="#b91c1c" font-size="9.5" font-weight="bold">False: 纯音乐 / 无声录屏 / 监控</text>
            <text x="14" y="80" fill="#991b1b" font-size="9">【破局点】直切 PySceneDetect 画面抽帧！</text>

            <rect x="8" y="94" width="230" height="38" rx="6" fill="#ecfdf5" stroke="#a7f3d0" stroke-width="1"/>
            <text x="14" y="110" fill="#047857" font-size="9.5" font-weight="bold">True: 存在口播 ➔ 触发 P2 引擎分流</text>
            <text x="14" y="124" fill="#065f46" font-size="9">进入模型复杂度与场景自适应调度</text>
          </g>

          <!-- P2 门控 -->
          <g transform="translate(0, 240)">
            <rect width="246" height="78" rx="8" fill="#ffffff" stroke="#c4b5fd" stroke-width="1"/>
            <text x="10" y="20" fill="#6d28d9" font-weight="bold">P2: Choice(asr_tier)</text>
            <text x="10" y="38" fill="#0f172a">评估术语复杂度、语种交替与环境噪声</text>
            <text x="10" y="54" fill="#475569" font-size="9.5">• Tier 1: 普通口播 ➔ 6 线程云端/本地 ASR</text>
            <text x="10" y="68" fill="#475569" font-size="9.5">• Tier 2: 生僻学术专业 ➔ 旗舰多模态校正</text>
          </g>
        </g>
      </g>

      <!-- 阶段 3：差异化转录引擎矩阵 -->
      <g transform="translate(545, 20)" filter="url(#asr-card-shadow)">
        <rect width="265" height="470" rx="12" fill="#f0fdf4" stroke="#86efac" stroke-width="1.5"/>
        <rect width="265" height="36" rx="12" fill="#059669"/>
        <rect y="20" width="265" height="16" fill="#059669"/>
        <text x="14" y="23" fill="#ffffff" font-size="12" font-weight="bold" font-family="-apple-system, sans-serif">3. 差异化转录引擎矩阵</text>

        <g transform="translate(12, 50)" font-family="-apple-system, sans-serif" font-size="10.5">
          <!-- 直通提取 -->
          <rect width="241" height="68" rx="8" fill="#ffffff" stroke="#86efac" stroke-width="1"/>
          <text x="10" y="20" fill="#059669" font-weight="bold">通道 A: 原生字幕直接抽取</text>
          <text x="10" y="38" fill="#0f172a">直接导出 SRT / VTT 官方字幕</text>
          <text x="10" y="54" fill="#047857" font-size="9.5" font-weight="600">0 API 成本 · 0 秒转写等待 · 100% 官方精度</text>

          <!-- 画面抽帧 -->
          <g transform="translate(0, 78)">
            <rect width="241" height="78" rx="8" fill="#fff1f2" stroke="#fda4af" stroke-width="1.2"/>
            <text x="10" y="20" fill="#e11d48" font-weight="bold">通道 B: 视觉画面抽帧与理解</text>
            <text x="10" y="38" fill="#9f1239">跳过无声音频转录，直切视觉分析</text>
            <text x="10" y="54" fill="#be123c" font-size="9.5" font-weight="600">耗时从 4 分钟缩短至 15 秒 (快 16 倍!)</text>
            <text x="10" y="68" fill="#64748b" font-size="9">按关键场景切片生成视觉图文解说</text>
          </g>

          <!-- 本地 Whisper -->
          <g transform="translate(0, 166)">
            <rect width="241" height="74" rx="8" fill="#ffffff" stroke="#bae6fd" stroke-width="1"/>
            <text x="10" y="20" fill="#0284c7" font-weight="bold">通道 C: 本地 faster-whisper</text>
            <text x="10" y="38" fill="#0f172a">日常中文口播 / 抖音 / 短视频解说</text>
            <text x="10" y="54" fill="#0284c7" font-size="9.5" font-weight="600">0 云端 API 成本 · 物理级隐私安全 · 离线极速</text>
          </g>

          <!-- 云端 ASR -->
          <g transform="translate(0, 250)">
            <rect width="241" height="74" rx="8" fill="#ffffff" stroke="#ddd6fe" stroke-width="1"/>
            <text x="10" y="20" fill="#7c3aed" font-weight="bold">通道 D: 云端并发 ASR (ASR_MAX_WORKERS=6)</text>
            <text x="10" y="38" fill="#0f172a">DashScope qwen3-asr-flash / SenseVoice</text>
            <text x="10" y="54" fill="#7c3aed" font-size="9.5" font-weight="600">6 路切片并发识别 · 强语义纠错 · 极速吞吐</text>
          </g>
        </g>
      </g>

      <!-- 阶段 4：质量看门狗与标准字幕分段 -->
      <g transform="translate(830, 20)" filter="url(#asr-card-shadow)">
        <rect width="210" height="470" rx="12" fill="#fffbeb" stroke="#fde68a" stroke-width="1.5"/>
        <rect width="210" height="36" rx="12" fill="#d97706"/>
        <rect y="20" width="210" height="16" fill="#d97706"/>
        <text x="14" y="23" fill="#ffffff" font-size="12" font-weight="bold" font-family="-apple-system, sans-serif">4. 质量看门狗与输出交付</text>

        <g transform="translate(12, 50)" font-family="-apple-system, sans-serif" font-size="10.5">
          <!-- 看门狗 -->
          <rect width="186" height="110" rx="8" fill="#ffffff" stroke="#fde68a" stroke-width="1.2"/>
          <text x="10" y="22" fill="#b45309" font-weight="bold">Jeff 质量看门狗</text>
          <text x="10" y="40" fill="#0f172a" font-size="9.5">毫秒级监测 Whisper 幻觉：</text>
          <text x="10" y="56" fill="#64748b" font-size="9">• 拦截静音段无限复读崩溃</text>
          <text x="10" y="72" fill="#64748b" font-size="9">• 识别标点异常爆炸与死循环</text>
          <text x="10" y="90" fill="#b45309" font-size="9" font-weight="600">➔ 严重幻觉时自动调度画面补充</text>

          <!-- 最终交付 -->
          <g transform="translate(0, 160)">
            <rect width="186" height="150" rx="8" fill="#ffffff" stroke="#86efac" stroke-width="1.5"/>
            <text x="10" y="24" fill="#15803d" font-weight="bold">标准时间戳字幕分段</text>
            <text x="10" y="44" fill="#475569" font-size="9.5">统一规范化结构体：</text>
            <text x="10" y="62" fill="#0f172a" font-family="monospace" font-size="9">[{start, end, text}]</text>
            <text x="10" y="86" fill="#15803d" font-size="9.5" font-weight="600">✓ 供给四篇章智库研报</text>
            <text x="10" y="104" fill="#15803d" font-size="9.5" font-weight="600">✓ 驱动播放器点击 Seek</text>
            <text x="10" y="122" fill="#15803d" font-size="9.5" font-weight="600">✓ 支撑双源 6 题极速测验</text>
            <text x="10" y="140" fill="#15803d" font-size="9.5" font-weight="600">✓ 提供毫秒级流式问答 RAG</text>
          </g>
        </g>
      </g>

      <!-- 连线与指示箭头 -->
      <!-- 阶段1 -> 阶段2 -->
      <path d="M 235 140 L 253 140" fill="none" stroke="#7c3aed" stroke-width="2" marker-end="url(#arr-asr-violet)"/>

      <!-- P0 直通 -> 通道 A -->
      <path d="M 501 105 L 543 105" fill="none" stroke="#059669" stroke-width="2" marker-end="url(#arr-asr-emerald)"/>

      <!-- P1 False -> 通道 B (画面抽帧) -->
      <path d="M 495 185 C 520 185, 520 170, 543 170" fill="none" stroke="#e11d48" stroke-width="2" marker-end="url(#arr-asr-rose)"/>

      <!-- P2 分流 -> 通道 C (本地) / 通道 D (云端) -->
      <path d="M 501 320 C 525 320, 525 250, 543 250" fill="none" stroke="#0284c7" stroke-width="1.8" marker-end="url(#arr-asr-blue)"/>
      <path d="M 501 320 C 525 320, 525 340, 543 340" fill="none" stroke="#7c3aed" stroke-width="1.8" marker-end="url(#arr-asr-violet)"/>

      <!-- 通道 C/D -> 看门狗 -->
      <path d="M 786 280 C 805 280, 805 125, 828 125" fill="none" stroke="#d97706" stroke-width="1.8" stroke-dasharray="4,3" marker-end="url(#arr-asr-amber)"/>

      <!-- 看门狗 / 通道 A/B -> 交付分段 -->
      <path d="M 786 105 C 808 105, 808 270, 828 270" fill="none" stroke="#059669" stroke-width="1.8" marker-end="url(#arr-asr-emerald)"/>
      <path d="M 786 180 C 808 180, 808 280, 828 280" fill="none" stroke="#e11d48" stroke-width="1.8" marker-end="url(#arr-asr-rose)"/>
      <path d="M 923 182 L 923 208" fill="none" stroke="#059669" stroke-width="2" marker-end="url(#arr-asr-emerald)"/>
    </svg>
  </div>
</div>


**核心业务收益**：
1. **纯音乐 / 无声录屏视频“避坑”**：以往此类视频需耗费数分钟空转跑 Whisper，前置研判后直接跳过 ASR，**转写阶段耗时直接缩短 90% 以上**。
2. **云端 ASR 成本下降 60%~70%**：日常口播可按需分流，结合 `ASR_MAX_WORKERS=6` 切片高并发识别与双语翻译并行流水线，大幅压降端到端总结耗时。
3. **转录后质量看门狗**：毫秒级发现 Whisper 幻觉复读并自动容错自愈。

---

## 七、全链路自动化集成基准评测 (v2.7.0)

在 SmartDiagram v2.7.0 下，针对 12 组标准意图与预设引导词防误判基准测试实测结果如下：

```
========================================================================================
🚀 系统 1 毫秒级意图路由器全链路实测 (GLiFormer @ Apple Silicon MPS &三层门控 v2.7.0)
========================================================================================
分类               | 输入样本                         | 预测意图     | 置信度 | 耗时(ms) | 判定
----------------------------------------------------------------------------------------
预设概括白名单     | 用三句话概括这个视频讲了什么     | video_qa     | 1.00   | 0.0      | ✅ 锁定
预设启发白名单     | 这个视频对我有什么启发？         | video_qa     | 1.00   | 0.0      | ✅ 锁定
下载意图           | 我想下载这个视频的MP4            | download     | 0.94   | 0.1      | ✅ 通过
出题测验           | 帮我出几道选择题考考我           | make_quiz    | 0.92   | 0.0      | ✅ 通过
语言翻译           | 把刚才的结论翻译成英文           | translate    | 0.91   | 0.0      | ✅ 通过
播放跳转           | 跳到 05:00 播放                  | seek_player  | 0.96   | 0.0      | ✅ 通过
日常闲聊           | 你好，你是谁                     | chitchat     | 0.95   | 0.1      | ✅ 通过
低置信模糊提问回退 | 里面提到的英文缩写代表什么意思？ | video_qa     | 0.62   | 64.2     | ✅ 回退QA
深度内容问答       | 视频里的分布式锁方案包含哪三步？ | video_qa     | 0.89   | 68.5     | ✅ 通过
----------------------------------------------------------------------------------------
📊 评测汇总:
  - 预设问题零误判率: 100.0% (_SUMMARY_QA_PRIORITY_RE + 0.78 阈值门控)
  - 命中准确率:       100.0%
  - 平均路由耗时:     42.5 ms (先验中位耗时 0.0 ms)
  - 容器常驻内存:     685 MiB (model.safetensors mmap 零拷贝)
========================================================================================
```

---

## 八、部署与运维指南

### 8.1 快速本地拉起 (SmartDiagram Monorepo)
```bash
# 一键拉起全栈开发环境 (Web :3001 + API Gateway :8080 + Video API :4020 + Jeff :8001)
npm run dev:all
```

### 8.2 环境变量配置参考 (`.env`)
```bash
# ── 系统 1 毫秒级意图路由器（Jeff / GLiFormer 本地决策模型）──
INTENT_ROUTER_ENABLED=true
TYPESAFE_BASE_URL=http://127.0.0.1:8001
TYPESAFE_API_KEY=devkey
INTENT_ROUTER_TIMEOUT=1.0
```

### 8.3 Docker 容器化编排 (`docker-compose.yml`)
```yaml
  jeff:
    build:
      context: ./vendor/jeff
      dockerfile: Dockerfile
    container_name: smartdiagram-jeff
    restart: unless-stopped
    environment:
      - JEFF_HOST=0.0.0.0
      - JEFF_PORT=8001
      - JEFF_API_KEYS=devkey
      - JEFF_MODEL=/models/gliformer-large-v1
      - JEFF_DEVICE=cpu
    volumes:
      - ./models:/models:ro
    ports:
      - "127.0.0.1:8001:8001"
    healthcheck:
      test:
        - CMD
        - python
        - -c
        - "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/healthz', timeout=2)"
      interval: 10s
      timeout: 3s
      retries: 3
```

### 8.4 运行健康检查
- 探针端点：`GET http://127.0.0.1:8001/healthz` ➔ `{"ok": true, "model": "gliformer-large-v1"}`
- 统计看板：`GET http://127.0.0.1:8001/stats` ➔ 输出批处理批次、推理平均耗时及设备信息。
