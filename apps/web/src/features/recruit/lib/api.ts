import { API_BASE, enterpriseHeaders } from '@/shared/lib/config/enterpriseContext'
import { usePlatformAuth } from '@/shared/store/authStore'
import type {
  CreateInterviewInput,
  CreateRecruitCandidateInput,
  CreateRecruitJobInput,
  RecruitAiSettings,
  RecruitAnalytics,
  RecruitCandidateDetail,
  RecruitCandidateStreamEvent,
  RecruitCandidateSummary,
  RecruitDashboard,
  RecruitInterviewRecord,
  RecruitJobDetail,
  RecruitJobSummary,
  RecruitResumePreview,
  RecruitRubric,
  RecruitScreeningPreview,
  RecruitScreeningSummary,
  RecruitScreeningWorkflowResult,
  RecruitUsageReport,
  UpdateRecruitCandidateProfileInput,
} from './types'

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>
  return throwResponseError(response)
}

async function throwResponseError(response: Response): Promise<never> {
  let message = '请求失败'
  const responseText = await response.text()
  try {
    const body = JSON.parse(responseText) as {
      detail?: string | { message?: string } | Array<{ loc?: unknown[]; msg?: string }>
    }
    if (typeof body.detail === 'string') {
      message = body.detail
    } else if (body.detail && !Array.isArray(body.detail) && typeof body.detail === 'object' && body.detail.message) {
      message = body.detail.message
    } else if (Array.isArray(body.detail)) {
      message = body.detail
        .map((item: { loc?: unknown[]; msg?: string }) => {
          const location = Array.isArray(item.loc) ? item.loc.slice(-1)[0] : ''
          return location && item.msg ? `${String(location)}：${item.msg}` : item.msg
        })
        .filter(Boolean)
        .join('；') || message
    }
  } catch {
    message = responseText || message
  }

  if (response.status === 401 || message === 'authentication_required' || message === 'Invalid or expired session') {
    usePlatformAuth.getState().notifySessionExpired('您的登录状态已过期，请重新登录以继续访问招聘工作台')
    throw new Error('登录状态已过期，请在弹出的窗口中重新登录')
  }

  if (response.status === 404 && message.endsWith('_not_found') && !usePlatformAuth.getState().session) {
    usePlatformAuth.getState().openLogin('您当前处于未登录状态，请登录您的账户以查看该候选人或岗位数据')
    throw new Error('当前处于未登录状态，无法访问您账号下的记录，请在弹出的窗口中登录')
  }

  throw new Error(message)
}

