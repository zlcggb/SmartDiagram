import { useState } from 'react';
import { Link } from 'react-router-dom';

type CategoryId = 'all' | 'ai' | 'asr' | 'arch' | 'quiz' | 'platform';

const CATEGORIES: Array<{ id: CategoryId; label: string }> = [
  { id: 'all', label: '全部更新' },
  { id: 'ai', label: 'AI 研报总结' },
  { id: 'asr', label: '流式 ASR (35.4s)' },
  { id: 'arch', label: '全栈架构' },
  { id: 'quiz', label: '学习测验' },
  { id: 'platform', label: '播放与下载' },
];

const VERSIONS = [
  { id: 'v2.7.0', label: 'v2.7.0', latest: true, date: '2026年10月24日' },
  { id: 'v2.6.0', label: 'v2.6.0', date: '2026年10月23日' },
  { id: 'v2.5.0', label: 'v2.5.0', date: '2026年10月11日' },
  { id: 'v2.4.0', label: 'v2.4.0', date: '2026年8月7日' },
  { id: 'v2.3.0', label: 'v2.3.0', date: '2026年6月25日' },
  { id: 'v2.0.0', label: 'v2.0.0', date: '2026年6月20日' },
  { id: 'v1.0.0', label: 'v1.0.0', date: '2026年6月10日' },
];

