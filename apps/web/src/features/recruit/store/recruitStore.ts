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
  rerunRecruitScreening,
  updateRecruitCandidateStage,
  updateRecruitJob,
} from '@/features/recruit/lib/api'
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
  loadCandidateDetail: (candidateId: string) => Promise<void>
  moveCandidateStage: (candidateId: string, stage: string, status?: string) => Promise<void>
  addInterview: (candidateId: string, input: CreateInterviewInput) => Promise<void>
  rerunScreening: (candidateId: string, resumeText: string, file: File | null) => Promise<void>
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

  loadCandidateDetail: async (candidateId) => {
    const candidateDetail = await runAction(set, () => fetchRecruitCandidateDetail(candidateId))
    set({ candidateDetail })
  },

  moveCandidateStage: async (candidateId, stage, status) => {
    await runAction(set, () => updateRecruitCandidateStage(candidateId, stage, status))
    await get().loadCandidateDetail(candidateId)
    await get().loadCandidates()
  },

  addInterview: async (candidateId, input) => {
    await runAction(set, () => createRecruitInterview(candidateId, input))
    await get().loadCandidateDetail(candidateId)
    await get().loadInterviews()
  },

  rerunScreening: async (candidateId, resumeText, file) => {
    await runAction(set, () => rerunRecruitScreening(candidateId, resumeText, file))
    await get().loadCandidateDetail(candidateId)
    await get().loadCandidates()
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
