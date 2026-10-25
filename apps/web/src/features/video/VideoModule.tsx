import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import './video.css';
import { VideoShell } from './components/VideoShell';
import { VideoWorkspacePage } from './pages/VideoWorkspacePage';
import { VideoHistoryPage } from './pages/VideoHistoryPage';
import { VideoDocsPage } from './pages/VideoDocsPage';
import { VideoChangelogPage } from './pages/VideoChangelogPage';
import { VideoAdminPage } from './pages/VideoAdminPage';
import { VideoCoachLabPage } from '../video-coach-lab/pages/VideoCoachLabPage';

export const VideoModule: React.FC = () => {
  return (
    <VideoShell>
      <Routes>
        <Route index element={<VideoWorkspacePage />} />
        <Route path="coach-lab" element={<VideoCoachLabPage />} />
        <Route path="coach" element={<VideoCoachLabPage />} />
        <Route path="history" element={<VideoHistoryPage />} />
        <Route path="docs" element={<VideoDocsPage />} />
        <Route path="docs/:docPath" element={<VideoDocsPage />} />
        <Route path="changelog" element={<VideoChangelogPage />} />
        <Route path="admin" element={<VideoAdminPage />} />
        <Route path="*" element={<Navigate to="/video" replace />} />
      </Routes>
    </VideoShell>
  );
};

export default VideoModule;
