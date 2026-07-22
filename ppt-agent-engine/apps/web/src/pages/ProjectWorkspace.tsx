import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useWorkbenchStore } from "../store/workbenchStore";
import { ProjectShell } from "../components/project-shell/ProjectShell";
import { ProgressPanel } from "../components/ProgressPanel";

export function ProjectWorkspace() {
  const { projectId } = useParams();
  const location = useLocation();
  const loadProject = useWorkbenchStore((s) => s.loadProject);
  const project = useWorkbenchStore((s) => s.project);
  const busy = useWorkbenchStore((s) => s.busy);

  // Studio 页面已有右侧常驻 AgentExecutionPanel，避免浮层重复
  const isStudioRoute = location.pathname.includes("/studio");

  useEffect(() => {
    if (projectId) void loadProject(projectId);
  }, [projectId, loadProject]);

  if (!projectId) {
    return <Navigate to="/" replace />;
  }

  if (!project && !busy) {
    return (
      <div className="studio-shell flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-title">项目加载失败</p>
          <p className="mt-2 text-sm text-muted">请返回首页重试</p>
        </div>
      </div>
    );
  }

  return (
    <ProjectShell>
      <Outlet />
      {!isStudioRoute && <ProgressPanel />}
    </ProjectShell>
  );
}
