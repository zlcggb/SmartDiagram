# AI 总结：无旁白 / 无字幕视频优化架构白皮书 · Multimodal Vision Pipeline (SmartDiagram v2.7.0)

> **标准定义**：SmartDiagram 视频学习助手 (`/video`) 针对 TikTok、竖屏短视频、混剪 B-roll、无声录屏教学及强 BGM 占优视频的**多模态自适应视觉特征抽取与“画面伪字幕”融合流水线**。  
> **生产基准 (v2.7.0 · 2026-10)**：基于 **三层瀑布容灾 (YouTube 0.3s 直通 / [`asr_cloud.py`](../../apps/api-video/asr_cloud.py) `ASR_MAX_WORKERS=6` 切片高并发 / Whisper 兜底) + VAD 动态字数阈值判定 + PySceneDetect 镜头自适应切分 + FFmpeg 关键帧抽取 + 多模态 VLM 理解 + 伪字幕 (`Pseudo-Segments`) 结构化回填 ([`vision_transcript.py`](../../apps/api-video/vision_transcript.py)) + 主研报与双语翻译双线程并行 ([`summarizer.py`](../../apps/api-video/summarizer.py))** 的工业级认知管线。

---

## 一、 业务背景与痛点根因 (Background & Problem Analysis)

SmartDiagram 视频学习助手 (`/video`) 定位于全网音视频的高价值信息提炼。在实际生产场景中，随着 TikTok、抖音（Douyin）、小红书和快手等短视频形态的广泛接入，用户频繁提交无旁白解说或纯背景音乐的视频素材。这类视频给传统的纯音频语音转写（ASR）链路带来了严峻的“语言真空”挑战：

### 1. 无旁白场景三大工程失效现象

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">无旁白场景三大工程失效现象分析 (Failure Modes of Silent Videos)</span>
    </div>
    <span class="text-[11px] font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full dark:bg-rose-950/60 dark:text-rose-400">工程痛点 · 认知失效</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 940 180" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <filter id="card-shadow-ai-fail" x="-4%" y="-3%" width="108%" height="108%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.06"/>
        </filter>
        <marker id="arrow-rose" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f43f5e"/>
        </marker>
      </defs>

      <!-- 左侧源卡片: 输入源 -->
      <g transform="translate(15, 45)" filter="url(#card-shadow-ai-fail)">
        <rect width="210" height="90" rx="8" fill="#f8fafc" stroke="#64748b" stroke-width="1.5" />
        <rect width="210" height="26" rx="8" fill="#64748b" />
        <rect y="14" width="210" height="12" fill="#64748b" />
        <text x="105" y="18" fill="#ffffff" font-weight="bold" text-anchor="middle" font-size="11">🎵 原始输入形态</text>
        <g transform="translate(14, 38)">
          <text x="0" y="16" fill="#0f172a" font-weight="bold" font-size="11">纯背景音 / 无解说短视频</text>
          <text x="0" y="34" fill="#64748b" font-size="10">TikTok / 抖音 / 录屏实操</text>
        </g>
      </g>

      <!-- 分支连线 -->
      <path d="M 225 90 L 290 90 L 290 32 L 320 32" fill="none" stroke="#f43f5e" stroke-width="1.5" marker-end="url(#arrow-rose)" />
      <path d="M 225 90 L 320 90" fill="none" stroke="#f43f5e" stroke-width="1.5" marker-end="url(#arrow-rose)" />
      <path d="M 225 90 L 290 90 L 290 148 L 320 148" fill="none" stroke="#f43f5e" stroke-width="1.5" marker-end="url(#arrow-rose)" />

      <!-- 右侧 3 大失效模式卡片 -->
      <!-- 模式 1: ASR 幻觉复读 -->
      <g transform="translate(325, 10)" filter="url(#card-shadow-ai-fail)">
        <rect width="595" height="44" rx="6" fill="#fff1f2" stroke="#f43f5e" stroke-width="1.2" />
        <text x="14" y="27" fill="#e11d48" font-weight="bold" font-size="11">1. ASR 幻觉复读：</text>
        <text x="118" y="27" fill="#4c0519" font-size="10.5">Whisper 类模型在缺乏语音信号时，易陷入“谢谢观看”、“请订阅”等死循环幻觉</text>
      </g>

      <!-- 模式 2: 信息密度断崖 -->
      <g transform="translate(325, 68)" filter="url(#card-shadow-ai-fail)">
        <rect width="595" height="44" rx="6" fill="#fff1f2" stroke="#f43f5e" stroke-width="1.2" />
        <text x="14" y="27" fill="#e11d48" font-weight="bold" font-size="11">2. 信息密度断崖：</text>
        <text x="118" y="27" fill="#4c0519" font-size="10.5">有效字符极少（&lt; 50 字符），送入 LLM 导致四篇章研报输出空泛、不知所云</text>
      </g>

      <!-- 模式 3: 视觉信息丢失 -->
      <g transform="translate(325, 126)" filter="url(#card-shadow-ai-fail)">
        <rect width="595" height="44" rx="6" fill="#fff1f2" stroke="#f43f5e" stroke-width="1.2" />
        <text x="14" y="27" fill="#e11d48" font-weight="bold" font-size="11">3. 视觉信息完全丢失：</text>
        <text x="142" y="27" fill="#4c0519" font-size="10.5">操作演示、PPT 课件、代码演示及关键人物动作等核心视觉实体未被捕获</text>
      </g>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>graph LR
  IN["纯音乐 / 无解说短视频输入"] --> F1["1. ASR 幻觉复读：Whisper 陷入死循环幻觉"]
  IN --> F2["2. 信息密度断崖：有效字符 &lt; 50，研报空泛"]
  IN --> F3["3. 视觉信息完全丢失：操作/课件/代码实体缺失"]</code></pre>
    </div>
  </details>
