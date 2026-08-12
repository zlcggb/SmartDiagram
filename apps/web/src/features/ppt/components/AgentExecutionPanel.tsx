import { useEffect, useMemo, useRef } from "react";
import { useWorkbenchStore, type ProgressStageState } from '@/features/ppt/store/workbenchStore';

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

export function AgentExecutionPanel({ variant = "floating" }: AgentExecutionPanelProps) {
  const busy = useWorkbenchStore((s) => s.busy);
  const progressStages = useWorkbenchStore((s) => s.progressStages);
  const panelOpen = useWorkbenchStore((s) => s.progressPanelOpen);
  const setProgressPanelOpen = useWorkbenchStore((s) => s.setProgressPanelOpen);
  const togglePanel = () => setProgressPanelOpen(!panelOpen);

  const panelRef = useRef<HTMLDivElement>(null);

  const stages = sortStages(progressStages);
  const hasStages = stages.length > 0;
  const activeStage = stages.find(([, s]) => s.status === "running");
  const activeStageName = activeStage?.[0];

  // 总进度
  const doneCount = stages.filter(([, s]) => s.status === "done" || s.status === "skip").length;
  const totalStages = stages.length;
  const progressPct = totalStages > 0 ? Math.round((doneCount / totalStages) * 100) : 0;

  // 自动滚动到运行中阶段
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !panelOpen) return;
    const running = el.querySelector(".agent-stage-running");
    if (running) {
      running.scrollIntoView({ behavior: "auto", block: "nearest" });
    }
  }, [activeStageName, panelOpen]);

  if (!busy && variant === "floating") return null;

  if (variant === "embedded") {
    return (
      <div
        className={`agent-execution-panel agent-execution-panel-embedded ${panelOpen ? "" : "agent-execution-panel-collapsed"}`}
        ref={panelRef}
      >
        <EmbeddedHeader
          busy={busy}
          activeStage={activeStage}
          progressPct={progressPct}
          hasStages={hasStages}
          panelOpen={panelOpen}
          onToggle={togglePanel}
        />
        {panelOpen ? (
          <>
            {hasStages && <TotalProgressBar progressPct={progressPct} />}
            <div className="agent-stage-list-wrapper flex-1 min-h-0">
              <StageList stages={stages} />
            </div>
          </>
        ) : null}
      </div>
    );
  }

  // floating
  return (
    <div className="progress-panel" ref={panelRef}>
      <FloatingHeader busy={busy} activeStage={activeStage} progressPct={progressPct} hasStages={hasStages} />
      {hasStages && <TotalProgressBar progressPct={progressPct} />}
      <StageList stages={stages} />
    </div>
  );
}

function EmbeddedHeader({
  busy,
  activeStage,
  progressPct,
  hasStages,
  panelOpen,
  onToggle
}: {
  busy: string | null;
  activeStage?: [string, ProgressStageState];
  progressPct: number;
  hasStages: boolean;
  panelOpen: boolean;
  onToggle: () => void;
}) {
  const title = activeStage
    ? (STAGE_META[activeStage[0]]?.label ?? activeStage[0])
    : busy || "Agent 执行视图";

  return (
    <div className="agent-execution-header">
      <button className="agent-execution-toggle" onClick={onToggle} type="button">
        <span className="agent-execution-toggle-icon">{panelOpen ? "◀" : "▶"}</span>
        {panelOpen && (
          <div className="agent-execution-header-text">
            <span className="agent-execution-title">Agent 执行视图</span>
            {hasStages && <span className="agent-execution-subtitle">{title} · {progressPct}%</span>}
          </div>
        )}
      </button>
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
    <div className="agent-total-progress">
      <div className="agent-total-progress-bar">
        <div className="agent-total-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>
      <span className="agent-total-progress-pct">{progressPct}%</span>
    </div>
  );
}

function StageList({ stages }: { stages: [string, ProgressStageState][] }) {
  if (stages.length === 0) {
    return (
      <div className="agent-stage-list-empty">
        <span>暂无执行任务</span>
      </div>
    );
  }

  return (
    <div className="agent-stage-list">
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

  return (
    <div className={`agent-stage-card agent-stage-${state.status} ${isRunning ? "agent-stage-running" : ""}`}>
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
          <DeltaStream chunks={state.deltaChunks} />
          <StageErrors logs={state.logs} />
        </div>
      )}
    </div>
  );
}

function StageStatusBadge({ status }: { status: ProgressStageState["status"] }) {
  const icon = status === "running" ? "⟳" : status === "done" ? "✓" : status === "error" ? "✗" : status === "skip" ? "→" : "·";
  return <span className={`agent-stage-status agent-stage-status-${status}`}>{icon}</span>;
}

function DeltaStream({ chunks }: { chunks: { id: string; text: string; subStage?: string }[] }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const output = useMemo(() => chunks.map((chunk) => chunk.text).join(""), [chunks]);

  useEffect(() => {
    const content = contentRef.current;
    if (content && shouldStickToBottomRef.current) {
      content.scrollTop = content.scrollHeight;
    }
  }, [output]);

  const handleScroll = () => {
    const content = contentRef.current;
    if (!content) return;
    const distanceFromBottom = content.scrollHeight - content.scrollTop - content.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 48;
  };

  if (chunks.length === 0) return null;

  return (
    <div className="agent-delta-stream">
      <div className="agent-delta-stream-label">模型输出</div>
      <div className="agent-delta-stream-content" ref={contentRef} onScroll={handleScroll}>
        <pre>{output}</pre>
      </div>
    </div>
  );
}

function StageErrors({ logs }: { logs: { id: string; at: string; message: string; level?: string }[] }) {
  const errors = logs.filter((log) => log.level === "error" || log.level === "warning");
  if (errors.length === 0) return null;
  return (
    <div className="agent-stage-logs">
      {errors.map((log) => (
        <div key={log.id} className={`agent-stage-log agent-stage-log-${log.level ?? "info"}`}>
          <span className="agent-stage-log-time">{log.at}</span>
          <span className="agent-stage-log-message">{log.message}</span>
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
