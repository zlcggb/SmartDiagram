import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import App from '@/pages/diagram/DiagramWorkspace'
import AppShell from '@/shared/ui/shell/AppShell'
import HomePage from '@/pages/home/HomePage'
import { PptModule } from '@/features/ppt/PptModule'
import { RecruitModule } from '@/features/recruit/RecruitModule'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<AppShell />}>
          {/* 平台首页 */}
          <Route path="/" element={<HomePage />} />

          {/* 图表模块（diagram feature，与 ppt 平级） */}
          <Route path="/diagram/*" element={<App />} />

          {/* AI 招聘筛选模块 */}
          <Route path="/recruit/*" element={<RecruitModule />} />

          {/* PPT 制作模块 */}
          <Route path="/ppt/*" element={<PptModule />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