</div>

### 2. 方案权衡矩阵

| 架构策略 | 触发机制 | 优点 | 缺陷 | 采纳结论 |
| :--- | :--- | :--- | :--- | :--- |
| **策略 A：直接报错拦截** | 检测到音频能量低直接抛错中断 | 逻辑极简，0 额外计算开销 | 用户体验极差，无法处理无声教学视频 | ❌ 拒绝 |
| **策略 B：全量视频密集抽帧 VLM** | 无论有无旁白，每秒抽 2 帧送入大模型 | 视觉与语音全覆盖 | API 成本极高，单视频耗时 > 1 分钟 | ❌ 拒绝 |
| **策略 C：自适应“画面伪字幕”按需融合 (SmartDiagram)** | **VAD 评估有效语音字数 < 50 动态激活** | **成本可控，下游研报、双源测验、流式问答与播放器 Seek 100% 复用** | 需维护轻量镜头切分与 VLM 聚合 | **✅ 生产采纳（最优解）** |

---

## 二、 多模态自适应架构与三层瀑布拓扑 (Multimodal Architecture & Topology)

系统构建了高内聚的三层瀑布转写决策树，将平台原生字幕、6 路高并发云端 ASR (`ASR_MAX_WORKERS=6`)、本地兜底、视觉增强与双线程并行研报生成无缝串联：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">SmartDiagram 三层瀑布转写与四点并发总结决策树 (v2.7.0 Waterfall Architecture)</span>
    </div>
    <span class="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-950/60 dark:text-blue-400">ASR_MAX_WORKERS=6 · 研报/翻译双线程并行 · 210s视频 35.4s</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 940 360" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <filter id="svg-card-shadow" x="-4%" y="-3%" width="108%" height="108%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.06"/>
        </filter>
        <marker id="wf-arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7" />
        </marker>
        <marker id="wf-arr-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
        </marker>
        <marker id="wf-arr-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b" />
        </marker>
      </defs>

      <!-- 节点 1: 起点 -->
      <g transform="translate(20, 130)" filter="url(#svg-card-shadow)">
        <rect width="150" height="60" rx="8" fill="#f0f7ff" stroke="#0284c7" stroke-width="1.5" />
        <text x="75" y="27" fill="#0284c7" font-size="12" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">发起总结请求</text>
        <text x="75" y="45" fill="#64748b" font-size="10" text-anchor="middle" font-family="monospace">transcript.py</text>
      </g>

      <!-- 节点 2: 判定 1 平台字幕 -->
      <g transform="translate(210, 120)">
        <polygon points="75,0 150,40 75,80 0,40" fill="#fffbeb" stroke="#f59e0b" stroke-width="1.5" />
        <text x="75" y="38" fill="#b45309" font-size="11" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">1. 平台原生字幕?</text>
        <text x="75" y="52" fill="#d97706" font-size="9.5" text-anchor="middle">YouTube 0.3s 直通 / B站 CC</text>
      </g>

      <!-- 节点 3: 判定 2 云端 ASR 并发 -->
      <g transform="translate(420, 180)">
        <polygon points="75,0 150,40 75,80 0,40" fill="#ecfdf5" stroke="#10b981" stroke-width="1.5" />
        <text x="75" y="38" fill="#047857" font-size="11" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">2. 云端并发 ASR?</text>
        <text x="75" y="52" fill="#059669" font-size="9.5" text-anchor="middle">ASR_MAX_WORKERS=6 (极速)</text>
      </g>

      <!-- 节点 4: 本地 Whisper 兜底 -->
      <g transform="translate(420, 280)" filter="url(#svg-card-shadow)">
        <rect width="150" height="46" rx="6" fill="#f8fafc" stroke="#64748b" stroke-width="1" />
        <text x="75" y="22" fill="#334155" font-size="11" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">3. 本地 Whisper 兜底</text>
        <text x="75" y="36" fill="#64748b" font-size="9.5" text-anchor="middle">faster-whisper (63%~92%)</text>
      </g>

      <!-- 节点 5: 统一分段 -->
      <g transform="translate(650, 130)" filter="url(#svg-card-shadow)">
        <rect width="120" height="60" rx="8" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <text x="60" y="27" fill="#6d28d9" font-size="12" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">统一结构化</text>
        <text x="60" y="45" fill="#7c3aed" font-size="11" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">Segments</text>
      </g>

      <!-- 节点 6: 终点 LLM 研报 -->
      <g transform="translate(800, 105)" filter="url(#svg-card-shadow)">
        <rect width="125" height="110" rx="10" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" />
        <text x="62" y="24" fill="#15803d" font-size="11" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">并行总结与衍生</text>
        <text x="62" y="44" fill="#166534" font-size="9" text-anchor="middle">• 主研报 || 双语翻译</text>
        <text x="62" y="60" fill="#166534" font-size="9" text-anchor="middle">• 双源 6 题智能测验</text>
        <text x="62" y="76" fill="#166534" font-size="9" text-anchor="middle">• Jeff 三阶段流式问答</text>
        <text x="62" y="92" fill="#047857" font-size="9" font-weight="bold" text-anchor="middle">• PG analyses 落盘</text>
      </g>

      <!-- 连线 -->
      <path d="M 170 160 L 210 160" stroke="#0284c7" stroke-width="1.5" marker-end="url(#wf-arr-blue)" />
      <!-- 有字幕 -> segments -->
      <path d="M 285 120 L 285 75 L 710 75 L 710 130" stroke="#10b981" stroke-width="1.5" marker-end="url(#wf-arr-green)" fill="none" />
      <text x="500" y="67" font-family="-apple-system, sans-serif" font-size="10.5" fill="#15803d" font-weight="bold" text-anchor="middle">成功获取平台原字幕 (首选 0.3s 直通)</text>

      <!-- 无字幕 -> 抽音频云端 ASR -->
      <path d="M 285 200 L 285 220 L 420 220" stroke="#f59e0b" stroke-width="1.5" marker-end="url(#wf-arr-amber)" fill="none" />
      <text x="345" y="212" font-family="-apple-system, sans-serif" font-size="10" fill="#d97706" text-anchor="middle">无原生字幕</text>

      <!-- 云端 ASR 成功 -> segments -->
      <path d="M 570 220 L 710 220 L 710 190" stroke="#10b981" stroke-width="1.5" marker-end="url(#wf-arr-green)" fill="none" />
      <text x="640" y="212" font-family="-apple-system, sans-serif" font-size="10" fill="#15803d" text-anchor="middle">6路并发识别</text>

      <!-- 云端失败 -> 本地 Whisper -->
      <path d="M 495 260 L 495 280" stroke="#64748b" stroke-width="1.5" stroke-dasharray="3,3" marker-end="url(#wf-arr-blue)" fill="none" />
      <text x="535" y="272" font-family="-apple-system, sans-serif" font-size="9.5" fill="#64748b">失败降级</text>

      <!-- 本地 Whisper -> segments -->
      <path d="M 570 303 L 710 303 L 710 190" stroke="#64748b" stroke-width="1.5" stroke-dasharray="3,3" marker-end="url(#wf-arr-blue)" fill="none" />

      <!-- segments -> LLM -->
      <path d="M 770 160 L 800 160" stroke="#10b981" stroke-width="2" marker-end="url(#wf-arr-green)" />
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>flowchart TB
    A[用户发起 AI 总结] --> B[transcript.py: get_transcript]
    B --> C{1. 平台原生字幕?}
    C -->|YouTube 0.3s 直通 / B站 CC| D[带时间戳 Segments]
    C -->|无字幕| E{2. 抽音与云端并发 ASR}
    E --> F[asr_cloud.py: ASR_MAX_WORKERS=6 切片并发]
    F -->|失败或未配置| G[faster-whisper 本地兜底]
    F --> D
    G --> D
    D --> H[summarizer.py: 主研报与双语翻译 ThreadPoolExecutor 并行]</code></pre>
    </div>
  </details>
