import type { RecruitScreeningSummary } from './types'

export type InterviewOpportunityLevel = 'high' | 'review' | 'pool' | 'low'

export interface InterviewOpportunity {
  level: InterviewOpportunityLevel
  label: string
  detail: string
  actionLabel: string
  shouldInterview: boolean
}

export function getInterviewOpportunity(
  screening: Pick<RecruitScreeningSummary, 'total_score' | 'recommendation'>
): InterviewOpportunity {
  const recommendation = screening.recommendation.toLowerCase()

  if (screening.total_score >= 85 || recommendation.includes('进入面试')) {
    return {
      level: 'high',
      label: '建议安排面试',
      detail: '匹配度较高，优先安排一轮面试验证真实交付深度。',
      actionLabel: '保存候选人并进入面试安排',
      shouldInterview: true,
    }
  }

  if (screening.total_score >= 70 || recommendation.includes('人工复核')) {
    return {
      level: 'review',
      label: '复核后安排面试',
      detail: '有明显匹配信号，先人工确认关键经历，再决定是否进入初试。',
      actionLabel: '保存候选人并进入人工复核',
      shouldInterview: true,
    }
  }

  if (screening.total_score >= 60 || recommendation.includes('人才库')) {
    return {
      level: 'pool',
      label: '暂不优先面试',
      detail: '有潜力但证据不足，建议先沉淀到人才库，补充信息后再联系。',
      actionLabel: '保存到人才库',
      shouldInterview: false,
    }
  }

  return {
    level: 'low',
    label: '暂不安排面试',
    detail: '当前与岗位要求的直接证据不足，建议保留记录并继续寻找更匹配的人选。',
    actionLabel: '保存候选人留档',
    shouldInterview: false,
  }
}
