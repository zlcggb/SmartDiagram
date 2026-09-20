import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorBanner, RecruitPage, ScoreBadge, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import type { CreateRecruitJobInput } from '@/features/recruit/lib/types'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

const DEFAULT_JOB: CreateRecruitJobInput = {
  title: '',
  department: '',
  location: '',
  employment_type: 'full-time',
  status: 'open',
  hiring_manager: '',
  recruiter: '',
  priority: 'high',
  headcount: 1,
  description: '',
  requirements: '',
  tags: ''
}

export function RecruitJobsPage() {
  const { jobs, error, loadJobs, createJob, loading } = useRecruitStore((state) => ({
    jobs: state.jobs,
    error: state.error,
    loadJobs: state.loadJobs,
    createJob: state.createJob,
    loading: state.loading
  }))
  const [form, setForm] = useState<CreateRecruitJobInput>(DEFAULT_JOB)

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  return (
    <RecruitPage title="岗位中心" description="维护正式 JD、岗位负责人、优先级与招聘阶段配置。">
      <ErrorBanner message={error} />
      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <SectionCard title="新建岗位" description="岗位创建后即可在候选人中心投递并生成 AI 初筛。">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void createJob(form).then((job) => {
                setForm(DEFAULT_JOB)
                window.location.href = `/recruit/jobs/${job.job_id}`
              })
            }}
          >
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="岗位名称" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
            <div className="grid gap-3 md:grid-cols-2">
              <input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="部门" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
              <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="地点" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
              <input value={form.hiring_manager} onChange={(event) => setForm({ ...form, hiring_manager: event.target.value })} placeholder="招聘负责人" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
              <input value={form.recruiter} onChange={(event) => setForm({ ...form, recruiter: event.target.value })} placeholder="Recruiter" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
            </div>
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={7} placeholder="岗位描述" className="rounded-3xl border border-white/10 bg-slate-900/80 px-4 py-4 text-sm text-white" />
            <textarea value={form.requirements} onChange={(event) => setForm({ ...form, requirements: event.target.value })} rows={7} placeholder="关键要求 / 标签" className="rounded-3xl border border-white/10 bg-slate-900/80 px-4 py-4 text-sm text-white" />
            <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="标签，逗号分隔" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
            <button type="submit" disabled={loading} className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950">
              {loading ? '创建中…' : '创建岗位'}
            </button>
          </form>
        </SectionCard>

        <SectionCard title="岗位列表" description="查看岗位状态、候选人规模和当前优先级。">
          <div className="space-y-3">
            {jobs.map((job) => (
              <Link key={job.job_id} to={`/recruit/jobs/${job.job_id}`} className="block rounded-3xl border border-white/8 bg-white/5 px-4 py-4 transition hover:bg-white/8">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <strong className="text-sm text-white">{job.title}</strong>
                    <p className="mt-1 text-xs text-slate-400">{job.department || '未填写部门'} · {job.location || '未填写地点'} · {job.status}</p>
                  </div>
                  <div className="text-right">
                    <ScoreBadge score={job.candidate_count ? Math.min(99, job.candidate_count * 10) : 0} />
                    <p className="mt-1 text-xs text-slate-400">{job.candidate_count} 位候选人</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>
    </RecruitPage>
  )
}
