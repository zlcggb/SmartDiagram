import { useEffect, useRef, useState } from "react";
import { useWorkbenchStore, type ProgressStageState } from "@/features/ppt/store/workbenchStore";
import {
  Bot,
  Send,
  Sparkles,
  RefreshCw,
  Activity,
  Wand2
} from "lucide-react";

const STAGE_META: Record<string, { label: string; icon: string }> = {
  pipeline: { label: "流水线", icon: "🚀" },
  brief: { label: "需求确认", icon: "💬" },
  research: { label: "背景调研", icon: "🔍" },
  outline: { label: "大纲架构", icon: "📋" },
  search: { label: "按页检索", icon: "🔎" },
  plan: { label: "初稿策划", icon: "✏️" },
  ir: { label: "结构设计", icon: "🏗️" },
  design: { label: "视觉设计", icon: "🎨" },
  export: { label: "导出 PPTX", icon: "📦" }
};

const STAGE_ORDER = ["pipeline", "brief", "research", "outline", "search", "plan", "ir", "design", "export"];

type Variant = "floating" | "embedded";

interface AgentExecutionPanelProps {
  variant?: Variant;
}

const QUICK_ACTIONS = [
  { label: "✂️ 精炼要点", prompt: "请精简并提炼本页核心要点，去除冗余字句，突出核心观点与数字" },
  { label: "📈 补充数据论据", prompt: "请为本页观点补充更具体的数据支撑、落地场景或论据维度" },
  { label: "🔄 左右对比排版", prompt: "请将本页排版调整为左右对比结构（如优势对比、实施前后对比）" },
  { label: "💡 强化核心结论", prompt: "请用更有说服力的一句话重新打磨本页的关键结论" },
  { label: "🔤 翻译为英文", prompt: "请将本页的标题、结论和全部要点翻译成地道专业的商务英文" }
];

