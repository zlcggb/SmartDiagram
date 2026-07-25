import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { PptNotFoundPage } from "../components/PptNotFoundPage";
import { useWorkbenchStore } from "@/features/ppt/store/workbenchStore";
import { ProjectShell } from "../components/project-shell/ProjectShell";
import { ProgressPanel } from "../components/ProgressPanel";

export function ProjectWorkspace() {
  const { projectId } = useParams();
  const location = useLocation();
  const loadProject = useWorkbenchStore((s) => s.loadProject);
  const project = useWorkbenchStore((s) => s.project);
  const busy = useWorkbenchStore((s) => s.busy);
  const projectLoadFailure = useWorkbenchStore((s) => s.projectLoadFailure);

  // Studio 页面已有右侧常驻 AgentExecutionPanel，避免浮层重复
  const isStudioRoute = location.pathname.includes("/studio");

  useEffect(() => {
    if (projectId) void loadProject(projectId);
  }, [projectId, loadProject]);

  if (!projectId) {
    return <Navigate to="../.." replace />;
  }

  if (busy === "加载项目中") {
    return (
      <div className="studio-shell flex min-h-full items-center justify-center">
        <p className="text-sm text-muted">正在加载项目…</p>
      </div>
    );
  }

  if (!project && projectLoadFailure) {
    return (
      <PptNotFoundPage
        code={404}
        kind={projectLoadFailure.kind}
        description={projectLoadFailure.message}
      />
    );
  }

  if (!project) {
    return (
      <PptNotFoundPage
        code={404}
        kind="unknown"
        description="项目加载失败，请返回桌面或 PPT 首页重试。"
      />
    );
  }

  return (
    <ProjectShell>
      <Outlet />
      {!isStudioRoute && <ProgressPanel />}
    </ProjectShell>
  );
}
