import { Link, useLocation, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, LoaderCircle, Sparkles } from "lucide-react";
import { AppLogoMark } from "../AppLogo";
import { useWorkbenchStore } from '@/features/ppt/store/workbenchStore';
import { ProjectSwitcher } from "./ProjectSwitcher";
import { WorkspaceNav } from "./WorkspaceNav";
import { WorkspaceFocusToggle } from "./WorkspaceFocusToggle";
import { TokenDashboardModal } from "../studio/TokenDashboardModal";
import { startAiUsageAutoRefresh } from "../../lib/usageRefresh";
import { projectUsageIndicator } from "../../lib/modelUsage";
import {
  isWorkspaceFocusShortcut,
  readWorkspaceFocusMode,
  WORKSPACE_STUDIO_TOOLBAR_HOST_ID,
  writeWorkspaceFocusMode
} from "./workspaceFocusMode";
import { IntentHeaderStepper } from "./IntentHeaderStepper";

export function ProjectShell({ children }: { children: ReactNode }) {
  const { projectId } = useParams();
  const location = useLocation();
  const isIntentRoute = location.pathname.includes("/intent");
  const isStructureRoute = location.pathname.includes("/structure");
  const isStudioRoute = location.pathname.includes("/studio");
  const isDirectorRoute = location.pathname.includes("/director");
  const project = useWorkbenchStore((s) => s.project);
  const busy = useWorkbenchStore((s) => s.busy);
  const error = useWorkbenchStore((s) => s.error);
  const clearError = useWorkbenchStore((s) => s.clearError);
  const aiUsageSummary = useWorkbenchStore((s) => s.aiUsageSummary);
  const runPipeline = useWorkbenchStore((s) => s.runPipeline);
  const refreshAiUsage = useWorkbenchStore((s) => s.refreshAiUsage);
  const progressStages = useWorkbenchStore((s) => s.progressStages);
  const studioPhase = useWorkbenchStore((s) => s.studioPhase);
  const setStudioPhase = useWorkbenchStore((s) => s.setStudioPhase);
  const ttsModel = useWorkbenchStore((s) => s.ttsModel);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(() =>
    typeof window === "undefined" ? false : readWorkspaceFocusMode(window.localStorage)
  );

  const isStudioFocusMode = Boolean(isStudioRoute && focusMode);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isStudioFocusMode) {
      document.body.classList.add("has-ppt-focus-mode");
    } else {
      document.body.classList.remove("has-ppt-focus-mode");
    }
    return () => {
      document.body.classList.remove("has-ppt-focus-mode");
    };
  }, [isStudioFocusMode]);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        writeWorkspaceFocusMode(window.localStorage, next);
        if (next && !document.fullscreenElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else if (!next && document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      if (!document.fullscreenElement && focusMode) {
        setFocusMode(false);
        if (typeof window !== "undefined") writeWorkspaceFocusMode(window.localStorage, false);
      }
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [focusMode]);

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

  useEffect(() => {
    if (!isStudioRoute) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (!isWorkspaceFocusShortcut(event)) return;
      event.preventDefault();
      toggleFocusMode();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isStudioRoute, toggleFocusMode]);

  // chip 跟随「当前模块 / 工作室阶段」切换模型。后端 stageGraph 的 modelRole：
  // 只有「按页设计稿」(design/svg) 用 design 模型（gemini-3.6-flash-high）；
  // 意图/结构/导演/检索/初稿/IR 等都用主模型（gpt-5.3-codex-spark）。
  const runningStageName = Object.entries(progressStages ?? {}).find(
    ([, stage]) => stage?.status === "running",
  )?.[0];
  const isDesignContext =
    (isStudioRoute && urlPhase === "design") ||
    (isDirectorRoute && urlPhase === "audio") ||
    runningStageName === "design" ||
    runningStageName === "svg";
  const displayModel = isDesignContext
    ? (isDirectorRoute ? (ttsModel ?? aiUsageSummary?.designModel ?? aiUsageSummary?.model) : (aiUsageSummary?.designModel || aiUsageSummary?.model))
    : aiUsageSummary?.model || aiUsageSummary?.designModel;
  const usageIndicator = projectUsageIndicator(aiUsageSummary);

  const currentModuleSubtitle = isIntentRoute
    ? "意图"
    : isStructureRoute
      ? "结构"
      : isStudioRoute
        ? "工作室"
        : isDirectorRoute
          ? "导演"
          : "工作区";

  return (
    <div
      className={`studio-shell min-h-screen ${isIntentRoute ? "intent-route" : ""} ${
        isStructureRoute ? "structure-route" : ""
      } ${isStudioRoute ? "is-studio-route" : ""} ${isStudioFocusMode ? "is-focus-mode" : ""}`}
    >
      <header
        className={`workspace-header ${isStudioRoute ? "is-studio-route" : ""} ${
          isStudioFocusMode ? "is-focus-mode" : ""
        }`}
      >
        <div className="workspace-header__main">
          <div className="workspace-header__identity">
            <Link to="../.." className="workspace-brand" aria-label="返回项目首页" title="返回项目首页">
              <span className="workspace-brand__mark">
                <AppLogoMark className="h-7 w-7" />
              </span>
            </Link>
            <ProjectSwitcher project={project} moduleSubtitle={currentModuleSubtitle} />
          </div>

          <div className="workspace-header__navigation">
            <WorkspaceNav projectId={projectId} />
            {isIntentRoute ? <IntentHeaderStepper /> : null}
            {isStudioRoute ? (
              <div
                id={WORKSPACE_STUDIO_TOOLBAR_HOST_ID}
                className="workspace-studio-toolbar-host"
                aria-label="工作室快捷操作"
              />
            ) : null}
          </div>

          <div className="workspace-header__actions">
            <button
              type="button"
              className={`workspace-usage-pill workspace-usage-pill--compact ${usageIndicator.hasError ? "is-error" : ""}`}
              onClick={() => setDashboardOpen(true)}
              title={
                aiUsageSummary?.usageError ??
                `${displayModel || "AI 模型"} · ${usageIndicator.label} · 点击查看 Token 与费用明细`
              }
            >
              {usageIndicator.hasError ? (
                <AlertCircle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
              ) : (
                <span className="workspace-usage-pill__dot" aria-hidden="true" />
              )}
              <span className="workspace-usage-pill__compact-label">
                {usageIndicator.label.replace(/^项目\s*/, "")}
              </span>
            </button>
            {!isStudioRoute ? (
              <button
                type="button"
                className="workspace-generate-button"
                disabled={Boolean(busy) || !projectId}
                onClick={() => void runPipeline()}
                title="全流程自动运行：意图确认、结构大纲、幻灯片设计与媒体出图"
              >
                <Sparkles className="h-4 w-4" />
                全部自动生成
              </button>
            ) : null}
            {busy ? (
              <span className="workspace-busy-state" aria-live="polite">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {busy}
              </span>
            ) : null}
            <WorkspaceFocusToggle active={isStudioFocusMode} onToggle={toggleFocusMode} />
          </div>
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
