import { useEffect, useState } from 'react'
import { ArrowUpRight, BriefcaseBusiness, Copy, MapPin, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitDialog, RecruitPage, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { EmptyState } from '@/features/recruit/components/RecruitUI'
import { RECRUITMENT_TYPE_OPTIONS, recruitmentTypeLabel, recruitmentTypeVariant } from '@/features/recruit/lib/format'
import type { CreateRecruitJobInput, RecruitJobSummary, RecruitmentType } from '@/features/recruit/lib/types'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

type RecruitJobForm = Omit<CreateRecruitJobInput, 'recruitment_type'> & {
  recruitment_type: Exclude<RecruitmentType, 'unspecified'> | ''
}

const DEFAULT_JOB: RecruitJobForm = {
  title: '',
  department: '',
  location: '',
  employment_type: 'full-time',
  recruitment_type: '',
  status: 'open',
  hiring_manager: '',
  recruiter: '',
  priority: 'high',
  headcount: 1,
  description: '',
  requirements: '',
  tags: ''
}

const TYPE_TEXT: Record<'campus' | 'experienced', string> = { campus: '校招', experienced: '社招' }

// Copy defaults to the opposite recruitment type, swapping 校招/社招 in title and tags.
function buildCopyForm(job: RecruitJobSummary): RecruitJobForm {
  const source = job.recruitment_type === 'unspecified' ? null : job.recruitment_type
  const target = source === 'campus' ? 'experienced' : source === 'experienced' ? 'campus' : ''
  const swap = (text: string) => (source && target ? text.split(TYPE_TEXT[source]).join(TYPE_TEXT[target]) : text)
  return {
    title: swap(job.title),
    department: job.department,
    location: job.location,
    employment_type: job.employment_type || 'full-time',
    recruitment_type: target,
    status: job.status || 'open',
    hiring_manager: job.hiring_manager,
    recruiter: job.recruiter,
    priority: job.priority || 'high',
    headcount: job.headcount || 1,
    description: job.description,
    requirements: job.requirements,
    tags: job.tags.map(swap).join(',')
  }
}

export function RecruitJobsPage() {
  const navigate = useNavigate()
  const { jobs, error, loadJobs, createJob, loading } = useRecruitStore(useShallow((state) => ({
    jobs: state.jobs,
    error: state.error,
    loadJobs: state.loadJobs,
    createJob: state.createJob,
    loading: state.loading
  })))
  const [form, setForm] = useState<RecruitJobForm>(DEFAULT_JOB)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [copySourceTitle, setCopySourceTitle] = useState<string | null>(null)

  const openCreate = () => {
    setForm(DEFAULT_JOB)
    setCopySourceTitle(null)
    setIsCreateOpen(true)
  }

  const openCopy = (job: RecruitJobSummary) => {
    setForm(buildCopyForm(job))
    setCopySourceTitle(job.title)
    setIsCreateOpen(true)
  }

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  return (
    <RecruitPage title="岗位中心" eyebrow="Roles · 岗位" description="维护 JD、负责人和优先级；创建后即可接收简历并自动生成评分卡。" actions={<button type="button" className="recruit-button recruit-button--primary" onClick={openCreate}><Plus size={15} />新增岗位</button>}>
      <ErrorBanner message={error} />
      {isCreateOpen ? (
        <RecruitDialog
          title={copySourceTitle ? '复制岗位' : '新建岗位'}
          description={copySourceTitle ? `基于「${copySourceTitle}」创建，已自动切换校招/社招，请确认后保存。` : 'JD 写得越具体，AI 生成的评分卡越精准。'}
          onClose={() => setIsCreateOpen(false)}
        >
          <form
            className="recruit-form"
            onSubmit={(event) => {
              event.preventDefault()
              const recruitmentType = form.recruitment_type
              if (!recruitmentType) return
              void createJob({ ...form, recruitment_type: recruitmentType }).then((job) => {
                setForm(DEFAULT_JOB)
                setCopySourceTitle(null)
                setIsCreateOpen(false)
                navigate(`/recruit/jobs/${job.job_id}`)
              }).catch(() => undefined)
            }}
          >
            <label className="recruit-field">
              <span>岗位名称</span>
              <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：AI 解决方案工程师 · 校招" />
            </label>
            <label className="recruit-field">
              <span>招聘类型</span>
              <select required value={form.recruitment_type} onChange={(event) => setForm({ ...form, recruitment_type: event.target.value as RecruitJobForm['recruitment_type'] })}>
                <option value="">请选择招聘类型</option>
                {RECRUITMENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="recruit-field-grid">
              <label className="recruit-field"><span>部门</span><input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="数字化中心" /></label>
              <label className="recruit-field"><span>地点</span><input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="深圳宝安" /></label>
              <label className="recruit-field"><span>用人经理</span><input value={form.hiring_manager} onChange={(event) => setForm({ ...form, hiring_manager: event.target.value })} placeholder="姓名" /></label>
              <label className="recruit-field"><span>招聘 HR</span><input value={form.recruiter} onChange={(event) => setForm({ ...form, recruiter: event.target.value })} placeholder="姓名" /></label>
            </div>
            <label className="recruit-field">
              <span>岗位职责</span>
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={6} placeholder="你将做什么：业务场景、交付目标…" />
            </label>
            <label className="recruit-field">
              <span>任职要求 / 加分项</span>
              <textarea value={form.requirements} onChange={(event) => setForm({ ...form, requirements: event.target.value })} rows={6} placeholder="我们希望你是…；加分项…" />
            </label>
            <label className="recruit-field">
              <span>标签</span>
              <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="逗号分隔，例如：校招,AI,全栈" />
            </label>
            <button type="submit" disabled={loading} className="recruit-button recruit-button--primary recruit-button--wide">
              {loading ? '创建中…' : copySourceTitle ? '创建副本' : '创建岗位'}
            </button>
          </form>
        </RecruitDialog>
      ) : null}

        <SectionCard
          title="岗位列表"
          description="岗位状态、候选人规模和优先级一览。"
          icon={<BriefcaseBusiness size={15} />}
          aside={<span className="rx-count-pill">{jobs.length} 个岗位</span>}
        >
          <div className="rx-job-grid">
            {jobs.map((job, index) => (
              <div key={job.job_id} className="rx-job-card-wrap">
              <Link to={`/recruit/jobs/${job.job_id}`} className="rx-job-card rx-spot" style={{ ['--i' as string]: index }}>
                <div className="rx-job-card__top">
                  <span className={`rx-status rx-status--${job.status}`}>{job.status}</span>
                  <span className={`rx-recruitment-type rx-recruitment-type--${recruitmentTypeVariant(job.recruitment_type)}`}>{recruitmentTypeLabel(job.recruitment_type)}</span>
                  <span className={`rx-priority rx-priority--${job.priority}`}>{PRIORITY_LABELS[job.priority] || job.priority}</span>
                </div>
                <strong>{job.title}</strong>
                <p><MapPin size={12} />{job.location || '未填写地点'} · {job.department || '未填写部门'}</p>
                {job.tags.length ? (
                  <div className="rx-tags">{job.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
                ) : null}
                <div className="rx-job-card__foot">
                  <span><b>{job.candidate_count}</b> 位候选人</span>
                  <span>HC {job.headcount}</span>
                  <ArrowUpRight size={15} />
                </div>
              </Link>
              <button type="button" className="rx-job-card__copy" title="复制岗位" aria-label={`复制岗位 ${job.title}`} onClick={() => openCopy(job)}>
                <Copy size={13} />复制
              </button>
              </div>
            ))}
            {!jobs.length && !loading ? (
              <EmptyState icon={<BriefcaseBusiness size={20} />} title="还没有岗位" hint="点击右上角新增岗位，创建第一个岗位。" />
            ) : null}
          </div>
        </SectionCard>
    </RecruitPage>
  )
}

const PRIORITY_LABELS: Record<string, string> = { high: '高优先级', medium: '中优先级', low: '低优先级' }
