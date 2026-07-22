import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { ProjectWorkspace } from "./pages/ProjectWorkspace";
import { IntentSpace } from "./pages/IntentSpace";
import { StructureSpace } from "./pages/StructureSpace";
import { StudioSpace } from "./pages/StudioSpace";
import { ExportsSpace } from "./pages/ExportsSpace";
import "./styles.css";

function LegacyProjectRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? `/p/${projectId}/studio` : "/"} replace />;
}

function LegacyBriefRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? `/p/${projectId}/intent?tab=brief` : "/"} replace />;
}

function LegacyPasteRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? `/p/${projectId}/intent?tab=source` : "/"} replace />;
}

function LegacyBoardRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? `/p/${projectId}/structure` : "/"} replace />;
}

function LegacyExportRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? `/p/${projectId}/exports` : "/"} replace />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<HomePage />} />

        <Route path="/p/:projectId" element={<ProjectWorkspace />}>
          <Route index element={<Navigate to="intent" replace />} />
          <Route path="intent" element={<IntentSpace />} />
          <Route path="structure" element={<StructureSpace />} />
          <Route path="studio" element={<StudioSpace />} />
          <Route path="director" element={<ExportsSpace />} />
          <Route path="exports" element={<ExportsSpace />} />
          <Route path="*" element={<Navigate to="intent" replace />} />
        </Route>

        {/* 旧路由兼容 */}
        <Route path="/projects/:projectId" element={<LegacyProjectRedirect />} />
        <Route path="/p/:projectId/brief" element={<LegacyBriefRedirect />} />
        <Route path="/p/:projectId/paste" element={<LegacyPasteRedirect />} />
        <Route path="/p/:projectId/board" element={<LegacyBoardRedirect />} />
        <Route path="/p/:projectId/export" element={<LegacyExportRedirect />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
