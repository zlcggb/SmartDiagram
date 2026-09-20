import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorBanner, RecruitPage, ScoreBadge, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import type { CreateRecruitCandidateInput } from '@/features/recruit/lib/types'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

const DEFAULT_CANDIDATE: CreateRecruitCandidateInput = {
  job_id: '',
  full_name: '',
  email: '',
  phone: '',
  current_company: '',
  location: '',
  source_channel: '主动投递',
  portfolio_url: '',
  linkedin_url: '',
  summary: '',
  notes: '',
  tags: '',
  resume_text: '',
  file: null
}

export function RecruitCandidatesPage() {
  const { jobs, candidates, error, loadJobs, loadCandidates, createCandidate, loading } = useRecruitStore((state) => ({
    jobs: state.jobs,
    candidates: state.candidates,
    error: state.error,
    loadJobs: state.loadJobs,
    loadCandidates: state.loadCandidates,
    createCandidate: state.createCandidate,
    loading: state.loading
  }))
  const [form, setForm] = useState<CreateRecruitCandidateInput>(DEFAULT_CANDIDATE)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void loadJobs()
    void loadCandidates()
  }, [loadCandidates, loadJobs])

  const visibleCandidates = useMemo(() => {
    if (!query.trim()) return candidates
    const needle = query.trim().toLowerCase()
    return candidates.filter((candidate) =>
      [candidate.full_name, candidate.email, candidate.current_company, candidate.job_title].some((item) =>
        item.toLowerCase().includes(needle)
      )
    )
  }, [candidates, query])

  return (
    <RecruitPage title="候选人中心" description="录入候选人档案、上传简历、生成 AI 初筛，并持续跟踪到岗位与阶段。">
      <ErrorBanner message={error} />
      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <SectionCard title="新增候选人" description="这里会真实写入数据库，并自动生成初筛结果。">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void createCandidate(form).then((candidate) => {
                setForm(DEFAULT_CANDIDATE)
                window.location.href = `/recruit/candidates/${candidate.candidate_id}`
              })
            }}
          >
            <select value={form.job_id} onChange={(event) => setForm({ ...form, job_id: event.target.value })} className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white">
              <option value="">选择岗位</option>
              {jobs.map((job) => <option key={job.job_id} value={job.job_id}>{job.title}</option>)}
            </select>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} placeholder="姓名" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
              <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="邮箱" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="电话" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
              <input value={form.source_channel} onChange={(event) => setForm({ ...form, source_channel: event.target.value })} placeholder="来源渠道" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
              <input value={form.current_company} onChange={(event) => setForm({ ...form, current_company: event.target.value })} placeholder="当前公司" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
              <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="所在地" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
            </div>
            <textarea value={form.resume_text} onChange={(event) => setForm({ ...form, resume_text: event.target.value })} rows={8} placeholder="粘贴简历正文、项目经历和作品信息。" className="rounded-3xl border border-white/10 bg-slate-900/80 px-4 py-4 text-sm text-white" />
            <label className="rounded-2xl border border-dashed border-white/20 bg-white/5 px-4 py-4 text-sm text-slate-300">
              上传 PDF / DOCX / TXT
              <input type="file" accept=".pdf,.docx,.txt,.md" className="mt-3 block w-full text-xs" onChange={(event) => setForm({ ...form, file: event.target.files?.[0] ?? null })} />
            </label>
            <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="标签，逗号分隔" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
            <button type="submit" disabled={loading} className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950">{loading ? '保存中…' : '保存候选人并触发 AI 初筛'}</button>
          </form>
        </SectionCard>

        <SectionCard title="候选人列表" description="支持筛选评分、阶段和岗位。">
          <div className="mb-4">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名 / 邮箱 / 公司 / 岗位" className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
          </div>
          <div className="space-y-3">
            {visibleCandidates.map((candidate) => (
              <Link key={candidate.candidate_id} to={`/recruit/candidates/${candidate.candidate_id}`} className="block rounded-3xl border border-white/8 bg-white/5 px-4 py-4 transition hover:bg-white/8">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <strong className="text-sm text-white">{candidate.full_name}</strong>
                    <p className="mt-1 text-xs text-slate-400">{candidate.job_title} · {candidate.current_stage} · {candidate.source_channel}</p>
                  </div>
                  <ScoreBadge score={candidate.latest_screening?.total_score} />
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{candidate.summary || candidate.notes || '暂无补充信息'}</p>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>
    </RecruitPage>
  )
}
