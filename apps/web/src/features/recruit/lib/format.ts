import type { RecruitmentType } from './types'

export const RECRUITMENT_TYPE_LABELS: Record<RecruitmentType, string> = {
  campus: '校招',
  experienced: '社招',
  unspecified: '未分类',
}

export const RECRUITMENT_TYPE_OPTIONS = [
  { value: 'campus', label: RECRUITMENT_TYPE_LABELS.campus },
  { value: 'experienced', label: RECRUITMENT_TYPE_LABELS.experienced },
] as const

export function recruitmentTypeLabel(value?: string | null): string {
  return value === 'campus' || value === 'experienced'
    ? RECRUITMENT_TYPE_LABELS[value]
    : RECRUITMENT_TYPE_LABELS.unspecified
}

export function recruitmentTypeVariant(value?: string | null): RecruitmentType {
  return value === 'campus' || value === 'experienced' ? value : 'unspecified'
}

export const STAGE_LABELS: Record<string, string> = {
  applied: '待筛选',
  screening: 'AI 初筛',
  interview: '初试',
  final: '复试',
  offer: 'Offer',
  talent_pool: '人才库',
  rejected: '已淘汰',
}

export const stageLabel = (stage?: string | null) => (stage ? STAGE_LABELS[stage] || stage : '未分阶段')

export const MODEL_ROLE_LABELS: Record<string, string> = {
  screening: '简历评估',
  rubric: '评分卡生成',
  ocr: '简历识别 / AI 复核',
}

export function formatTokens(value: number | null | undefined): string {
  const count = value ?? 0
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`
  if (count >= 10_000) return `${(count / 1000).toFixed(1)}k`
  return count.toLocaleString('zh-CN')
}

export type ScoreTone = 'strong' | 'medium' | 'pool' | 'low' | 'empty'

export function scoreTone(score: number | null | undefined, max = 100): ScoreTone {
  if (score === null || score === undefined) return 'empty'
  const percent = (score / (max || 100)) * 100
  if (percent >= 80) return 'strong'
  if (percent >= 70) return 'medium'
  if (percent >= 60) return 'pool'
  return 'low'
}
