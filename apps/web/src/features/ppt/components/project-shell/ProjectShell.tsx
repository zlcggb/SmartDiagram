import { Link, useLocation, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { LoaderCircle, Sparkles, Activity, Cpu } from "lucide-react";
import { AppLogoMark } from "../AppLogo";
import { useWorkbenchStore } from '@/features/ppt/store/workbenchStore';
import { ProjectSwitcher } from "./ProjectSwitcher";
import { WorkspaceNav } from "./WorkspaceNav";
import { TokenDashboardModal } from "../studio/TokenDashboardModal";
import { startAiUsageAutoRefresh } from "../../lib/usageRefresh";

export function ProjectShell({ children }: { children: ReactNode }) {
  const { projectId } = useParams();
  const location = useLocation();
  const isIntentRoute = location.pathname.includes("/intent");
  const isStructureRoute = location.pathname.includes("/structure");
  const project = useWorkbenchStore((s) => s.project);
  const busy = useWorkbenchStore((s) => s.busy);
  const error = useWorkbenchStore((s) => s.error);
  const clearError = useWorkbenchStore((s) => s.clearError);
  const aiUsageSummary = useWorkbenchStore((s) => s.aiUsageSummary);
  const latestSourceText = useWorkbenchStore((s) => s.latestSourceText);
  const runPipeline = useWorkbenchStore((s) => s.runPipeline);
  const refreshAiUsage = useWorkbenchStore((s) => s.refreshAiUsage);
  const progressStages = useWorkbenchStore((s) => s.progressStages);
  const studioPhase = useWorkbenchStore((s) => s.studioPhase);
  const setStudioPhase = useWorkbenchStore((s) => s.setStudioPhase);
  const ttsModel = useWorkbenchStore((s) => s.ttsModel);
  const [dashboardOpen, setDashboardOpen] = useState(false);

  // 工作室/导演的「当前阶段」由 URL ?phase= 驱动（点标签页只改 URL，不写 store）。
  // 工作室阶段会回填进 store，让其它消费 studioPhase 的地方保持一致。
  const rawPhase = new URLSearchParams(location.search).get("phase");
  const urlPhase = rawPhase as "search" | "draft" | "design" | "script" | "audio" | "video" | null;
  useEffect(() => {
    if (urlPhase === "search" || urlPhase === "draft" || urlPhase === "design") {
      if (urlPhase !== studioPhase) setStudioPhase(urlPhase);
    }
  }, [urlPhase, studioPhase, setStudioPhase]);

  useEffect(() => {
    return startAiUsageAutoRefresh({
      busy: Boolean(busy),
      refresh: refreshAiUsage,
      schedule: (callback, intervalMs) => window.setInterval(callback, intervalMs),
      cancel: (handle) => window.clearInterval(handle as number),
    });
  }, [busy, refreshAiUsage]);

  // chip 跟随「当前模块 / 工作室阶段」切换模型。后端 stageGraph 的 modelRole：
  // 只有「按页设计稿」(design/svg) 用 design 模型（gemini-3.6-flash-high）；
  // 意图/结构/导演/检索/初稿/IR 等都用主模型（gpt-5.3-codex-spark）。
  const runningStageName = Object.entries(progressStages ?? {}).find(
    ([, stage]) => stage?.status === "running",
  )?.[0];
  const isStudioRoute = location.pathname.includes("/studio");
  const isDirectorRoute = location.pathname.includes("/director");
  const isDesignContext =
    (isStudioRoute && urlPhase === "design") ||
    (isDirectorRoute && urlPhase === "audio") ||
    runningStageName === "design" ||
    runningStageName === "svg";
  const displayModel = isDesignContext
    ? (isDirectorRoute ? (ttsModel ?? aiUsageSummary?.designModel ?? aiUsageSummary?.model) : (aiUsageSummary?.designModel || aiUsageSummary?.model))
    : aiUsageSummary?.model || aiUsageSummary?.designModel;

  return (
    <div
      className={`studio-shell min-h-screen ${isIntentRoute ? "intent-route" : ""} ${
        isStructureRoute ? "structure-route" : ""
      }`}
    >
      <header className="workspace-header">
        <div className="workspace-header__main">
          <div className="workspace-header__identity">
            <Link to="../.." className="workspace-brand" aria-label="返回项目首页" title="返回项目首页">
              <span className="workspace-brand__mark">
                <AppLogoMark className="h-7 w-7" />
              </span>
              <span className="workspace-brand__wordmark">PPT Agent</span>
            </Link>
            <span className="workspace-header__divider" aria-hidden="true" />
            <ProjectSwitcher project={project} />
          </div>

          <div className="workspace-header__actions">
            <button
              type="button"
              className="workspace-usage-pill"
              onClick={() => setDashboardOpen(true)}
              title="查看当前项目的模型调用、Token 与费用明细"
              style={{
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "4px 12px",
                borderRadius: "9999px",
                border: "1px solid rgba(0,0,0,0.08)",
                background: "rgba(255,255,255,0.92)",
                backdropFilter: "blur(8px)",
                fontSize: "12px",
                fontWeight: 500,
                color: "#374151",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "9999px",
                background: "rgba(59,130,246,0.08)",
                color: "#1d4ed8",
                fontWeight: 600,
                border: "1px solid rgba(59,130,246,0.15)",
                fontSize: "11px",
              }}>
                <Cpu className="h-3.5 w-3.5" style={{ color: "#2563eb" }} />
                {displayModel || "AI Model"}
              </span>
              <span style={{ color: "#d1d5db" }}>|</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#4b5563" }}>
                <Activity className="h-3.5 w-3.5" style={{ color: "#10b981" }} />
                <span>项目 <strong>{aiUsageSummary?.projectRunCount ?? 0}</strong> 次</span>
              </span>
            </button>
            <button
              type="button"
              className="primary-button workspace-generate-button"
              disabled={Boolean(busy) || !projectId}
              onClick={() => void runPipeline()}
            >
              <Sparkles className="h-4 w-4" />
              全部自动生成
            </button>
            {busy ? (
              <span className="workspace-busy-state">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {busy}
              </span>
            ) : null}
          </div>
        </div>

        <div className="workspace-header__nav-row">
          <WorkspaceNav projectId={projectId} />
          <p className="workspace-context">
            AI 顾问项目{latestSourceText ? " · 已附参考资料" : ""}
            {project?.topic ? ` · ${project.topic}` : ""}
          </p>
        </div>
      </header>

      {error ? (
        <div className="mx-auto flex max-w-[1400px] items-start justify-between gap-3 px-5 pt-4">
          <p className="rounded-xl border border-risk/30 bg-white px-4 py-3 text-sm text-risk shadow-soft">
            {error}
          </p>
          <button type="button" className="text-button" onClick={clearError}>
            关闭
          </button>
        </div>
      ) : null}

      <main className="mx-auto flex max-w-[1400px] min-h-0 flex-col px-5 py-6">
        {children}
      </main>

      {dashboardOpen && <TokenDashboardModal onClose={() => setDashboardOpen(false)} />}
    </div>
  );
}
