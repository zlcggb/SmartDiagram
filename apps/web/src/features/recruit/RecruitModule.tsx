import { Navigate, Route, Routes } from 'react-router-dom'

import { RecruitShell } from '@/features/recruit/components/RecruitShell'
import { RecruitAnalyticsPage } from '@/features/recruit/pages/RecruitAnalyticsPage'
import { RecruitCandidateDetailPage } from '@/features/recruit/pages/RecruitCandidateDetailPage'
import { RecruitCandidatesPage } from '@/features/recruit/pages/RecruitCandidatesPage'
import { RecruitHomePage } from '@/features/recruit/pages/RecruitHomePage'
import { RecruitInterviewsPage } from '@/features/recruit/pages/RecruitInterviewsPage'
import { RecruitJobDetailPage } from '@/features/recruit/pages/RecruitJobDetailPage'
import { RecruitJobsPage } from '@/features/recruit/pages/RecruitJobsPage'
import { RecruitScreeningPage } from '@/features/recruit/pages/RecruitScreeningPage'

export function RecruitModule() {
  return (
    <div className="h-full w-full overflow-hidden" style={{ minHeight: 0 }}>
      <Routes>
        <Route element={<RecruitShell />}>
          <Route index element={<RecruitHomePage />} />
          <Route path="screen" element={<RecruitScreeningPage />} />
          <Route path="jobs" element={<RecruitJobsPage />} />
          <Route path="jobs/:jobId" element={<RecruitJobDetailPage />} />
          <Route path="candidates" element={<RecruitCandidatesPage />} />
          <Route path="candidates/:candidateId" element={<RecruitCandidateDetailPage />} />
          <Route path="interviews" element={<RecruitInterviewsPage />} />
          <Route path="analytics" element={<RecruitAnalyticsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/recruit" replace />} />
      </Routes>
    </div>
  )
}
