import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import AppShell from '@/shared/ui/shell/AppShell'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<AppShell />}>
          {/* 平台首页与各业务模块由 AppShell 内的 KeepAliveWorkspace 统一按需挂载与保活 */}
          <Route path="/" element={null} />
          <Route path="/diagram/*" element={null} />
          <Route path="/recruit/*" element={null} />
          <Route path="/ppt/*" element={null} />
          <Route path="/video/*" element={null} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