export function AgentExecutionPanel({ variant = "floating" }: AgentExecutionPanelProps) {
  const busy = useWorkbenchStore((s) => s.busy);
  const progressStages = useWorkbenchStore((s) => s.progressStages);
  const panelOpen = useWorkbenchStore((s) => s.progressPanelOpen);
  const setProgressPanelOpen = useWorkbenchStore((s) => s.setProgressPanelOpen);
  const slides = useWorkbenchStore((s) => s.slides);
  const selectedSlideId = useWorkbenchStore((s) => s.selectedSlideId);
  const copilotMessagesBySlide = useWorkbenchStore((s) => s.copilotMessagesBySlide);
  const copilotLoading = useWorkbenchStore((s) => s.copilotLoading);
  const sendSlideCopilotInstruction = useWorkbenchStore((s) => s.sendSlideCopilotInstruction);

  const [panelTab, setPanelTab] = useState<"copilot" | "logs">("copilot");
  const [inputText, setInputText] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const stages = sortStages(progressStages);
  const hasStages = stages.length > 0;
  const activeStage = stages.find(([, s]) => s.status === "running");

  // 总进度
  const doneCount = stages.filter(([, s]) => s.status === "done" || s.status === "skip").length;
  const totalStages = stages.length;
  const progressPct = totalStages > 0 ? Math.round((doneCount / totalStages) * 100) : 0;

  const currentSlideIndex = slides.findIndex((s) => s.id === selectedSlideId);
  const currentSlide = currentSlideIndex >= 0 ? slides[currentSlideIndex] : null;
  const currentMessages = (selectedSlideId ? copilotMessagesBySlide[selectedSlideId] : null) ?? [];

  // 消息更新自动滚动
  useEffect(() => {
    if (panelTab === "copilot" && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [currentMessages, panelTab, copilotLoading]);

  // 当有后台任务或阶段正在运行时，自动切换到日志面板并展开，避免用户手动切换
  useEffect(() => {
    if (activeStage || (busy && /检索|初稿|策划|设计|成稿|流水线|生成/u.test(busy))) {
      setPanelTab("logs");
      if (!panelOpen) {
        setProgressPanelOpen(true);
      }
    }
  }, [activeStage, busy, panelOpen, setProgressPanelOpen]);

  // 运行中自动滚动到当前执行阶段
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !panelOpen || panelTab !== "logs") return;
    const running = el.querySelector(".agent-stage-running");
    if (running) {
      running.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [progressStages, panelOpen, panelTab]);

  const handleSend = (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if (!text || !selectedSlideId || copilotLoading) return;
    setInputText("");
    void sendSlideCopilotInstruction(selectedSlideId, text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!busy && variant === "floating") return null;

  if (variant === "embedded") {
    return (
      <div
        className={`agent-execution-panel agent-execution-panel-embedded flex flex-col h-full overflow-hidden ${
          panelOpen ? "" : "agent-execution-panel-collapsed"
        }`}
        ref={panelRef}
      >
        {/* 顶部标题与切换栏 */}
        <div className="flex items-center justify-between border-b border-[rgba(0,0,0,0.08)] bg-white/95 px-3 py-2 backdrop-blur">
          <button
            className="flex items-center gap-2 text-xs font-semibold text-[rgba(0,0,0,0.85)] hover:text-black transition"
            onClick={() => setProgressPanelOpen(!panelOpen)}
            type="button"
          >
            <span className="text-[10px] text-[rgba(0,0,0,0.45)]">{panelOpen ? "◀" : "▶"}</span>
            <span className="inline-flex items-center gap-1.5">
              <Bot className="h-4 w-4 text-blue-600" />
              <span>{panelTab === "copilot" ? "AI 协同助手" : "执行监控"}</span>
            </span>
          </button>

          {panelOpen ? (
            <div className="flex items-center gap-1 rounded-lg bg-[rgba(0,0,0,0.04)] p-0.5">
              <button
                type="button"
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  panelTab === "copilot"
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-[rgba(0,0,0,0.6)] hover:text-[rgba(0,0,0,0.9)]"
                }`}
                onClick={() => setPanelTab("copilot")}
              >
                <Sparkles className="h-3 w-3" />
                <span>协同改稿</span>
              </button>
              <button
                type="button"
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  panelTab === "logs"
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-[rgba(0,0,0,0.6)] hover:text-[rgba(0,0,0,0.9)]"
                }`}
                onClick={() => setPanelTab("logs")}
              >
                <Activity className="h-3 w-3" />
                <span>日志</span>
                {activeStage ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                ) : null}
              </button>
            </div>
          ) : null}
        </div>

        {/* 展开内容区 */}
        {panelOpen ? (
          <div className="flex-1 flex flex-col min-h-0 bg-[rgba(255,255,255,0.75)]">
            {/* 全局任务运行时的微型进度指示横条 */}
            {activeStage || busy ? (
              <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50/70 px-3 py-1.5 text-[11px] text-blue-800">
                <span className="flex items-center gap-1.5 truncate">
                  <RefreshCw className="h-3 w-3 animate-spin text-blue-600 shrink-0" />
                  <span className="truncate">{activeStage ? (STAGE_META[activeStage[0]]?.label ?? activeStage[0]) : busy}</span>
                </span>
                <button
                  type="button"
                  className="shrink-0 underline text-blue-600 text-[10px] ml-2"
                  onClick={() => setPanelTab("logs")}
                >
                  查看日志 ({progressPct}%)
                </button>
              </div>
            ) : null}

            {panelTab === "copilot" ? (
              /* Copilot 协同视图 */
              <div className="flex-1 flex flex-col min-h-0">
                {/* 锚定当前页面信息 */}
                <div className="border-b border-[rgba(0,0,0,0.06)] bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-xs font-medium text-[rgba(0,0,0,0.85)]">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-100 text-[10px] font-bold text-blue-700 shrink-0">
                        {currentSlideIndex >= 0 ? currentSlideIndex + 1 : "·"}
                      </span>
                      <span className="truncate">{currentSlide ? currentSlide.title : "未选择页面"}</span>
                    </span>
                    {currentSlide ? (
                      <span className="shrink-0 rounded-full bg-[rgba(0,0,0,0.04)] px-2 py-0.5 text-[10px] font-medium text-[rgba(0,0,0,0.6)]">
                        {currentSlide.svgPreview || currentSlide.irJson ? "已出图" : currentSlide.planJson ? "初稿就绪" : "待生成"}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* 快捷指令区 */}
                <div className="border-b border-[rgba(0,0,0,0.05)] bg-[rgba(0,0,0,0.015)] px-3 py-2">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[rgba(0,0,0,0.4)]">
                    快捷微调指令
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_ACTIONS.map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        disabled={!selectedSlideId || copilotLoading}
                        onClick={() => handleSend(action.prompt)}
                        className="rounded-lg border border-[rgba(0,0,0,0.08)] bg-white px-2 py-1 text-[11px] text-[rgba(0,0,0,0.75)] shadow-xs transition hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 disabled:opacity-40"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 消息对话流 */}
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                  {currentMessages.length === 0 ? (
                    <div className="py-8 px-2 text-center text-[rgba(0,0,0,0.45)]">
                      <Wand2 className="mx-auto h-7 w-7 text-[rgba(0,0,0,0.25)] mb-2" />
                      <p className="text-xs font-medium text-[rgba(0,0,0,0.7)]">针对本页与 AI 实时对话</p>
                      <p className="mt-1 text-[11px] text-[rgba(0,0,0,0.4)] leading-relaxed">
                        输入修改指令（如“精简文字”、“换成左右对比”、“补充数据”），AI 会为您实时重构并重绘设计稿。
                      </p>
                    </div>
                  ) : (
                    currentMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed shadow-xs ${
                            msg.role === "user"
                              ? "bg-blue-600 text-white rounded-br-xs"
                              : "bg-white border border-[rgba(0,0,0,0.08)] text-[rgba(0,0,0,0.85)] rounded-bl-xs"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.text}</p>
                        </div>
                        <span className="mt-1 text-[9px] text-[rgba(0,0,0,0.35)] px-1">
                          {msg.at}
                        </span>
                      </div>
                    ))
                  )}

                  {copilotLoading ? (
                    <div className="flex items-start gap-2">
                      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-800 shadow-xs flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600" />
                        <span>AI 正在针对本页修改文案并重绘设计稿…</span>
                      </div>
                    </div>
                  ) : null}
                  <div ref={messagesEndRef} />
                </div>

                {/* 底部输入框 */}
                <div className="border-t border-[rgba(0,0,0,0.08)] bg-white p-2.5">
                  <div className="relative rounded-xl border border-[rgba(0,0,0,0.12)] bg-[rgba(0,0,0,0.015)] focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 transition">
                    <textarea
                      rows={2}
                      value={inputText}
                      disabled={!selectedSlideId || copilotLoading}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={selectedSlideId ? "输入对本页的修改想法（回车发送）…" : "请先选择幻灯片"}
                      className="w-full resize-none bg-transparent px-3 py-2 text-xs text-[rgba(0,0,0,0.85)] placeholder-[rgba(0,0,0,0.35)] outline-none"
                    />
                    <div className="flex items-center justify-between border-t border-[rgba(0,0,0,0.04)] px-2 py-1">
                      <span className="text-[10px] text-[rgba(0,0,0,0.35)]">Shift + Enter 换行</span>
                      <button
                        type="button"
                        disabled={!inputText.trim() || !selectedSlideId || copilotLoading}
                        onClick={() => handleSend()}
                        className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-700 disabled:opacity-30"
                      >
                        <Send className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* 执行日志视图 */
              <div className="flex-1 flex flex-col min-h-0">
                {hasStages ? <TotalProgressBar progressPct={progressPct} /> : null}
                <div className="agent-stage-list-wrapper flex-1 min-h-0 overflow-y-auto">
                  <StageList stages={stages} />
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // floating 变体保持兼容
  return (
    <div className="progress-panel" ref={panelRef}>
      <FloatingHeader busy={busy} activeStage={activeStage} progressPct={progressPct} hasStages={hasStages} />
      {hasStages && <TotalProgressBar progressPct={progressPct} />}
      <StageList stages={stages} />
    </div>
  );
}

function FloatingHeader({
  busy,
  activeStage,
  progressPct,
  hasStages
}: {
  busy: string | null;
  activeStage?: [string, ProgressStageState];
  progressPct: number;
  hasStages: boolean;
}) {
  return (
    <div className="progress-panel-header">
      <div className="progress-panel-pulse" />
      <span className="progress-panel-title">
        {activeStage ? (STAGE_META[activeStage[0]]?.label ?? activeStage[0]) : busy}
      </span>
      {hasStages && <span className="progress-panel-pct">{progressPct}%</span>}
    </div>
  );
}

function TotalProgressBar({ progressPct }: { progressPct: number }) {
  return (
    <div className="agent-total-progress border-b border-[rgba(0,0,0,0.06)] bg-white px-3 py-2">
      <div className="flex items-center justify-between mb-1 text-[11px] text-[rgba(0,0,0,0.6)]">
        <span>全流程执行进度</span>
        <span className="font-semibold text-blue-600">{progressPct}%</span>
      </div>
      <div className="agent-total-progress-bar h-1.5 w-full bg-[rgba(0,0,0,0.06)] rounded-full overflow-hidden">
        <div className="agent-total-progress-fill h-full bg-blue-600 transition-all duration-300" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}

function StageList({ stages }: { stages: [string, ProgressStageState][] }) {
  if (stages.length === 0) {
    return (
      <div className="agent-stage-list-empty py-16 text-center text-xs text-[rgba(0,0,0,0.4)]">
        <span>暂无后台执行任务</span>
      </div>
    );
  }

  return (
    <div className="agent-stage-list p-2 space-y-1.5">
      {stages.map(([stage, state]) => (
        <StageCard key={stage} stage={stage} state={state} />
      ))}
    </div>
  );
}

function StageCard({ stage, state }: { stage: string; state: ProgressStageState }) {
  const meta = STAGE_META[stage] ?? { label: stage, icon: "⚙️" };
  const isRunning = state.status === "running";
  const toggle = () => useWorkbenchStore.getState().toggleStageExpanded(stage);
  const expanded = state.expanded ?? isRunning;

  const selectedSlideId = useWorkbenchStore((s) => s.selectedSlideId);
  const slides = useWorkbenchStore((s) => s.slides);
  const selectedIndex = slides.findIndex((s) => s.id === selectedSlideId);
  const selectedSlide = selectedIndex >= 0 ? slides[selectedIndex] : null;

  return (
    <div className={`agent-stage-card agent-stage-${state.status} ${isRunning ? "agent-stage-running ring-1 ring-blue-400" : ""}`}>
      <button className="agent-stage-header" onClick={toggle} type="button">
        <span className="agent-stage-icon">{meta.icon}</span>
        <span className="agent-stage-label">{meta.label}</span>
        <StageStatusBadge status={state.status} />
        <span className="agent-stage-chevron">{expanded ? "▼" : "▶"}</span>
      </button>

      {expanded && (
        <div className="agent-stage-body">
          {state.message && (
            <div className="agent-stage-message">{state.message}</div>
          )}
          {state.current != null && state.total != null && state.total > 0 && (
            <div className="agent-stage-sub-bar">
              <div
                className="agent-stage-sub-fill"
                style={{ width: `${Math.round((state.current / state.total) * 100)}%` }}
              />
              <span className="agent-stage-sub-text">{state.current}/{state.total}</span>
            </div>
          )}
          <DeltaStream
            chunks={state.deltaChunks}
            selectedSlideId={selectedSlideId}
            selectedSlideTitle={selectedSlide?.title}
            selectedSlideIndex={selectedIndex}
          />
          <StageErrors logs={state.logs} selectedSlideId={selectedSlideId} />
        </div>
      )}
    </div>
  );
}

function StageStatusBadge({ status }: { status: ProgressStageState["status"] }) {
  const icon = status === "running" ? "⟳" : status === "done" ? "✓" : status === "error" ? "✗" : status === "skip" ? "→" : "·";
  return <span className={`agent-stage-status agent-stage-status-${status}`}>{icon}</span>;
}

function DeltaStream({
  chunks,
  selectedSlideId,
  selectedSlideTitle,
  selectedSlideIndex
}: {
  chunks: { id: string; text: string; subStage?: string; slideId?: string; slideTitle?: string }[];
  selectedSlideId?: string | null;
  selectedSlideTitle?: string;
  selectedSlideIndex?: number;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<"current" | "all">("current");

  // 检查是否有按页打标的 chunks
  const hasSlideSpecificChunks = chunks.some((c) => Boolean(c.slideId));
  const currentChunks = selectedSlideId && hasSlideSpecificChunks
    ? chunks.filter((c) => !c.slideId || c.slideId === selectedSlideId)
    : chunks;

  const displayChunks = scope === "current" && hasSlideSpecificChunks && selectedSlideId
    ? currentChunks
    : chunks;

  const output = displayChunks.map((chunk) => chunk.text).join("");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "auto", block: "nearest" });
  }, [output]);

  if (chunks.length === 0) return null;

  return (
    <div className="agent-delta-stream">
      <div className="flex items-center justify-between pb-1 mb-1 border-b border-[rgba(0,0,0,0.06)]">
        <div className="agent-delta-stream-label">
          模型输出
          {hasSlideSpecificChunks && selectedSlideId && scope === "current" ? (
            <span className="ml-1 text-[10px] text-blue-600 font-normal">
              (P{selectedSlideIndex != null && selectedSlideIndex >= 0 ? selectedSlideIndex + 1 : 1}: {selectedSlideTitle || "当前页"})
            </span>
          ) : null}
        </div>
        {hasSlideSpecificChunks && selectedSlideId ? (
          <div className="flex items-center gap-1 text-[10px]">
            <button
              type="button"
              onClick={() => setScope("current")}
              className={`px-1.5 py-0.5 rounded transition ${
                scope === "current"
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "text-[rgba(0,0,0,0.45)] hover:text-[rgba(0,0,0,0.7)]"
              }`}
            >
              当前页
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`px-1.5 py-0.5 rounded transition ${
                scope === "all"
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "text-[rgba(0,0,0,0.45)] hover:text-[rgba(0,0,0,0.7)]"
              }`}
            >
              全部
            </button>
          </div>
        ) : null}
      </div>
      <div className="agent-delta-stream-content">
        <pre>{output || (scope === "current" ? "（当前页暂无模型输出流，可点击上方「全部」查看全局流水）" : "")}</pre>
        <div ref={endRef} />
      </div>
    </div>
  );
}

function StageErrors({
  logs,
  selectedSlideId
}: {
  logs: { id: string; at: string; message: string; level?: string; slideId?: string; slideTitle?: string }[];
  selectedSlideId?: string | null;
}) {
  const errors = logs.filter((log) => log.level === "error" || log.level === "warning");
  if (errors.length === 0) return null;
  return (
    <div className="agent-stage-logs">
      {errors.map((log) => (
        <div
          key={log.id}
          className={`agent-stage-log agent-stage-log-${log.level ?? "info"} ${
            selectedSlideId && log.slideId === selectedSlideId ? "font-medium bg-red-50/50" : ""
          }`}
        >
          <span className="agent-stage-log-time">{log.at}</span>
          <span className="agent-stage-log-message">
            {log.slideTitle ? `[${log.slideTitle}] ` : ""}
            {log.message}
          </span>
        </div>
      ))}
    </div>
  );
}

function sortStages(stages: Record<string, ProgressStageState>): [string, ProgressStageState][] {
  const entries = Object.entries(stages).filter(([, state]) => state.message !== "进度连接已建立");
  entries.sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a[0]);
    const ib = STAGE_ORDER.indexOf(b[0]);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a[0].localeCompare(b[0]);
  });
  return entries;
}
