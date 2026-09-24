import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitPage, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
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
  const { jobs, error, loadJobs, createJob, loading } = useRecruitStore(useShallow((state) => ({
    jobs: state.jobs,
    error: state.error,
    loadJobs: state.loadJobs,
    createJob: state.createJob,
    loading: state.loading
  })))
  const [form, setForm] = useState<CreateRecruitJobInput>(DEFAULT_JOB)

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  return (
    <RecruitPage title="岗位" description="维护 JD、负责人和优先级；创建后即可接收简历并自动评分。">
      <ErrorBanner message={error} />
      <div className="recruit-workspace-grid">
        <SectionCard title="新建岗位" description="岗位创建后即可在候选人中心投递并生成 AI 初筛。">
          <form
            className="recruit-form"
            onSubmit={(event) => {
              event.preventDefault()
              void createJob(form).then((job) => {
                setForm(DEFAULT_JOB)
                window.location.href = `/recruit/jobs/${job.job_id}`
              }).catch(() => undefined)
            }}
          >
            <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="岗位名称" />
            <div className="recruit-field-grid">
              <input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="部门" />
              <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="地点" />
              <input value={form.hiring_manager} onChange={(event) => setForm({ ...form, hiring_manager: event.target.value })} placeholder="招聘负责人" />
              <input value={form.recruiter} onChange={(event) => setForm({ ...form, recruiter: event.target.value })} placeholder="Recruiter" />
            </div>
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={7} placeholder="岗位描述" />
            <textarea value={form.requirements} onChange={(event) => setForm({ ...form, requirements: event.target.value })} rows={7} placeholder="关键要求 / 标签" />
            <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="标签，逗号分隔" />
            <button type="submit" disabled={loading} className="recruit-button recruit-button--primary">
              {loading ? '创建中…' : '创建岗位'}
            </button>
          </form>
        </SectionCard>

        <SectionCard title="岗位列表" description="查看岗位状态、候选人规模和当前优先级。">
          <div className="recruit-list">
            {jobs.map((job) => (
              <Link key={job.job_id} to={`/recruit/jobs/${job.job_id}`} className="recruit-list-row recruit-list-row--link">
                <div className="recruit-list-row__main">
                  <strong>{job.title}</strong>
                  <p>{job.department || '未填写部门'} · {job.location || '未填写地点'} · {job.status}</p>
                  </div>
                <span className="recruit-count">{job.candidate_count} 位候选人</span>
              </Link>
            ))}
            {!jobs.length ? <p className="recruit-empty-state">还没有岗位。填写 JD 后即可创建第一个岗位。</p> : null}
          </div>
        </SectionCard>
      </div>
    </RecruitPage>
  )
}
