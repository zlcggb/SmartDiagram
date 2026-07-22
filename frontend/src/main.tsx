import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App'
import AppShell from './components/shell/AppShell'
import HomePage from './pages/HomePage'
import { PptModule } from './ppt/PptModule'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {/* 平台首页 */}
          <Route path="/" element={<HomePage />} />

          {/* 思维导图模块（原 SmartDiagram 应用） */}
          <Route path="/diagram/*" element={<App />} />

          {/* PPT 制作模块 */}
          <Route path="/ppt/*" element={<PptModule />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