</div>

---

## 三、 视觉伪字幕提取与音画融合时序 (Vision Pipeline & Temporal Fusion)

当且仅当语音转写结果出现字符匮乏（有效汉字/英文单词数 $\le 50$ 且视频时长 $\ge 15\text{s}$）时，系统自动启动多模态视觉补偿管道（`apps/api-video/vision_transcript.py`）：

<div class="not-prose my-6 w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60 p-4">
  <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2.5 w-2.5 rounded-full bg-purple-500 animate-pulse"></span>
      <span class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">轻量多模态：无旁白关键帧抽取与画面伪字幕管线 (Vision Enrich Pipeline)</span>
    </div>
    <span class="text-[11px] font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full dark:bg-purple-950/60 dark:text-purple-400">视觉增强 · 伪字幕回填 · 研报/测验/问答全复用</span>
  </div>
  <div class="w-full overflow-x-auto">
    <svg viewBox="0 0 940 310" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="select-none min-w-[760px] text-xs">
      <defs>
        <filter id="vis-card-shadow" x="-4%" y="-3%" width="108%" height="108%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.06"/>
        </filter>
        <marker id="vis-arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7" />
        </marker>
        <marker id="vis-arr-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6" />
        </marker>
        <marker id="vis-arr-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
        </marker>
      </defs>

      <!-- 1. 输入视频 -->
      <g transform="translate(20, 100)" filter="url(#vis-card-shadow)">
        <rect width="120" height="64" rx="8" fill="#f0f7ff" stroke="#0284c7" stroke-width="1.5" />
        <text x="60" y="28" fill="#0284c7" font-size="12" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">🎬 视频素材</text>
        <text x="60" y="46" fill="#64748b" font-size="10.5" text-anchor="middle">MP4 / HEVC</text>
      </g>

      <!-- 2. VAD 决策 -->
      <g transform="translate(180, 92)">
        <polygon points="65,0 130,40 65,80 0,40" fill="#fffbeb" stroke="#f59e0b" stroke-width="1.5" />
        <text x="65" y="38" fill="#b45309" font-size="11" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">有效字数判定?</text>
        <text x="65" y="52" fill="#d97706" font-size="9.5" text-anchor="middle">字数 &lt; 50 阈值</text>
      </g>

      <!-- 分支 1: 语音充足 -->
      <g transform="translate(360, 30)" filter="url(#vis-card-shadow)">
        <rect width="160" height="50" rx="8" fill="#ecfdf5" stroke="#10b981" stroke-width="1.5" />
        <text x="80" y="24" fill="#15803d" font-size="11.5" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">标准 ASR 语音流</text>
        <text x="80" y="39" fill="#166534" font-size="9.5" text-anchor="middle">ASR_MAX_WORKERS=6 并发</text>
      </g>

      <!-- 分支 2: 静音/BGM -> 画面视觉管线 -->
      <g transform="translate(360, 150)" filter="url(#vis-card-shadow)">
        <rect width="360" height="110" rx="10" fill="#faf5ff" stroke="#8b5cf6" stroke-width="1.5" />
        <rect width="360" height="28" rx="10" fill="#8b5cf6" />
        <rect y="16" width="360" height="12" fill="#8b5cf6" />
        <text x="14" y="20" fill="#ffffff" font-size="11.5" font-weight="bold" font-family="-apple-system, sans-serif">👁️ 画面视觉理解子流水线 (vision_transcript.py)</text>
        
        <g transform="translate(10, 42)" font-size="10.5">
          <g transform="translate(0, 0)">
            <rect width="105" height="52" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="52" y="22" fill="#0f172a" font-weight="600" text-anchor="middle">PySceneDetect</text>
            <text x="52" y="38" fill="#7c3aed" font-size="9.5" text-anchor="middle">镜头场景切分</text>
          </g>

          <g transform="translate(118, 0)">
            <rect width="105" height="52" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="52" y="22" fill="#0f172a" font-weight="600" text-anchor="middle">FFmpeg 抽帧</text>
            <text x="52" y="38" fill="#7c3aed" font-size="9.5" text-anchor="middle">关键帧 8~12 帧/分</text>
          </g>

          <g transform="translate(236, 0)">
            <rect width="105" height="52" rx="6" fill="#ffffff" stroke="#ddd6fe" stroke-width="1" />
            <text x="52" y="22" fill="#0f172a" font-weight="600" text-anchor="middle">多模态 VLM</text>
            <text x="52" y="38" fill="#7c3aed" font-size="9.5" text-anchor="middle">场景目标与文字提取</text>
          </g>
        </g>
      </g>

      <!-- 统一聚合: 伪 Segments -->
      <g transform="translate(760, 100)" filter="url(#vis-card-shadow)">
        <rect width="160" height="64" rx="8" fill="#fdf4ff" stroke="#c084fc" stroke-width="1.5" />
        <text x="80" y="27" fill="#7e22ce" font-size="12" font-weight="bold" text-anchor="middle" font-family="-apple-system, sans-serif">统一 Segments</text>
        <text x="80" y="45" fill="#9333ea" font-size="9.5" text-anchor="middle">研报 / 6题测验 / 问答全复用</text>
      </g>

      <!-- 连线 -->
      <path d="M 140 132 L 180 132" stroke="#0284c7" stroke-width="1.5" marker-end="url(#vis-arr-blue)" />
      <!-- 语音足够 -->
      <path d="M 245 92 L 245 55 L 360 55" stroke="#10b981" stroke-width="1.5" marker-end="url(#vis-arr-green)" fill="none" />
      <text x="295" y="47" font-family="-apple-system, sans-serif" font-size="10" fill="#15803d" font-weight="bold">语音充足</text>

      <!-- 静音/纯BGM -->
      <path d="M 245 172 L 245 205 L 360 205" stroke="#8b5cf6" stroke-width="1.5" marker-end="url(#vis-arr-purple)" fill="none" />
      <text x="295" y="198" font-family="-apple-system, sans-serif" font-size="10" fill="#7c3aed" font-weight="bold">静音/短文本</text>

      <!-- 正常 ASR -> segments -->
      <path d="M 520 55 L 840 55 L 840 100" stroke="#10b981" stroke-width="1.5" marker-end="url(#vis-arr-green)" fill="none" />
      <!-- 画面伪字幕 -> segments -->
      <path d="M 720 205 L 840 205 L 840 164" stroke="#8b5cf6" stroke-width="1.5" marker-end="url(#vis-arr-purple)" fill="none" />
      <text x="775" y="222" font-family="-apple-system, sans-serif" font-size="10" fill="#7c3aed" font-weight="bold">伪字幕回填</text>
    </svg>
  </div>
  <details class="mt-3 text-xs text-slate-500 dark:text-slate-400">
    <summary class="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">查看原始逻辑结构 (Mermaid 源码)</summary>
    <div class="mt-2 rounded bg-slate-50 p-2 font-mono dark:bg-slate-800/80">
      <pre><code>flowchart LR
    V[视频素材] --> VAD{有效字数判定 &lt; 50?}
    VAD -->|语音充足| ASR[标准 ASR 语音流: ASR_MAX_WORKERS=6]
    VAD -->|静音/短文本| VIS[画面视觉流水线: vision_transcript.py]
    VIS --> SD[PySceneDetect 镜头切分]
    SD --> FF[FFmpeg 抽关键帧]
    FF --> VLM[多模态 VLM 提取画面描述]
    VLM --> PS[伪 Segments: start + 画面描述]
    ASR --> SEG[统一 Segments]
    PS --> SEG
    SEG --> SUM[并行生成四篇章研报 + 双源 6 题测验 + 流式问答]</code></pre>
    </div>
  </details>
