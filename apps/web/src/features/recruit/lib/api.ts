import { API_BASE, enterpriseHeaders } from '@/shared/lib/config/enterpriseContext'
import type { RecruitScreeningResult } from './types'

export interface ScreenCandidateInput {
  candidateName: string
  channel: string
  jdText: string
  resumeText: string
  file: File | null
}

export async function screenCandidate(input: ScreenCandidateInput): Promise<RecruitScreeningResult> {
  const formData = new FormData()
  formData.append('candidate_name', input.candidateName)
  formData.append('channel', input.channel)
  formData.append('jd_text', input.jdText)
  formData.append('resume_text', input.resumeText)
  if (input.file) formData.append('file', input.file)

  const response = await fetch(`${API_BASE}/api/talent/screen`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: formData
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || '简历筛选失败')
  }
  return response.json() as Promise<RecruitScreeningResult>
}
