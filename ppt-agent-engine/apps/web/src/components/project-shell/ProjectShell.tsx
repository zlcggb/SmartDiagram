import { Link, useLocation, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { AppLogoMark } from "../AppLogo";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { WorkspaceNav } from "./WorkspaceNav";

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

  return (
    <div
      className={`studio-shell min-h-screen ${isIntentRoute ? "intent-route" : ""} ${
        isStructureRoute ? "structure-route" : ""
      }`}
    >
      <header className="workspace-header">
        <div className="workspace-header__main">
          <div className="workspace-header__identity">
            <Link to="/" className="workspace-brand" aria-label="返回项目首页" title="返回项目首页">
              <span className="workspace-brand__mark">
                <AppLogoMark className="h-5 w-5" />
              </span>
              <span className="workspace-brand__wordmark">PPT Agent</span>
            </Link>
            <span className="workspace-header__divider" aria-hidden="true" />
            <ProjectSwitcher project={project} />
          </div>

          <div className="workspace-header__actions">
            {aiUsageSummary ? (
              <span className="workspace-usage-pill">
                <Sparkles className="h-3.5 w-3.5" />
                {aiUsageSummary.label}
              </span>
            ) : null}
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
    </div>
  );
}