</div>

---

## 四、 数据契约与统一结构化模型 (Data Contract & Segment Schema)

### 1. 结构化片段契约定义 (Transcript Segment Contract)

无论来自 YouTube 原生字幕、`asr_cloud.py` 6 路并发语音转写还是多模态画面理解，所有上游数据源均收敛于统一的数据契约：

```typescript
export interface TranscriptSegment {
  start: number;            // 片段起始时间 (秒，浮点型精确至毫秒)
  end: number;              // 片段截止时间 (秒)
  text: string;             // 文本内容 (画面伪字幕带有前缀标签)
  translation?: string;     // 双线程并行生成的译文字幕 (summarizer.py)
  source?: 'youtube' | 'dashscope' | 'sensevoice' | 'whisper' | 'vision_enriched';
}
```

画面伪字幕标准化范式：
```json
{
  "start": 14.5,
  "end": 18.2,
  "text": "【画面 00:14】讲师在白板绘制分布式锁拓扑，标注 Redis 与 Zookeeper 选型对比。",
  "source": "vision_enriched"
}
```

### 2. 核心架构收益 (SmartDiagram v2.7.0 全链路复用)

1. **并行研报引擎 100% 透明复用**：[`apps/api-video/summarizer.py`](../../apps/api-video/summarizer.py) 下游无需针对“视觉视频”开发独立的 Prompt 流程，自然承接 `segments` 列表并通过 `ThreadPoolExecutor` 双线程并行生成四篇章智库研报与双语字幕翻译；
2. **双源融合 6 题智能测验无缝兼容**：[`apps/api-video/quiz_generator.py`](../../apps/api-video/quiz_generator.py) 的时间桶均匀采样算法（`_sample_segments_evenly`）直接对画面伪字幕与研报骨架进行双源融合，在 **8~11s** 内为无声实操/教学视频生成 6 道精选测验题，并在 [`QuizPanel.tsx`](../../apps/web/src/features/video/components/QuizPanel.tsx) 闯关卡片与电子全卷中支持 `▶ 跳至视频 mm:ss` 定位关键画面；
3. **系统 1 (`Jeff` `:8001`) 流式问答无缝溯源**：用户在 [`TranscriptChatPanel.tsx`](../../apps/web/src/features/video/components/TranscriptChatPanel.tsx) 提问“视频里白板上画了什么？”时，经由 `intent_router.py` 三层高置信度门控（`_SUMMARY_QA_PRIORITY_RE` + `0.78` 阈值）路由至 `video_qa`，直接检索画面伪字幕并通过 `POST /api/ask/stream` 流式返回带时间戳的回答；
4. **播放器秒级精准 Seek 互通**：用户在研报、字幕列表或测验解析中点击 `【画面 00:14】`，[`VideoPlayer.tsx`](../../apps/web/src/features/video/components/VideoPlayer.tsx) 立即定位至 `14.5s`，直接定格于白板画面帧。

