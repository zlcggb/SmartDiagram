import { API_BASE, enterpriseHeaders } from '@/shared/lib/config/enterpriseContext'
import type {
  CreateInterviewInput,
  CreateRecruitCandidateInput,
  CreateRecruitJobInput,
  RecruitAnalytics,
  RecruitCandidateDetail,
  RecruitCandidateSummary,
  RecruitDashboard,
  RecruitInterviewRecord,
  RecruitJobDetail,
  RecruitJobSummary,
  RecruitScreeningSummary,
} from './types'

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>
  let message = '请求失败'
  try {
    const body = await response.json()
    message = typeof body.detail === 'string' ? body.detail : body.detail?.message || message
  } catch {
    message = await response.text() || message
  }
  throw new Error(message)
}

export async function fetchRecruitDashboard(): Promise<RecruitDashboard> {
  return parseResponse<RecruitDashboard>(await fetch(`${API_BASE}/api/recruit/dashboard`, { headers: enterpriseHeaders(false) }))
}

export async function fetchRecruitJobs(): Promise<RecruitJobSummary[]> {
  const payload = await parseResponse<{ jobs: RecruitJobSummary[] }>(
    await fetch(`${API_BASE}/api/recruit/jobs`, { headers: enterpriseHeaders(false) })
  )
  return payload.jobs
}

export async function createRecruitJob(input: CreateRecruitJobInput): Promise<RecruitJobSummary> {
  return parseResponse<RecruitJobSummary>(await fetch(`${API_BASE}/api/recruit/jobs`, {
    method: 'POST',
    headers: enterpriseHeaders(),
    body: JSON.stringify(input)
  }))
}

export async function updateRecruitJob(jobId: string, input: Partial<CreateRecruitJobInput> & { status?: string }): Promise<RecruitJobSummary> {
  return parseResponse<RecruitJobSummary>(await fetch(`${API_BASE}/api/recruit/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers: enterpriseHeaders(),
    body: JSON.stringify(input)
  }))
}

export async function fetchRecruitJobDetail(jobId: string): Promise<RecruitJobDetail> {
  return parseResponse<RecruitJobDetail>(await fetch(`${API_BASE}/api/recruit/jobs/${encodeURIComponent(jobId)}`, {
    headers: enterpriseHeaders(false)
  }))
}

export async function fetchRecruitCandidates(params?: { job_id?: string; stage?: string; query?: string }): Promise<RecruitCandidateSummary[]> {
  const search = new URLSearchParams()
  if (params?.job_id) search.set('job_id', params.job_id)
  if (params?.stage) search.set('stage', params.stage)
  if (params?.query) search.set('query', params.query)
  const suffix = search.size ? `?${search.toString()}` : ''
  const payload = await parseResponse<{ candidates: RecruitCandidateSummary[] }>(
    await fetch(`${API_BASE}/api/recruit/candidates${suffix}`, { headers: enterpriseHeaders(false) })
  )
  return payload.candidates
}

export async function createRecruitCandidate(input: CreateRecruitCandidateInput): Promise<RecruitCandidateSummary> {
  const formData = new FormData()
  const entries: Array<[string, string]> = [
    ['job_id', input.job_id],
    ['full_name', input.full_name],
    ['email', input.email],
    ['phone', input.phone],
    ['current_company', input.current_company],
    ['location', input.location],
    ['source_channel', input.source_channel],
    ['portfolio_url', input.portfolio_url],
    ['linkedin_url', input.linkedin_url],
    ['summary', input.summary],
    ['notes', input.notes],
    ['tags', input.tags],
    ['resume_text', input.resume_text]
  ]
  entries.forEach(([key, value]) => formData.append(key, value))
  if (input.file) formData.append('file', input.file)
  return parseResponse<RecruitCandidateSummary>(await fetch(`${API_BASE}/api/recruit/candidates`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: formData
  }))
}

export async function fetchRecruitCandidateDetail(candidateId: string): Promise<RecruitCandidateDetail> {
  return parseResponse<RecruitCandidateDetail>(await fetch(`${API_BASE}/api/recruit/candidates/${encodeURIComponent(candidateId)}`, {
    headers: enterpriseHeaders(false)
  }))
}

export async function rerunRecruitScreening(candidateId: string, resumeText: string, file: File | null): Promise<RecruitScreeningSummary> {
  const formData = new FormData()
  formData.append('resume_text', resumeText)
  if (file) formData.append('file', file)
  return parseResponse<RecruitScreeningSummary>(await fetch(`${API_BASE}/api/recruit/candidates/${encodeURIComponent(candidateId)}/screenings`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: formData
  }))
}

export async function updateRecruitCandidateStage(candidateId: string, stage: string, status?: string) {
  return parseResponse<{ candidate_id: string; current_stage: string; status: string }>(await fetch(
    `${API_BASE}/api/recruit/candidates/${encodeURIComponent(candidateId)}/stage`,
    {
      method: 'POST',
      headers: enterpriseHeaders(),
      body: JSON.stringify({ stage, status })
    }
  ))
}

export async function createRecruitInterview(candidateId: string, input: CreateInterviewInput): Promise<RecruitInterviewRecord> {
  return parseResponse<RecruitInterviewRecord>(await fetch(`${API_BASE}/api/recruit/candidates/${encodeURIComponent(candidateId)}/interviews`, {
    method: 'POST',
    headers: enterpriseHeaders(),
    body: JSON.stringify({
      ...input,
      score: input.score
    })
  }))
}

export async function fetchRecruitInterviews(): Promise<RecruitInterviewRecord[]> {
  const payload = await parseResponse<{ interviews: RecruitInterviewRecord[] }>(
    await fetch(`${API_BASE}/api/recruit/interviews`, { headers: enterpriseHeaders(false) })
  )
  return payload.interviews
}

export async function fetchRecruitAnalytics(): Promise<RecruitAnalytics> {
  return parseResponse<RecruitAnalytics>(await fetch(`${API_BASE}/api/recruit/analytics`, { headers: enterpriseHeaders(false) }))
}
