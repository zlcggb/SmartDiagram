import { Navigate, Route, Routes } from 'react-router-dom'

import { RecruitWorkbench } from './pages/RecruitWorkbench'

export function RecruitModule() {
  return (
    <div className="h-full w-full overflow-hidden" style={{ minHeight: 0 }}>
      <Routes>
        <Route index element={<RecruitWorkbench />} />
        <Route path="*" element={<Navigate to="/recruit" replace />} />
      </Routes>
    </div>
  )
}