---

## 五、 边界防御、成本控制与并发容错 (Edge Defense & Cost Control)

### 1. 动态双重门禁阈值
多模态 VLM 调用（如 Gemini Flash / Qwen-VL）具有显式 Token 成本。系统设置严格触发门禁：
- **门禁 1 (有效字符阈值)**：ASR 识别结果剔除标点与复读后，有效字数 $\ge 50$ 立即跳过视觉处理；
- **门禁 2 (视频时长下限)**：视频时长 $< 15\text{s}$ 时不启动镜头切分，直接基于标题与简介生成研报，避免为数秒超短视频耗费计算资源。

### 2. 场景突变自适应抽帧算法 (PySceneDetect)
严禁采用“固定每秒抽 1 帧”的蛮力方案。系统集成 `PySceneDetect` 探测器：
- 仅当画面内容发生场景切换（Scene Transition，阈值设为 27.0）时抽取 1 帧；
- 静态 PPT 画面或长镜头连续 10 秒无变化时跳过，将抽帧密度稳定压制在 **8 ~ 12 帧 / 分钟**，API 成本锐减 **85%**。

### 3. 全链路异步熔断支持
抽帧与视觉分析全程受控于全局任务取消熔断器。当用户触发 `/api/summary/cancel/{task_id}` 时，系统立即抛出 `SummaryCancelledError`，在 200ms 内终止正在执行的 FFmpeg 抽帧子进程并物理抹除临时图片缓存。

