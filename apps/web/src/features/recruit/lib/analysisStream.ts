import type { RecruitCandidateStreamEvent, RecruitEducationFact } from '@/features/recruit/lib/types'

const STREAM_ERROR_LABELS: Record<string, string> = {
  candidate_duplicate: '该岗位下已存在相同邮箱的候选人。',
  candidate_name_required: '未识别到姓名，请在“手动补充信息”中填写。',
  resume_text_required: '没有可用的简历文本，请上传简历或填写正文。',
  model_invalid: '模型 ID 格式不合法。',
  screening_failed: '分析失败，请稍后重试。',
}

export function streamErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return STREAM_ERROR_LABELS[message] || message || '分析失败'
}

export interface AnalysisRun {
  steps: Array<{ key: string; label: string; status: 'running' | 'done' | 'error' }>
  facts: RecruitEducationFact[]
  tokens: string
}

export const EMPTY_RUN: AnalysisRun = { steps: [], facts: [], tokens: '' }

export function applyStreamEvent(current: AnalysisRun | null, event: RecruitCandidateStreamEvent): AnalysisRun | null {
  if (!current) return current
  if (event.type === 'step') {
    const steps = current.steps.some((step) => step.key === event.key)
      ? current.steps.map((step) => step.key === event.key ? { ...step, label: event.label, status: event.status } : step)
      : [...current.steps, { key: event.key, label: event.label, status: event.status }]
    return { ...current, steps }
  }
  if (event.type === 'tool') return { ...current, facts: event.output }
  if (event.type === 'token') return { ...current, tokens: (current.tokens + event.text).slice(-6000) }
  return current
}
