import { Navigate, Route, Routes } from 'react-router-dom'

import { RecruitShell } from '@/features/recruit/components/RecruitShell'
import { RecruitAnalyticsPage } from '@/features/recruit/pages/RecruitAnalyticsPage'
import { RecruitCandidateDetailPage } from '@/features/recruit/pages/RecruitCandidateDetailPage'
import { RecruitCandidatesPage } from '@/features/recruit/pages/RecruitCandidatesPage'
import { RecruitHomePage } from '@/features/recruit/pages/RecruitHomePage'
import { RecruitInterviewsPage } from '@/features/recruit/pages/RecruitInterviewsPage'
import { RecruitJobDetailPage } from '@/features/recruit/pages/RecruitJobDetailPage'
import { RecruitJobsPage } from '@/features/recruit/pages/RecruitJobsPage'
import { RecruitResumeLabEditorPage } from '@/features/recruit/pages/RecruitResumeLabEditorPage'
import { RecruitResumeLabPage } from '@/features/recruit/pages/RecruitResumeLabPage'
import { RecruitScreeningPage } from '@/features/recruit/pages/RecruitScreeningPage'
import { RecruitSettingsPage } from '@/features/recruit/pages/RecruitSettingsPage'

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
          <Route path="resume-lab" element={<RecruitResumeLabPage />} />
          <Route path="resume-lab/:draftId" element={<RecruitResumeLabEditorPage />} />
          <Route path="interviews" element={<RecruitInterviewsPage />} />
          <Route path="analytics" element={<RecruitAnalyticsPage />} />
          <Route path="settings" element={<RecruitSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/recruit" replace />} />
      </Routes>
    </div>
  )
}