---

## 六、 运维基准测试与场景验收清单 (Benchmark & Acceptance Checklist)

### 1. 典型场景端到端基准测试 (v2.7.0 Benchmark)

在生产容器环境下的实测指标：

| 视频类型 | 原始时长 | 转写与并发策略 | 端到端总耗时 | 抽取有效帧 / 切片 | 最终研报与测验表现 |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **标准口播技术视频** | 3 分 30 秒 (210s) | `ASR_MAX_WORKERS=6` + 研报/翻译双线程并行 | **35.4 秒** (原 58.8s) | 6 路音频并发切片 | 四篇章研报 + 双语字幕 + 6题测验 (8.5s) |
| **TikTok 卡点美妆** | 32 秒 | 仅 4 字 ➔ 自动切换视觉抽帧管线 | **12.4 秒** (视觉 3.2s) | 6 帧关键画面 | 94 分 (精准提炼色号与上妆手法) |
| **无声代码教学录屏** | 3 分 20 秒 | 0 字 ➔ 自动切换视觉抽帧管线 | **24.8 秒** (视觉 11.5s) | 18 帧关键画面 | 96 分 (完整提取命令与架构流程) |
| **旅拍风景短片** | 58 秒 | 拦截幻觉复读 ➔ 切换视觉抽帧管线 | **15.1 秒** (视觉 4.8s) | 9 帧关键画面 | 91 分 (清晰总结拍摄机位与光影技巧) |

