import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { ProjectWorkspace } from "./pages/ProjectWorkspace";
import { IntentSpace } from "./pages/IntentSpace";
import { StructureSpace } from "./pages/StructureSpace";
import { StudioSpace } from "./pages/StudioSpace";
import { ExportsSpace } from "./pages/ExportsSpace";
import "./ppt.css";

/**
 * PPT Agent 模块入口：宿主应用在 `/ppt/*` 路由下渲染本组件。
 * 这里只包含路由表，BrowserRouter 由宿主提供；所有路径与跳转均为相对路径，
 * 相对于宿主挂载点（/ppt）解析。
 */

function LegacyProjectRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? `../../p/${projectId}/studio` : "../.."} replace />;
}

function LegacyBriefRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? "../intent?tab=brief" : "../../.."} replace />;
}

function LegacyPasteRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? "../intent?tab=source" : "../../.."} replace />;
}

function LegacyBoardRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? "../structure" : "../../.."} replace />;
}

function LegacyExportRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? "../exports" : "../../.."} replace />;
}

export function PptModule() {
  return (
    // ppt.css 内所有选择器均限定在 .ppt-root 作用域（与宿主 Tailwind v4 样式隔离）
    // minHeight:0 覆盖 ppt.css 里由原 body 规则继承来的 min-height:100vh，避免超出壳层视口
    <div className="ppt-root h-full w-full overflow-hidden" style={{ minHeight: 0 }}>
      <Routes>
        <Route index element={<HomePage />} />

        <Route path="p/:projectId" element={<ProjectWorkspace />}>
          <Route index element={<Navigate to="intent" replace />} />
          <Route path="intent" element={<IntentSpace />} />
          <Route path="structure" element={<StructureSpace />} />
          <Route path="studio" element={<StudioSpace />} />
          <Route path="director" element={<ExportsSpace />} />
          <Route path="exports" element={<ExportsSpace />} />
          <Route path="*" element={<Navigate to="intent" replace />} />
        </Route>

        {/* 旧路由兼容 */}
        <Route path="projects/:projectId" element={<LegacyProjectRedirect />} />
        <Route path="p/:projectId/brief" element={<LegacyBriefRedirect />} />
        <Route path="p/:projectId/paste" element={<LegacyPasteRedirect />} />
        <Route path="p/:projectId/board" element={<LegacyBoardRedirect />} />
        <Route path="p/:projectId/export" element={<LegacyExportRedirect />} />

        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </div>
  );
}