export function VideoChangelogPage() {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all');
  const [expandAll, setExpandAll] = useState(true);
  const [activeVersion, setActiveVersion] = useState('v2.7.0');
  const [copySuccess, setCopySuccess] = useState(false);
  const [archMode, setArchMode] = useState<'architecture' | 'sequence' | 'benchmark'>('architecture');
  const [collapseState, setCollapseState] = useState<Record<string, boolean>>({
    'v2.7.0-features': true,
    'v2.7.0-fixes': true,
    'v2.6.0-features': true,
    'v2.6.0-fixes': true,
    'v2.5.0-features': true,
    'v2.5.0-fixes': true,
    'v2.4.0-features': true,
    'v2.3.0-features': false,
    'v2.0.0-features': false,
    'v1.0.0-features': false,
  });

  const toggleCollapse = (key: string) => {
    setCollapseState((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleToggleAll = () => {
    const next = !expandAll;
    setExpandAll(next);
    const updated: Record<string, boolean> = {};
    for (const k of Object.keys(collapseState)) {
      updated[k] = next;
    }
    setCollapseState(updated);
  };

  const shouldShowVersion = (vId: string): boolean => {
    if (activeCategory === 'all') return true;
    if (activeCategory === 'ai' && ['v2.7.0', 'v2.6.0', 'v2.5.0', 'v2.0.0'].includes(vId)) return true;
    if (activeCategory === 'asr' && ['v2.7.0', 'v2.5.0', 'v2.3.0'].includes(vId)) return true;
    if (activeCategory === 'arch' && ['v2.7.0', 'v2.6.0', 'v2.5.0', 'v1.0.0'].includes(vId)) return true;
    if (activeCategory === 'quiz' && ['v2.7.0', 'v2.4.0'].includes(vId)) return true;
    if (activeCategory === 'platform' && ['v2.7.0', 'v2.6.0', 'v2.3.0', 'v1.0.0'].includes(vId)) return true;
    return false;
  };

  const scrollToVersion = (id: string) => {
    setActiveVersion(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCopyChangelog = async () => {
    const md = `# 视频学习助手 (SmartDiagram /video) 更新记录与架构全景

## v2.7.0 (2026-10-24 · LATEST)
- 🏛️ SmartDiagram 统一平台全栈融合：定制单行毛玻璃导航栏、Portal 中央紧凑视频切换条、思维导图一键移交 /diagram 画布编辑。
- ⚡ 四点并发极速总结管线：6 线程切片并发 ASR (210s 仅 6.7s) + 主总结与双语字幕并行生成，端到端耗时从 58.8s 降至 35.4s。
- 🧭 系统 1 (Jeff) 三层高置信意图门控：总结优先白名单 + 0.78 置信度门控，预设引导词与开放式提问 100% 稳定触发总结问答。
- 🎯 Apple Study Deck 闯关卡片 + 紧凑电子全卷 + 双重持久化：6 题精选极速出题，支持闯关卡片与全卷流式滚动切换，PostgreSQL + localStorage 双重持久化。
- 🎵 平台彩色徽章与 100% 自动流式保存：自动识别抖音/B站/小红书/YouTube 徽章，下载完成立即触发浏览器保存。

## v2.6.0 (2026-10-23)
- ⚡ 云端共享系统 1 (Jeff) 低内存架构：Safetensors mmap 零拷贝映射，容器内存从 4.81 GB 降至 685 MiB。
- 🧠 双系统 SSE 流式问答与精细耗时拆分：POST /api/ask/stream 实时展示 ⚡ Jev系统1耗时 + 🧠 大模型耗时(含首字TTFT) + 🕒 时间戳。
- 🎯 秒级 Range 时间轴精准跳转：修复 Nginx 剥离 Range 导致重置归零问题。
- 🗄️ PostgreSQL 16 问答持久化与历史回放闭环。
`;
    try {
      await navigator.clipboard.writeText(md);
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-[#f5f5f7] text-slate-900 pb-24">
      {/* 顶部面包屑与操作条 */}
      <div className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-2.5">
          <div className="flex items-center gap-2 text-[12.5px] text-slate-500">
            <Link to="/video" className="hover:text-[#0071e3] transition">
              视频学习助手
            </Link>
            <span>/</span>
            <Link to="/video/docs" className="hover:text-[#0071e3] transition">
              文档中心
            </Link>
            <span>/</span>
            <span className="font-semibold text-slate-900">更新记录 (Changelog)</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/video/docs"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[12px] font-medium text-slate-700 transition hover:border-[#0071e3]/40 hover:text-[#0071e3]"
            >
              <span>📖</span>
              <span>打开文档中心 (30篇)</span>
            </Link>
            <button
              type="button"
              onClick={handleCopyChangelog}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1 text-[12px] font-medium text-slate-800 transition hover:bg-slate-50 active:scale-95 cursor-pointer"
            >
              <span>{copySuccess ? '✓ 已复制 Markdown' : '📋 复制 Markdown'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 主标题与分类过滤 */}
      <div className="mx-auto max-w-[1240px] px-6 pt-8 pb-6">
        <div className="max-w-3xl">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#0071e3]/10 px-3 py-1 text-[11.5px] font-bold text-[#0071e3]">
            <span>🚀 SmartDiagram Unified Platform · Video Learning v2.7.0</span>
          </div>
          <h1 className="text-[32px] font-bold tracking-tight text-slate-900 md:text-[38px]">
            更新记录与全栈架构演进
          </h1>
          <p className="mt-2.5 text-[14.5px] leading-relaxed text-slate-600">
            实时追踪视频学习助手从独立终端到融合进 SmartDiagram 统一工作台的特性升级、并发性能基准与底层架构演进。
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition cursor-pointer ${
                  activeCategory === cat.id
                    ? 'bg-slate-900 text-white shadow-xs font-semibold'
                    : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200/70'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-[12px] text-slate-500">
            <button
              type="button"
              onClick={handleToggleAll}
              className="font-semibold text-[#0071e3] hover:underline cursor-pointer"
            >
              {expandAll ? '折叠全部版本详情' : '展开全部版本详情'}
            </button>
          </div>
        </div>
      </div>

      {/* 正文双栏：左侧版本时间轴 + 右侧 Sticky 版本导航 */}
      <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-10 px-6 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0 space-y-14">
          {/* ================= v2.7.0 (最新重大版本) ================= */}
          {shouldShowVersion('v2.7.0') && (
            <section
              id="v2.7.0"
              className="scroll-mt-20 grid grid-cols-1 md:grid-cols-[170px_minmax(0,1fr)] gap-6 md:gap-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[20px] font-bold text-slate-900">v2.7.0</span>
                  <span className="rounded-full bg-[#0071e3] px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                    LATEST
                  </span>
                </div>
                <p className="text-[12.5px] text-slate-500 font-mono">2026年10月24日</p>
                <p className="text-[11.5px] text-[#0071e3] font-semibold">
                  🏛️ SmartDiagram 平台融合与极速大版本
                </p>
              </div>

              <div className="min-w-0 space-y-5">
                <div>
                  <h2 className="text-[20px] font-bold tracking-tight text-slate-900">
                    SmartDiagram 统一平台融合、四点并发极速总结 (35.4s)、高置信意图门控与 Apple 闯关/全卷测验双持久化
                  </h2>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
                    将视频学习助手全面合入 SmartDiagram 统一架构（<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px]">/video</code>），定制专属单行毛玻璃顶栏并支持思维导图一键移交 <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px]">/diagram</code> 画布编辑；通过 6 线程并发 ASR 与主研报/双语字幕并行推理，将 210s 视频端到端耗时从 58.8s 压降至 <strong>35.4s</strong>；引入 Jeff 0.78 高置信度三层门控消除引导词误触；重构学习测验为「🎴 闯关卡片 + 📋 紧凑电子全卷」双视图并实现 PostgreSQL + 本地双重持久化。
                  </p>
                </div>

                {/* v2.7.0 原生 SVG 架构图 */}
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0071e3]/10 text-[#0071e3]">
                        🏛️
                      </span>
                      <span className="text-[13.5px] font-bold text-slate-900">
                        v2.7.0 SmartDiagram 统一平台融合与四点并发极速总结架构图
                      </span>
                    </div>
                    <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#0071e3]">
                      Unified Monorepo · 35.4s Pipeline
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 1160 480"
                      width="100%"
                      height="100%"
                      className="select-none min-w-[760px]"
                      fontFamily="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
                    >
                      <rect width="1160" height="480" rx="14" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
                      <rect x="20" y="16" width="1120" height="52" rx="10" fill="#0f172a" />
                      <text x="38" y="39" fill="#ffffff" fontSize="15" fontWeight="bold">
                        SmartDiagram /video v2.7.0 · 跨工作台融合、四点并发极速总结 (35.4s)、高置信意图门控与测验双持久化
                      </text>
                      <text x="38" y="57" fill="#94a3b8" fontSize="11">
                        专属单行导航栏 + Portal 视频切换  ➔  6 线程 ASR + 研报/翻译并行  ➔  Jeff 0.78 门控  ➔  闯关卡片/全卷考卷 + PG 双写
                      </text>

                      <g transform="translate(20, 84)">
                        <rect width="262" height="310" rx="12" fill="#ffffff" stroke="#0071e3" strokeWidth="1.5" />
                        <rect width="262" height="34" rx="12" fill="#0071e3" />
                        <text x="131" y="22" fill="#ffffff" fontSize="12.5" fontWeight="bold" textAnchor="middle">
                          1. SmartDiagram 专属融合工作台
                        </text>
                        <text x="20" y="60" fill="#0369a1" fontSize="11.5" fontWeight="bold">
                          🖥️ VideoShell 单行毛玻璃导航栏
                        </text>
                        <text x="20" y="82" fill="#0f172a" fontSize="10.5">• 隐藏模拟桌面顶栏，释放垂直空间</text>
                        <text x="20" y="102" fill="#0f172a" fontSize="10.5">• Portal 中央嵌入紧凑已解析视频条</text>
                        <text x="20" y="122" fill="#0f172a" fontSize="10.5">• 🎵 抖音/B站/小红书徽章 + 一键直存</text>
                        <text x="20" y="142" fill="#047857" fontSize="10.5" fontWeight="bold">• 思维导图一键移交 /diagram 画布</text>
                        <line x1="16" y1="162" x2="246" y2="162" stroke="#e2e8f0" />
                        <text x="20" y="186" fill="#0f172a" fontSize="11.5" fontWeight="bold">
                          🎨 CJK 研报与流程卡片渲染引擎
                        </text>
                        <text x="20" y="208" fill="#475569" fontSize="10.5">• 中文标点紧邻 **加粗** 与 *重点* 兼容</text>
                        <text x="20" y="228" fill="#475569" fontSize="10.5">• [阶段一] -&gt; [阶段二] 自动转流程卡片</text>
                        <text x="20" y="248" fill="#475569" fontSize="10.5">• *话术示范* 自动渲染胶囊徽章微卡片</text>
                        <text x="20" y="270" fill="#0071e3" fontSize="10.5" fontWeight="bold">• 文档中心 (/docs) + 更新记录 (/changelog)</text>
                      </g>

                      <g transform="translate(306, 84)">
                        <rect width="262" height="310" rx="12" fill="#ffffff" stroke="#10b981" strokeWidth="1.5" />
                        <rect width="262" height="34" rx="12" fill="#10b981" />
                        <text x="131" y="22" fill="#ffffff" fontSize="12.5" fontWeight="bold" textAnchor="middle">
                          2. 四点并发极速总结 (35.4s)
                        </text>
                        <text x="20" y="60" fill="#047857" fontSize="11.5" fontWeight="bold">
                          ⚡ 6 线程 ASR + 研报/翻译并行
                        </text>
                        <text x="20" y="82" fill="#0f172a" fontSize="10.5">• FFmpeg 单次极速重采样与并发切块</text>
                        <text x="20" y="102" fill="#0f172a" fontSize="10.5">• ASR_MAX_WORKERS=6 (210s 仅 6.7s)</text>
                        <text x="20" y="122" fill="#0f172a" fontSize="10.5">• 主研报 LLM 与双语字幕翻译双线程并行</text>
                        <text x="20" y="142" fill="#047857" fontSize="10.5" fontWeight="bold">• 端到端耗时：58.8s ➔ 35.4s (-40%)</text>
                        <line x1="16" y1="162" x2="246" y2="162" stroke="#e2e8f0" />
                        <text x="20" y="186" fill="#0f172a" fontSize="11.5" fontWeight="bold">
                          🧭 Jeff 三层高置信意图门控
                        </text>
                        <text x="20" y="208" fill="#475569" fontSize="10.5">• 1层：总结/概括/核心观点硬优先白名单</text>
                        <text x="20" y="228" fill="#475569" fontSize="10.5">• 2层：功能动作特征词二次校验</text>
                        <text x="20" y="248" fill="#475569" fontSize="10.5">• 3层：Confidence &gt;= 0.78 门控防误触</text>
                        <text x="20" y="270" fill="#047857" fontSize="10.5" fontWeight="bold">• 预设引导词 100% 归正为总结问答</text>
                      </g>

                      <g transform="translate(592, 84)">
                        <rect width="262" height="310" rx="12" fill="#ffffff" stroke="#6366f1" strokeWidth="1.5" />
                        <rect width="262" height="34" rx="12" fill="#6366f1" />
                        <text x="131" y="22" fill="#ffffff" fontSize="12.5" fontWeight="bold" textAnchor="middle">
                          3. 闯关卡片 + 紧凑电子全卷
                        </text>
                        <text x="20" y="60" fill="#4338ca" fontSize="11.5" fontWeight="bold">
                          🎴 Apple Study Deck 闯关模式
                        </text>
                        <text x="20" y="82" fill="#0f172a" fontSize="10.5">• 时间桶均匀采样 + 研报骨架双源出题</text>
                        <text x="20" y="102" fill="#0f172a" fontSize="10.5">• 6 题精选极速生成（耗时 25s ➔ 9s）</text>
                        <text x="20" y="122" fill="#0f172a" fontSize="10.5">• 即选即判、依据折叠、底部固定切题栏</text>
                        <text x="20" y="142" fill="#4338ca" fontSize="10.5" fontWeight="bold">• 键盘快捷键 (1-4 / Enter / ← →)</text>
                        <line x1="16" y1="162" x2="246" y2="162" stroke="#e2e8f0" />
                        <text x="20" y="186" fill="#0f172a" fontSize="11.5" fontWeight="bold">
                          📋 紧凑电子全卷 (Paper Sheet)
                        </text>
                        <text x="20" y="208" fill="#475569" fontSize="10.5">• 6 道题同屏流式展开、自由顺畅滚动</text>
                        <text x="20" y="228" fill="#475569" fontSize="10.5">• 支持「全部题目 (6)」与「仅看错题」筛选</text>
                        <text x="20" y="248" fill="#475569" fontSize="10.5">• 每题内置「▶ 跳至考点 mm:ss」胶囊</text>
                        <text x="20" y="270" fill="#4338ca" fontSize="10.5" fontWeight="bold">• 错题重练不丢失全卷历史作答状态</text>
                      </g>

                      <g transform="translate(878, 84)">
                        <rect width="262" height="310" rx="12" fill="#ffffff" stroke="#d97706" strokeWidth="1.5" />
                        <rect width="262" height="34" rx="12" fill="#d97706" />
                        <text x="131" y="22" fill="#ffffff" fontSize="12.5" fontWeight="bold" textAnchor="middle">
                          4. 测验与历史双重持久化闭环
                        </text>
                        <text x="20" y="60" fill="#b45309" fontSize="11.5" fontWeight="bold">
                          🗄️ PostgreSQL + Local 双写同步
                        </text>
                        <text x="20" y="82" fill="#0f172a" fontSize="10.5">• POST /api/quiz/generate 写库 quiz_data</text>
                        <text x="20" y="102" fill="#0f172a" fontSize="10.5">• POST /api/quiz/state 实时同步作答进度</text>
                        <text x="20" y="122" fill="#0f172a" fontSize="10.5">{'• GET /api/summary/{id} 自动反查补齐'}</text>
                        <text x="20" y="142" fill="#047857" fontSize="10.5" fontWeight="bold">• 重新打开视频 100% 恢复题目与成绩</text>
                        <line x1="16" y1="162" x2="246" y2="162" stroke="#e2e8f0" />
                        <text x="20" y="186" fill="#0f172a" fontSize="11.5" fontWeight="bold">
                          📊 学习记录列表测验徽标
                        </text>
                        <text x="20" y="208" fill="#475569" fontSize="10.5">• VideoHistoryPage 展示「🎯 测验 XX分」</text>
                        <text x="20" y="228" fill="#475569" fontSize="10.5">• 支持未交卷进度「📝 已生成测验」提示</text>
                        <text x="20" y="248" fill="#475569" fontSize="10.5">• 游客 localStorage 与登录 PG 自动协同</text>
                        <text x="20" y="270" fill="#b45309" fontSize="10.5" fontWeight="bold">• 评测生成、作答、交卷全生命周期留存</text>
                      </g>

                      <g transform="translate(20, 408)">
                        <rect width="1120" height="54" rx="10" fill="#ffffff" stroke="#cbd5e1" />
                        <rect x="14" y="9" width="120" height="36" rx="8" fill="#0f172a" />
                        <text x="74" y="31" fill="#ffffff" fontSize="11" fontWeight="bold" textAnchor="middle">
                          v2.7.0 实测收益
                        </text>
                        <text x="154" y="23" fill="#0369a1" fontSize="11" fontWeight="bold">
                          ① 210s 视频总结：58.8s ➔ 35.4s
                        </text>
                        <text x="154" y="40" fill="#475569" fontSize="10.5">
                          6 线程 ASR (6.7s) + 主总结与双语翻译并行
                        </text>
                        <text x="450" y="23" fill="#047857" fontSize="11" fontWeight="bold">
                          ② 引导词意图准确率：100% 归正
                        </text>
                        <text x="450" y="40" fill="#475569" fontSize="10.5">
                          总结优先白名单 + 0.78 置信度门控防误触
                        </text>
                        <text x="760" y="23" fill="#b45309" fontSize="11" fontWeight="bold">
                          ③ 测验体验与持久化：闯关 + 全卷 + 双写
                        </text>
                        <text x="760" y="40" fill="#475569" fontSize="10.5">
                          重进视频自动恢复题目与成绩，全卷顺畅滚动
                        </text>
                      </g>
                    </svg>
                  </div>
                </div>

                {/* v2.7.0 可折叠特性 */}
                <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleCollapse('v2.7.0-features')}
                    className="flex w-full items-center justify-between p-4 text-left transition hover:bg-slate-50 cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-slate-900">
                        ⭐ 核心特性与架构融合 (New Features)
                      </span>
                      <span className="rounded-full bg-[#0071e3]/10 px-2 py-0.5 text-[11px] font-semibold text-[#0071e3]">
                        5项重磅升级
                      </span>
                    </div>
                    <span className="text-[12.5px] text-slate-400">
                      {collapseState['v2.7.0-features'] ? '收起 ▲' : '展开 ▼'}
                    </span>
                  </button>
                  {collapseState['v2.7.0-features'] && (
                    <div className="border-t border-slate-100 p-4 space-y-2.5 text-[13.5px] text-slate-700 leading-relaxed">
                      <div>
                        <strong className="font-semibold text-[#0071e3]">
                          1. SmartDiagram 专属单行顶栏与跨模块导图联动：
                        </strong>
                        隐藏模拟桌面顶栏，点击左侧「视频学习助手」即刻重置返回首页；已解析视频切换条通过 Portal 嵌入顶栏中央；思维导图支持一键发送至 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">/diagram</code> 画布深度编辑。
                      </div>
                      <div>
                        <strong className="font-semibold text-[#0071e3]">
                          2. 四点并发极速总结管线 (58.8s ➔ 35.4s)：
                        </strong>
                        FFmpeg 单次重采样直抽、ASR 6 线程并发转写（210s 视频仅需 6.7s）、主研报 LLM 生成与双语字幕翻译双线程并行执行。
                      </div>
                      <div>
                        <strong className="font-semibold text-[#0071e3]">
                          3. CJK 中文标点兼容与可视化流程卡片渲染引擎：
                        </strong>
                        自研 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">markdown.ts</code>，完美解析中文引号紧邻的 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">**加粗**</code>、单星号 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">*话术示范*</code> 胶囊徽章，并将 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">[阶段一] -&gt; [阶段二]</code> 自动升维渲染为横向递进流程卡片。
                      </div>
                      <div>
                        <strong className="font-semibold text-[#0071e3]">
                          4. 系统 1 (Jeff) 三层高置信意图门控：
                        </strong>
                        引入知识总结硬优先白名单、功能动作特征词二次核验与 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">0.78</code> 置信度门控，预设引导词与模糊提问 100% 稳定触发总结型问答。
                      </div>
                      <div>
                        <strong className="font-semibold text-[#0071e3]">
                          5. Apple Study Deck 闯关卡片 + 紧凑电子全卷 + 双重持久化：
                        </strong>
                        支持「🎴 闯关卡片」（底部固定切题栏、即选即判）与「📋 全卷模式」（6 题同屏流式滚动、全部/错题筛选）自由切换；题目、作答进度与成绩在 PostgreSQL 与 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">localStorage</code> 双重持久化。
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ================= v2.6.0 ================= */}
          {shouldShowVersion('v2.6.0') && (
            <section
              id="v2.6.0"
              className="scroll-mt-20 grid grid-cols-1 md:grid-cols-[170px_minmax(0,1fr)] gap-6 md:gap-8 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs"
            >
              <div className="space-y-1.5">
                <span className="text-[20px] font-bold text-slate-900">v2.6.0</span>
                <p className="text-[12.5px] text-slate-500 font-mono">2026年10月23日</p>
                <p className="text-[11.5px] text-emerald-600 font-medium">
                  ⚡ 双系统流式与云端生产大版本
                </p>
              </div>

              <div className="min-w-0 space-y-4">
                <div>
                  <h2 className="text-[19px] font-bold tracking-tight text-slate-900">
                    双系统 SSE 流式问答、秒级 Range 时间轴跳转、云端共享 Jeff 低内存部署与 PostgreSQL 持久化闭环
                  </h2>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
                    完成系统 1 决策模型 Jeff (<code className="font-mono text-[12px]">gliformer-large-v1</code>) 的云服务器低内存改造与容器网络打通，内存峰值从 4.81 GB 降至 685 MiB；将 AI 问答升级为三阶段 SSE 实时流式输出，精细化展示「⚡ Jev系统1耗时 + 🧠 大模型耗时(含首字TTFT) + 🕒 消息时间戳」；解决 Nginx 全局缓存剥离 Range 导致点击视频时间轴重置归零的顽疾。
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleCollapse('v2.6.0-features')}
                    className="flex w-full items-center justify-between p-4 text-left transition hover:bg-slate-100/70 cursor-pointer"
                  >
                    <span className="text-[13.5px] font-bold text-slate-900">
                      ⭐ v2.6.0 核心特性与网关加固明细
                    </span>
                    <span className="text-[12.5px] text-slate-400">
                      {collapseState['v2.6.0-features'] ? '收起 ▲' : '展开 ▼'}
                    </span>
                  </button>
                  {collapseState['v2.6.0-features'] && (
                    <div className="border-t border-slate-200/70 p-4 space-y-2 text-[13px] text-slate-700 leading-relaxed bg-white">
                      <div>• <strong>三阶段 SSE 实时流式问答引擎：</strong>新增 <code className="font-mono text-[12px]">POST /api/ask/stream</code>，按 <code className="font-mono text-[12px]">router ➔ delta ➔ done</code> 实时推送。</div>
                      <div>• <strong>云端共享 Jeff 零拷贝低内存部署：</strong>权重转为 <code className="font-mono text-[12px]">model.safetensors</code> 实现 <code className="font-mono text-[12px]">mmap</code> 零拷贝映射，常驻内存从 4.81 GB 降至 <strong>685 MiB</strong>。</div>
                      <div>• <strong>秒级 Range 时间轴跳转：</strong>配置 <code className="font-mono text-[12px]">proxy_cache off; proxy_buffering off;</code> 恢复 <code className="font-mono text-[12px]">HTTP/2 206 Partial Content</code>，配合播放器 <code className="font-mono text-[12px]">readyState</code> 初始态校准实现秒级空降。</div>
                      <div>• <strong>问答对话历史 PostgreSQL JSONB 自动持久化：</strong>新增 <code className="font-mono text-[12px]">append_analysis_chat()</code> 原子追加至 <code className="font-mono text-[12px]">analyses.result.chat_history</code>。</div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ================= v2.5.0 ================= */}
          {shouldShowVersion('v2.5.0') && (
            <section
              id="v2.5.0"
              className="scroll-mt-20 grid grid-cols-1 md:grid-cols-[170px_minmax(0,1fr)] gap-6 md:gap-8 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs"
            >
              <div className="space-y-1.5">
                <span className="text-[20px] font-bold text-slate-900">v2.5.0</span>
                <p className="text-[12.5px] text-slate-500 font-mono">2026年10月11日</p>
                <p className="text-[11.5px] text-emerald-600 font-medium">⚡ 性能与研报大版本</p>
              </div>

              <div className="min-w-0 space-y-4">
                <div>
                  <h2 className="text-[19px] font-bold tracking-tight text-slate-900">
                    流式切片转写、动态领域先验编译器与四大篇章战略智库研报重塑
                  </h2>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
                    引入全自动动态领域先验编译器（<code className="font-mono text-[12px]">build_asr_system_prompt</code>），消除口音与中英专业术语同音错别字；180 秒音频切片并发识别与渐进式流式字幕推流，首批字幕 3.5 秒即出；输出四大篇章深度研报、TL;DR 破局卡片与落地行动指南。
                  </p>
                </div>

                {/* v2.5.0 交互式架构切换面板 */}
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-2.5">
                    <span className="text-[13px] font-bold text-slate-900">
                      🏛️ v2.5.0 流式转写拓扑与基准对照
                    </span>
                    <div className="inline-flex rounded-full bg-slate-200/70 p-0.5 text-[11.5px]">
                      <button
                        type="button"
                        onClick={() => setArchMode('architecture')}
                        className={`rounded-full px-2.5 py-0.5 font-medium cursor-pointer ${
                          archMode === 'architecture' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                        }`}
                      >
                        全栈拓扑
                      </button>
                      <button
                        type="button"
                        onClick={() => setArchMode('sequence')}
                        className={`rounded-full px-2.5 py-0.5 font-medium cursor-pointer ${
                          archMode === 'sequence' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                        }`}
                      >
                        流式时序 (3.5s)
                      </button>
                      <button
                        type="button"
                        onClick={() => setArchMode('benchmark')}
                        className={`rounded-full px-2.5 py-0.5 font-medium cursor-pointer ${
                          archMode === 'benchmark' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                        }`}
                      >
                        基准矩阵
                      </button>
                    </div>
                  </div>

                  {archMode === 'architecture' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[12px]">
                      <div className="rounded-xl border border-[#0071e3]/20 bg-white p-3 space-y-1">
                        <div className="font-bold text-[#0071e3]">🖥️ 客户端交互层</div>
                        <p className="text-slate-600">• 时间戳 Seek 联动与实时秒表计时</p>
                        <p className="text-slate-600">• 实时转写流式字幕预览窗口</p>
                        <p className="text-slate-600">• 四大篇章深度研报卡片</p>
                      </div>
                      <div className="rounded-xl border border-purple-500/20 bg-white p-3 space-y-1">
                        <div className="font-bold text-purple-600">⚡ 编排与先验编译器</div>
                        <p className="text-slate-600">• 动态领域专业词库编译器</p>
                        <p className="text-slate-600">• 180s 音频语义分块与实时回调</p>
                        <p className="text-slate-600">• Audio / ASR / LLM 全链路耗时打点</p>
                      </div>
                      <div className="rounded-xl border border-emerald-500/20 bg-white p-3 space-y-1">
                        <div className="font-bold text-emerald-600">🧠 高并发模型推理</div>
                        <p className="text-slate-600">• SenseVoice 多切片并发识别</p>
                        <p className="text-slate-600">• 战略咨询架构师 JSON Schema</p>
                        <p className="text-slate-600">• 0 同音错别字专业术语还原</p>
                      </div>
                    </div>
                  )}

                  {archMode === 'sequence' && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-[12px] space-y-2 font-mono">
                      <div><strong className="text-[#0071e3]">0.0s</strong> 任务提交：注册异步任务并激活前端毫秒级动态秒表。</div>
                      <div><strong className="text-[#0071e3]">1.2s</strong> 音频切片：FFmpeg 极速抽音并按 180s 划分子切片派发线程池。</div>
                      <div><strong className="text-emerald-600">3.5s</strong> 首片就绪：切片 1 识别完成触发 <code className="bg-slate-100 px-1 rounded">on_chunk_done</code>，前端立即滚动渲染字幕。</div>
                      <div><strong className="text-purple-600">完成</strong> 研报交付：输出 TL;DR、四大篇章研报、思维导图与双语对照字幕。</div>
                    </div>
                  )}

                  {archMode === 'benchmark' && (
                    <div className="overflow-x-auto bg-white rounded-xl border border-slate-200 p-2">
                      <table className="w-full text-left text-[12px] border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-1.5 px-2">评测维度</th>
                            <th className="py-1.5 px-2">优化前</th>
                            <th className="py-1.5 px-2">优化后</th>
                            <th className="py-1.5 px-2 text-emerald-600">提升幅度</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          <tr>
                            <td className="py-1.5 px-2 font-medium">首句字幕延迟</td>
                            <td className="py-1.5 px-2 text-slate-500">60~70s 全量等待</td>
                            <td className="py-1.5 px-2 font-semibold text-[#0071e3]">3.5s 首片即出</td>
                            <td className="py-1.5 px-2 font-bold text-emerald-600">⚡ 提速 15x+</td>
                          </tr>
                          <tr>
                            <td className="py-1.5 px-2 font-medium">专业术语识别率</td>
                            <td className="py-1.5 px-2 text-slate-500">约 70%（同音错字）</td>
                            <td className="py-1.5 px-2 font-semibold">100% 领域词库校准</td>
                            <td className="py-1.5 px-2 font-bold text-emerald-600">🎯 0 错别字</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ================= v2.4.0 ~ v1.0.0 ================= */}
          {shouldShowVersion('v2.4.0') && (
            <section
              id="v2.4.0"
              className="scroll-mt-20 grid grid-cols-1 md:grid-cols-[170px_minmax(0,1fr)] gap-6 md:gap-8 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs"
            >
              <div className="space-y-1">
                <span className="text-[19px] font-bold text-slate-900">v2.4.0</span>
                <p className="text-[12px] text-slate-500 font-mono">2026年8月7日</p>
              </div>
              <div className="space-y-2">
                <h2 className="text-[18px] font-bold text-slate-900">
                  视频学习助手本地上传工作台与 AI 智能测验系统上线
                </h2>
                <p className="text-[13px] leading-relaxed text-slate-600">
                  引入本地音视频（MP4/MOV/MKV/MP3）优先上传模式；基于视频内容自动生成单选、多选、判断智能题库，支持自动批改评分、视频原话依据解析与错题一键跳转对应时间戳回看。
                </p>
              </div>
            </section>
          )}

          {shouldShowVersion('v2.3.0') && (
            <section
              id="v2.3.0"
              className="scroll-mt-20 grid grid-cols-1 md:grid-cols-[170px_minmax(0,1fr)] gap-6 md:gap-8 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs"
            >
              <div className="space-y-1">
                <span className="text-[19px] font-bold text-slate-900">v2.3.0</span>
                <p className="text-[12px] text-slate-500 font-mono">2026年6月25日</p>
              </div>
              <div className="space-y-2">
                <h2 className="text-[18px] font-bold text-slate-900">
                  全链路稳定性加固、多通道大模型容灾与跨源播放矩阵
                </h2>
                <p className="text-[13px] leading-relaxed text-slate-600">
                  接入双通道大模型自动故障切换；重构 B站、抖音、小红书、YouTube 跨源流媒体代理播放与 TikTok HEVC 兼容转码策略。
                </p>
              </div>
            </section>
          )}

          {shouldShowVersion('v2.0.0') && (
            <section
              id="v2.0.0"
              className="scroll-mt-20 grid grid-cols-1 md:grid-cols-[170px_minmax(0,1fr)] gap-6 md:gap-8 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs"
            >
              <div className="space-y-1">
                <span className="text-[19px] font-bold text-slate-900">v2.0.0</span>
                <p className="text-[12px] text-slate-500 font-mono">2026年6月20日</p>
              </div>
              <div className="space-y-2">
                <h2 className="text-[18px] font-bold text-slate-900">
                  AI 视频总结、思维导图、双语对照字幕与交互式问答上线
                </h2>
                <p className="text-[13px] leading-relaxed text-slate-600">
                  从纯视频解析下载工具演进为 AI 视频学习工作台，新增结构化章节总结、MindElixir 思维导图、中英双语字幕及基于视频上下文的多轮 AI 问答。
                </p>
              </div>
            </section>
          )}

          {shouldShowVersion('v1.0.0') && (
            <section
              id="v1.0.0"
              className="scroll-mt-20 grid grid-cols-1 md:grid-cols-[170px_minmax(0,1fr)] gap-6 md:gap-8 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs"
            >
              <div className="space-y-1">
                <span className="text-[19px] font-bold text-slate-900">v1.0.0</span>
                <p className="text-[12px] text-slate-500 font-mono">2026年6月10日</p>
              </div>
              <div className="space-y-2">
                <h2 className="text-[18px] font-bold text-slate-900">
                  VidGrab 初版发布：多平台高清音视频解析与流式下载引擎
                </h2>
                <p className="text-[13px] leading-relaxed text-slate-600">
                  基于 FastAPI + yt-dlp + FFmpeg 构建全平台视频嗅探、清晰度选择、PO Token 免登录校验与高速下载管线。
                </p>
              </div>
            </section>
          )}
        </div>

        {/* 右侧 Sticky 版本快速跳转 */}
        <aside className="hidden lg:block">
          <div className="sticky top-16 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs space-y-3">
            <div className="font-mono text-[11px] font-bold tracking-wider text-slate-400 uppercase">
              版本时间轴 VERSIONS
            </div>
            <nav className="space-y-1">
              {VERSIONS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => scrollToVersion(v.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[12.5px] transition cursor-pointer ${
                    activeVersion === v.id
                      ? 'bg-[#0071e3]/10 font-bold text-[#0071e3]'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{v.label}</span>
                    {v.latest && (
                      <span className="rounded bg-[#0071e3] px-1.5 py-0.2 text-[9px] font-bold text-white">
                        NEW
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400">{v.date.replace('2026年', '')}</span>
                </button>
              ))}
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}