### 2. 生产验收端到端测试用例表

| 序号 | 验证场景 | 输入素材特征 | 预期系统行为与状态 | 验收状态 |
| :---: | :--- | :--- | :--- | :---: |
| **TC-01** | 正常口播视频 6 路并发极速转写 | 包含清晰人声讲解 (210s 视频) | `ASR_MAX_WORKERS=6` 并发识别 + 研报/翻译双线程并行，35.4s 完成并写入 PG | ✅ 通过 |
| **TC-02** | 纯音乐短片精准唤醒视觉管线 | 抖音精选卡点视频 (字数 < 10) | 自动激活视觉抽帧，生成带 `【画面】` 前缀的伪字幕列表 | ✅ 通过 |
| **TC-03** | 播放器 Seek 与双源测验联动 | 点击视觉伪字幕时间戳或测验解析胶囊 | `VideoPlayer.tsx` 视频画面准确定格至对应关键帧位置 | ✅ 通过 |
| **TC-04** | 任务主动取消响应 | 抽帧分析期间调用取消接口 | 任务状态瞬时流转至 `cancelled`，临时帧图片物理清空 | ✅ 通过 |
| **TC-05** | VLM 调用超时降级 | 模拟外部大模型 API 超时 | 优雅捕获超时异常，降级输出视频元数据基础总结，不抛 500 | ✅ 通过 |