export async function renderRecruitReportPdf(html: string, filename: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}/api/recruit/reports/pdf`, {
    method: 'POST',
    headers: enterpriseHeaders(),
    body: JSON.stringify({ html, filename }),
  })
  if (!response.ok) return throwResponseError(response)
  return response.blob()
}

export interface ScreenRecruitCandidateInput {
  candidateName: string
  channel: string
  jdTitle: string
  jdText: string
  rubric: RecruitRubric | null
  resumeText: string
  file: File | null
}

export async function fetchRecruitRubric(input: { jdTitle: string; jdText: string; refresh?: boolean }): Promise<RecruitRubric> {
  return parseResponse<RecruitRubric>(await fetch(`${API_BASE}/api/talent/rubric`, {
    method: 'POST',
    headers: enterpriseHeaders(),
    body: JSON.stringify({ jd_title: input.jdTitle, jd_text: input.jdText, refresh: Boolean(input.refresh) }),
  }))
}

export async function previewRecruitJd(file: File): Promise<{ parsed_text: string }> {
  const formData = new FormData()
  formData.append('file', file)
  return parseResponse<{ parsed_text: string }>(await fetch(`${API_BASE}/api/recruit/jd-preview`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: formData,
  }))
}

export interface RecruitTalentMatch {
  candidate: RecruitCandidateSummary
  screening: RecruitScreeningPreview
}

export interface RecruitTalentMatches {
  matches: RecruitTalentMatch[]
  total: number
  evaluated: number
}

export type RecruitSearchProgressNode = 'requirements' | 'resume_scan' | 'keyword_retrieval' | 'evaluation' | 'ranking'
export type RecruitSearchProgressStatus = 'started' | 'progress' | 'completed' | 'failed'

export interface RecruitSearchProgressEvent {
  id: number
  node: RecruitSearchProgressNode
  status: RecruitSearchProgressStatus
  message: string
  detail?: string
  data?: {
    requirement_count?: number
    knockout_count?: number
    candidate_count?: number
    readable_resume_count?: number
    keyword_count?: number
    keyword_terms?: string[]
    recalled_count?: number
    selected_for_evaluation?: number
    evaluation_total?: number
    evaluation_status?: 'evaluating' | 'completed'
    candidate_name?: string
    candidate_index?: number
    keyword_hits?: number
    score?: number
    max_score?: number
    evaluation_mode?: string
    evaluated_count?: number
  }
  created_at: string
}

export interface RecruitSearchTurn {
  id: number
  text: string
  status: 'analyzing' | 'matching' | 'completed' | 'failed'
  summary?: string | null
  error?: string | null
  rubric?: RecruitRubric | null
  matches?: RecruitTalentMatches | null
  events?: RecruitSearchProgressEvent[]
}

export interface RecruitSearchSummary {
  id: string
  title: string
  status: RecruitSearchTurn['status']
  updated_at: string
}

export interface RecruitSearchConversation extends RecruitSearchSummary {
  jd_title: string
  jd_text: string
  source: { label: string; title: string; text: string; kind: string }
  turns: RecruitSearchTurn[]
  revision: number
  created_at: string
}

export async function fetchRecruitSearchConversations(): Promise<RecruitSearchSummary[]> {
  return parseResponse<RecruitSearchSummary[]>(await fetch(`${API_BASE}/api/recruit/search-conversations`, {
    headers: enterpriseHeaders(false),
  }))
}

export async function fetchRecruitSearchConversation(id: string): Promise<RecruitSearchConversation> {
  return parseResponse<RecruitSearchConversation>(await fetch(`${API_BASE}/api/recruit/search-conversations/${encodeURIComponent(id)}`, {
    headers: enterpriseHeaders(false),
  }))
}

export async function streamRecruitSearchProgress(
  id: string,
  afterEventId: number,
  onEvent: (event: RecruitSearchProgressEvent) => void,
  signal: AbortSignal,
): Promise<number> {
  const response = await fetch(`${API_BASE}/api/recruit/search-conversations/${encodeURIComponent(id)}/events`, {
    headers: { ...enterpriseHeaders(false), 'Last-Event-ID': String(afterEventId) },
    signal,
  })
  if (!response.ok || !response.body) await parseResponse(response)

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let latestEventId = afterEventId
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = done ? '' : frames.pop() ?? ''
    for (const frame of frames) {
      const lines = frame.split(/\r?\n/)
      const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data) continue
      const event = JSON.parse(data) as RecruitSearchProgressEvent
      const idLine = lines.find((line) => line.startsWith('id:'))
      const parsedId = Number(idLine?.slice(3).trim() || event.id)
      if (Number.isFinite(parsedId)) latestEventId = Math.max(latestEventId, parsedId)
      onEvent(event)
    }
    if (done) break
  }
  return latestEventId
}

export async function createRecruitSearchConversation(input: {
  jdTitle: string; jdText: string; message: string; source: RecruitSearchConversation['source'] | null
}): Promise<RecruitSearchConversation> {
  return parseResponse<RecruitSearchConversation>(await fetch(`${API_BASE}/api/recruit/search-conversations`, {
    method: 'POST', headers: enterpriseHeaders(),
    body: JSON.stringify({ jd_title: input.jdTitle, jd_text: input.jdText, message: input.message, source: input.source }),
  }))
}

export async function appendRecruitSearchTurn(id: string, message: string): Promise<RecruitSearchConversation> {
  return parseResponse<RecruitSearchConversation>(await fetch(`${API_BASE}/api/recruit/search-conversations/${encodeURIComponent(id)}/turns`, {
    method: 'POST', headers: enterpriseHeaders(), body: JSON.stringify({ message }),
  }))
}

export async function retryRecruitSearchTurn(id: string, rubric?: RecruitRubric): Promise<RecruitSearchConversation> {
  return parseResponse<RecruitSearchConversation>(await fetch(`${API_BASE}/api/recruit/search-conversations/${encodeURIComponent(id)}/retry`, {
    method: 'POST', headers: enterpriseHeaders(), body: JSON.stringify({ rubric }),
  }))
}

export async function matchRecruitCandidates(input: { jdTitle: string; jdText: string; rubric: RecruitRubric }): Promise<RecruitTalentMatches> {
  return parseResponse<RecruitTalentMatches>(await fetch(`${API_BASE}/api/recruit/matches`, {
    method: 'POST',
    headers: enterpriseHeaders(),
    body: JSON.stringify({ jd_title: input.jdTitle, jd_text: input.jdText, rubric: input.rubric }),
  }))
}

export async function screenRecruitCandidate(input: ScreenRecruitCandidateInput): Promise<RecruitScreeningPreview> {
  const formData = new FormData()
  formData.append('candidate_name', input.candidateName)
  formData.append('channel', input.channel)
  formData.append('jd_title', input.jdTitle)
  formData.append('jd_text', input.jdText)
  if (input.rubric) formData.append('rubric_json', JSON.stringify(input.rubric))
  formData.append('resume_text', input.resumeText)
  if (input.file) formData.append('file', input.file)
  return parseResponse<RecruitScreeningPreview>(await fetch(`${API_BASE}/api/talent/screen`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: formData,
  }))
}

export async function persistRecruitScreening(input: {
  jdTitle: string
  jdText: string
  candidateName: string
  candidateEmail: string
  channel: string
  resumeText: string
  file: File | null
  priority: string
  rubric: RecruitRubric | null
}): Promise<RecruitScreeningWorkflowResult> {
  const formData = new FormData()
  formData.append('jd_title', input.jdTitle)
  formData.append('jd_text', input.jdText)
  if (input.rubric) formData.append('rubric_json', JSON.stringify(input.rubric))
  formData.append('candidate_name', input.candidateName)
  formData.append('email', input.candidateEmail)
  formData.append('source_channel', input.channel)
  formData.append('resume_text', input.resumeText)
  formData.append('priority', input.priority)
  if (input.file) formData.append('file', input.file)
  return parseResponse<RecruitScreeningWorkflowResult>(await fetch(`${API_BASE}/api/recruit/workbench`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: formData,
  }))
}

export async function fetchRecruitDashboard(): Promise<RecruitDashboard> {
  return parseResponse<RecruitDashboard>(await fetch(`${API_BASE}/api/recruit/dashboard`, { headers: enterpriseHeaders(false) }))
}

export async function ensureRecruitDefaultJob(): Promise<RecruitJobSummary> {
  return parseResponse<RecruitJobSummary>(await fetch(`${API_BASE}/api/recruit/jobs/default-ai`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
  }))
}

export async function previewRecruitResume(file: File): Promise<RecruitResumePreview> {
  const formData = new FormData()
  formData.append('file', file)
  return parseResponse<RecruitResumePreview>(await fetch(`${API_BASE}/api/recruit/resume-preview`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: formData,
  }))
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
  return parseResponse<RecruitCandidateSummary>(await fetch(`${API_BASE}/api/recruit/candidates`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: candidateFormData(input)
  }))
}

export async function fetchRecruitModels(): Promise<{ default: string; models: string[] }> {
  return parseResponse<{ default: string; models: string[] }>(await fetch(`${API_BASE}/api/recruit/models`, {
    headers: enterpriseHeaders(false),
  }))
}

export async function fetchRecruitSettings(): Promise<RecruitAiSettings> {
  return parseResponse<RecruitAiSettings>(await fetch(`${API_BASE}/api/recruit/settings`, {
    headers: enterpriseHeaders(false),
  }))
}

export async function saveRecruitSettings(models: RecruitAiSettings['models']): Promise<RecruitAiSettings> {
  return parseResponse<RecruitAiSettings>(await fetch(`${API_BASE}/api/recruit/settings`, {
    method: 'PUT',
    headers: enterpriseHeaders(),
    body: JSON.stringify({ models }),
  }))
}

export async function fetchRecruitUsage(limit = 50): Promise<RecruitUsageReport> {
  return parseResponse<RecruitUsageReport>(await fetch(`${API_BASE}/api/recruit/usage?limit=${limit}`, {
    headers: enterpriseHeaders(false),
  }))
}

export async function streamRecruitCandidate(
  input: CreateRecruitCandidateInput,
  onEvent: (event: RecruitCandidateStreamEvent) => void,
  signal?: AbortSignal,
): Promise<RecruitCandidateSummary> {
  const response = await fetch(`${API_BASE}/api/recruit/candidates/stream`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: candidateFormData(input),
    signal,
  })
  const done = await readRecruitStream(response, onEvent)
  if (done.candidate) return done.candidate
  throw new Error('分析中断，请重试')
}

export async function streamRecruitScreening(
  candidateId: string,
  input: { resumeText: string; file: File | null; model?: string },
  onEvent: (event: RecruitCandidateStreamEvent) => void,
  signal?: AbortSignal,
): Promise<RecruitScreeningSummary> {
  const response = await fetch(`${API_BASE}/api/recruit/candidates/${encodeURIComponent(candidateId)}/screenings/stream`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: screeningFormData(input.resumeText, input.file, input.model),
    signal,
  })
  const done = await readRecruitStream(response, onEvent)
  if (done.screening) return done.screening
  throw new Error('分析中断，请重试')
}

async function readRecruitStream(
  response: Response,
  onEvent: (event: RecruitCandidateStreamEvent) => void,
): Promise<Extract<RecruitCandidateStreamEvent, { type: 'done' }>> {
  if (!response.ok || !response.body) await parseResponse(response)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: Extract<RecruitCandidateStreamEvent, { type: 'done' }> | null = null
  let failure = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const frames = buffer.split('\n\n')
    buffer = done ? '' : frames.pop() ?? ''
    for (const frame of frames) {
      const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data) continue
      const event = JSON.parse(data) as RecruitCandidateStreamEvent
      if (event.type === 'done') result = event
      if (event.type === 'error') failure = event.message
      onEvent(event)
    }
    if (done) break
  }
  if (result) return result
  throw new Error(failure || '分析中断，请重试')
}

function screeningFormData(resumeText: string, file: File | null, model?: string): FormData {
  const formData = new FormData()
  formData.append('resume_text', resumeText)
  formData.append('model', model ?? '')
  if (file) formData.append('file', file)
  return formData
}

function candidateFormData(input: CreateRecruitCandidateInput): FormData {
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
    ['resume_text', input.resume_text],
    ['model', input.model ?? '']
  ]
  entries.forEach(([key, value]) => formData.append(key, value))
  if (input.file) formData.append('file', input.file)
  return formData
}

export async function fetchRecruitCandidateDetail(candidateId: string): Promise<RecruitCandidateDetail> {
  return parseResponse<RecruitCandidateDetail>(await fetch(`${API_BASE}/api/recruit/candidates/${encodeURIComponent(candidateId)}`, {
    headers: enterpriseHeaders(false)
  }))
}

export async function updateRecruitCandidateProfile(
  candidateId: string,
  input: UpdateRecruitCandidateProfileInput,
): Promise<RecruitCandidateSummary> {
  return parseResponse<RecruitCandidateSummary>(await fetch(`${API_BASE}/api/recruit/candidates/${encodeURIComponent(candidateId)}`, {
    method: 'PATCH',
    headers: enterpriseHeaders(),
    body: JSON.stringify(input),
  }))
}

export async function rerunRecruitScreening(candidateId: string, resumeText: string, file: File | null): Promise<RecruitScreeningSummary> {
  return parseResponse<RecruitScreeningSummary>(await fetch(`${API_BASE}/api/recruit/candidates/${encodeURIComponent(candidateId)}/screenings`, {
    method: 'POST',
    headers: enterpriseHeaders(false),
    body: screeningFormData(resumeText, file)
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
