import { create } from 'zustand'

import {
  createRecruitCandidate,
  createRecruitInterview,
  createRecruitJob,
  fetchRecruitAnalytics,
  fetchRecruitCandidateDetail,
  fetchRecruitCandidates,
  fetchRecruitDashboard,
  fetchRecruitInterviews,
  fetchRecruitJobDetail,
  fetchRecruitJobs,
  streamRecruitCandidate,
  streamRecruitScreening,
  updateRecruitCandidateProfile,
  updateRecruitCandidateStage,
  updateRecruitJob,
} from '@/features/recruit/lib/api'
import type {
  CreateInterviewInput,
  CreateRecruitCandidateInput,
  CreateRecruitJobInput,
  RecruitAnalytics,
  RecruitCandidateDetail,
  RecruitCandidateStreamEvent,
  RecruitCandidateSummary,
  RecruitDashboard,
  RecruitInterviewRecord,
  RecruitJobDetail,
  RecruitJobSummary,
  UpdateRecruitCandidateProfileInput,
} from '@/features/recruit/lib/types'

interface RecruitStoreState {
  loading: boolean
  error: string
  dashboard: RecruitDashboard | null
  jobs: RecruitJobSummary[]
  candidates: RecruitCandidateSummary[]
  interviews: RecruitInterviewRecord[]
  analytics: RecruitAnalytics | null
  jobDetail: RecruitJobDetail | null
  candidateDetail: RecruitCandidateDetail | null

  setError: (message: string) => void
  clearError: () => void
  loadDashboard: () => Promise<void>
  loadJobs: () => Promise<void>
  loadJobDetail: (jobId: string) => Promise<void>
  createJob: (input: CreateRecruitJobInput) => Promise<RecruitJobSummary>
  updateJob: (jobId: string, input: Partial<CreateRecruitJobInput> & { status?: string }) => Promise<RecruitJobSummary>
  loadCandidates: (params?: { job_id?: string; stage?: string; query?: string }) => Promise<void>
  createCandidate: (input: CreateRecruitCandidateInput) => Promise<RecruitCandidateSummary>
  createCandidateStream: (
    input: CreateRecruitCandidateInput,
    onEvent: (event: RecruitCandidateStreamEvent) => void,
    signal?: AbortSignal,
  ) => Promise<RecruitCandidateSummary>
  loadCandidateDetail: (candidateId: string) => Promise<void>
  updateCandidateProfile: (candidateId: string, input: UpdateRecruitCandidateProfileInput) => Promise<void>
  moveCandidateStage: (candidateId: string, stage: string, status?: string) => Promise<void>
  addInterview: (candidateId: string, input: CreateInterviewInput) => Promise<void>
  rerunScreening: (
    candidateId: string,
    input: { resumeText: string; file: File | null; model?: string },
    onEvent: (event: RecruitCandidateStreamEvent) => void,
    signal?: AbortSignal,
  ) => Promise<void>
  loadInterviews: () => Promise<void>
  loadAnalytics: () => Promise<void>
}

async function runAction<T>(set: (partial: Partial<RecruitStoreState>) => void, action: () => Promise<T>) {
  set({ loading: true, error: '' })
  try {
    const result = await action()
    set({ loading: false })
    return result
  } catch (error) {
    set({ loading: false, error: error instanceof Error ? error.message : '请求失败' })
    throw error
  }
}

// 候选人维度变更后统一失效依赖它的所有视图数据：
// 候选人列表、岗位详情里的候选人队列、首页 dashboard 卡片。
// 这是“详情页改了、外面不更新”的闭环关键。
async function invalidateCandidateViews(store: RecruitStoreState, jobId: string | undefined) {
  const refreshes: Promise<void>[] = [store.loadCandidates(jobId ? { job_id: jobId } : undefined)]
  if (jobId && store.jobDetail?.job.job_id === jobId) {
    refreshes.push(store.loadJobDetail(jobId))
  }
  if (store.dashboard) {
    refreshes.push(store.loadDashboard())
  }
  await Promise.all(refreshes)
}

export const useRecruitStore = create<RecruitStoreState>((set, get) => ({
  loading: false,
  error: '',
  dashboard: null,
  jobs: [],
  candidates: [],
  interviews: [],
  analytics: null,
  jobDetail: null,
  candidateDetail: null,

  setError: (message) => set({ error: message }),
  clearError: () => set({ error: '' }),

  loadDashboard: async () => {
    const dashboard = await runAction(set, fetchRecruitDashboard)
    set({ dashboard })
  },

  loadJobs: async () => {
    const jobs = await runAction(set, fetchRecruitJobs)
    set({ jobs })
  },

  loadJobDetail: async (jobId) => {
    const jobDetail = await runAction(set, () => fetchRecruitJobDetail(jobId))
    set({ jobDetail })
  },

  createJob: async (input) => {
    const job = await runAction(set, () => createRecruitJob(input))
    set({ jobs: [job, ...get().jobs] })
    return job
  },

  updateJob: async (jobId, input) => {
    const updated = await runAction(set, () => updateRecruitJob(jobId, input))
    set({
      jobs: get().jobs.map((job) => job.job_id === jobId ? updated : job),
      jobDetail: get().jobDetail?.job.job_id === jobId ? { ...get().jobDetail!, job: updated } : get().jobDetail
    })
    return updated
  },

  loadCandidates: async (params) => {
    const candidates = await runAction(set, () => fetchRecruitCandidates(params))
    set({ candidates })
  },

  createCandidate: async (input) => {
    const candidate = await runAction(set, () => createRecruitCandidate(input))
    set({ candidates: [candidate, ...get().candidates] })
    return candidate
  },

  createCandidateStream: async (input, onEvent, signal) => {
    const candidate = await runAction(set, () => streamRecruitCandidate(input, onEvent, signal))
    set({ candidates: [candidate, ...get().candidates] })
    return candidate
  },

  loadCandidateDetail: async (candidateId) => {
    const candidateDetail = await runAction(set, () => fetchRecruitCandidateDetail(candidateId))
    set({ candidateDetail })
  },

  updateCandidateProfile: async (candidateId, input) => {
    // PATCH 返回的 summary 直接带 job_id，比刷新后的 candidateDetail 更可靠
    const updated = await runAction(set, () => updateRecruitCandidateProfile(candidateId, input))
    await get().loadCandidateDetail(candidateId)
    await invalidateCandidateViews(get(), updated?.job_id ?? get().candidateDetail?.candidate.job_id)
  },

  moveCandidateStage: async (candidateId, stage, status) => {
    await runAction(set, () => updateRecruitCandidateStage(candidateId, stage, status))
    await get().loadCandidateDetail(candidateId)
    await invalidateCandidateViews(get(), get().candidateDetail?.candidate.job_id)
  },

  addInterview: async (candidateId, input) => {
    await runAction(set, () => createRecruitInterview(candidateId, input))
    await get().loadCandidateDetail(candidateId)
    await get().loadInterviews()
  },

  rerunScreening: async (candidateId, input, onEvent, signal) => {
    await runAction(set, () => streamRecruitScreening(candidateId, input, onEvent, signal))
    await get().loadCandidateDetail(candidateId)
    await invalidateCandidateViews(get(), get().candidateDetail?.candidate.job_id)
  },

  loadInterviews: async () => {
    const interviews = await runAction(set, fetchRecruitInterviews)
    set({ interviews })
  },

  loadAnalytics: async () => {
    const analytics = await runAction(set, fetchRecruitAnalytics)
    set({ analytics })
  }
}))
