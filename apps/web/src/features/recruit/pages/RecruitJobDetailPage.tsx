import { useEffect, useState } from 'react'
import { BriefcaseBusiness, ChevronDown, Filter, Pencil, UsersRound } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitDialog, RecruitPage, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { Avatar, EmptyState, MeterBar, ScoreRing, StageChip } from '@/features/recruit/components/RecruitUI'
import { RECRUITMENT_TYPE_OPTIONS, recruitmentTypeLabel, recruitmentTypeVariant } from '@/features/recruit/lib/format'
import type { CreateRecruitJobInput, RecruitmentType } from '@/features/recruit/lib/types'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

type RecruitJobDraft = Omit<CreateRecruitJobInput, 'status'>

const EMPTY_RECRUIT_JOB_DRAFT: RecruitJobDraft = {
  title: '',
  department: '',
  location: '',
  employment_type: 'full-time',
  recruitment_type: 'unspecified',
  hiring_manager: '',
  recruiter: '',
  priority: 'medium',
  headcount: 1,
  description: '',
  requirements: '',
  tags: ''
}

function RecruitJobTextSection({ title, value, placeholder }: { title: string; value: string; placeholder: string }) {
  const content = value.trim() || placeholder
  const characters = Array.from(content.replace(/\s+/g, ' ').trim())

  if (characters.length <= 240) {
    return <section className="recruit-copy-section"><p>{title}</p><div>{content}</div></section>
  }

  return (
    <details className="recruit-copy-section recruit-copy-section--collapsible">
      <summary>
        <span className="recruit-copy-section__title">{title}</span>
        <span className="recruit-copy-section__preview">{characters.slice(0, 160).join('')}…</span>
        <span className="recruit-copy-section__toggle">
          <span>展开全文</span>
          <span>收起</span>
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </summary>
      <div className="recruit-copy-section__body" tabIndex={0}>{content}</div>
    </details>
  )
}

export function RecruitJobDetailPage() {
  const { jobId = '' } = useParams()
  const { jobDetail, error, loading, loadJobDetail, updateJob } = useRecruitStore(useShallow((state) => ({
    jobDetail: state.jobDetail,
    error: state.error,
    loading: state.loading,
    loadJobDetail: state.loadJobDetail,
    updateJob: state.updateJob
  })))
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editDraft, setEditDraft] = useState<RecruitJobDraft>(EMPTY_RECRUIT_JOB_DRAFT)

  useEffect(() => {
    if (jobId) void loadJobDetail(jobId)
  }, [jobId, loadJobDetail])

  const pipelineMax = Math.max(1, ...(jobDetail?.pipeline ?? []).map((item) => item.count))
  const jobDescription = jobDetail?.job.description.trim() ?? ''
  const jobRequirements = jobDetail?.job.requirements.trim() ?? ''
  const hasDistinctRequirements = Boolean(jobRequirements)
    && jobRequirements.replace(/\s+/g, ' ') !== jobDescription.replace(/\s+/g, ' ')

  function openEditDialog() {
    if (!jobDetail) return
    setEditDraft({
      title: jobDetail.job.title,
      department: jobDetail.job.department,
      location: jobDetail.job.location,
      employment_type: jobDetail.job.employment_type || 'full-time',
      recruitment_type: jobDetail.job.recruitment_type || 'unspecified',
      hiring_manager: jobDetail.job.hiring_manager,
      recruiter: jobDetail.job.recruiter,
      priority: jobDetail.job.priority || 'medium',
      headcount: jobDetail.job.headcount || 1,
      description: jobDetail.job.description,
      requirements: jobDetail.job.requirements,
      tags: jobDetail.job.tags.join(', ')
    })
    setIsEditOpen(true)
  }

  function updateEditDraft<Key extends keyof RecruitJobDraft>(field: Key, value: RecruitJobDraft[Key]) {
    setEditDraft((current) => ({ ...current, [field]: value }))
  }

  return (
    <RecruitPage
      title={jobDetail?.job.title || '岗位详情'}
      eyebrow="Role · 岗位详情"
      description="从岗位视角浏览 JD、候选人队列和当前招聘阶段。"
      actions={jobDetail ? <button type="button" className="recruit-button recruit-button--primary" onClick={openEditDialog}><Pencil size={15} />编辑岗位</button> : undefined}
    >
      <ErrorBanner message={error} />
      {isEditOpen ? (
        <RecruitDialog title="编辑岗位" description="修改岗位信息、JD 和招聘配置。" onClose={() => setIsEditOpen(false)}>
          <form
            className="recruit-form"
            onSubmit={(event) => {
              event.preventDefault()
              void updateJob(jobId, editDraft).then(() => setIsEditOpen(false)).catch(() => undefined)
            }}
          >
            {error ? <p className="recruit-form-error">{error}</p> : null}
            <label className="recruit-field">
              <span>岗位名称</span>
              <input required value={editDraft.title} onChange={(event) => updateEditDraft('title', event.target.value)} />
            </label>
            <label className="recruit-field">
              <span>招聘类型</span>
              <select required value={editDraft.recruitment_type} onChange={(event) => updateEditDraft('recruitment_type', event.target.value as RecruitmentType)}>
                <option value="unspecified">未分类</option>
                {RECRUITMENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="recruit-field-grid">
              <label className="recruit-field"><span>部门</span><input value={editDraft.department} onChange={(event) => updateEditDraft('department', event.target.value)} /></label>
              <label className="recruit-field"><span>地点</span><input value={editDraft.location} onChange={(event) => updateEditDraft('location', event.target.value)} /></label>
              <label className="recruit-field"><span>用人经理</span><input value={editDraft.hiring_manager} onChange={(event) => updateEditDraft('hiring_manager', event.target.value)} /></label>
              <label className="recruit-field"><span>招聘 HR</span><input value={editDraft.recruiter} onChange={(event) => updateEditDraft('recruiter', event.target.value)} /></label>
              <label className="recruit-field">
                <span>用工类型</span>
                <select value={editDraft.employment_type} onChange={(event) => updateEditDraft('employment_type', event.target.value)}>
                  <option value="">未填写</option>
                  {!['full-time', 'part-time', 'internship', 'contract'].includes(editDraft.employment_type) ? <option value={editDraft.employment_type}>{editDraft.employment_type}</option> : null}
                  <option value="full-time">全职</option>
                  <option value="part-time">兼职</option>
                  <option value="internship">实习</option>
                  <option value="contract">合同</option>
                </select>
              </label>
              <label className="recruit-field">
                <span>优先级</span>
                <select value={editDraft.priority} onChange={(event) => updateEditDraft('priority', event.target.value)}>
                  {!['high', 'medium', 'low'].includes(editDraft.priority) ? <option value={editDraft.priority}>{editDraft.priority}</option> : null}
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </label>
              <label className="recruit-field">
                <span>招聘人数</span>
                <input type="number" min="1" step="1" value={editDraft.headcount} onChange={(event) => updateEditDraft('headcount', Math.max(1, Number(event.target.value) || 1))} />
              </label>
            </div>
            <label className="recruit-field">
              <span>岗位职责</span>
              <textarea rows={8} value={editDraft.description} onChange={(event) => updateEditDraft('description', event.target.value)} />
            </label>
            <label className="recruit-field">
              <span>任职要求 / 加分项</span>
              <textarea rows={8} value={editDraft.requirements} onChange={(event) => updateEditDraft('requirements', event.target.value)} />
            </label>
            <label className="recruit-field">
              <span>标签</span>
              <input value={editDraft.tags} onChange={(event) => updateEditDraft('tags', event.target.value)} placeholder="逗号分隔，例如：校招,AI,全栈" />
            </label>
            <button type="submit" disabled={loading} className="recruit-button recruit-button--primary recruit-button--wide">
              {loading ? '保存中…' : '保存修改'}
            </button>
          </form>
        </RecruitDialog>
      ) : null}
      {jobDetail ? (
        <div className="recruit-dashboard-grid">
          <SectionCard title="岗位信息" description="负责人、JD 与关键要求。" icon={<BriefcaseBusiness size={15} />}
            aside={<span className={`rx-status rx-status--${jobDetail.job.status}`}>{jobDetail.job.status}</span>}
          >
            <div className="recruit-job-profile">
              <dl className="recruit-definition-list">
                <div><dt>招聘类型</dt><dd><span className={`rx-recruitment-type rx-recruitment-type--${recruitmentTypeVariant(jobDetail.job.recruitment_type)}`}>{recruitmentTypeLabel(jobDetail.job.recruitment_type)}</span></dd></div>
                <div><dt>部门</dt><dd>{jobDetail.job.department || '未填写'}</dd></div>
                <div><dt>地点</dt><dd>{jobDetail.job.location || '未填写'}</dd></div>
                <div><dt>用人经理</dt><dd>{jobDetail.job.hiring_manager || '未填写'}</dd></div>
                <div><dt>招聘 HR</dt><dd>{jobDetail.job.recruiter || '未填写'}</dd></div>
              </dl>
              <RecruitJobTextSection title="岗位描述" value={jobDetail.job.description} placeholder="未填写岗位描述" />
              {hasDistinctRequirements ? <RecruitJobTextSection title="关键要求" value={jobDetail.job.requirements} placeholder="未填写关键要求" /> : null}
              <div className="recruit-status-control">
                <label>
                  <span>岗位状态</span>
                  <select value={status ?? jobDetail.job.status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="draft">draft · 草稿</option>
                    <option value="open">open · 招聘中</option>
                    <option value="on_hold">on_hold · 暂停</option>
                    <option value="closed">closed · 已关闭</option>
                  </select>
                </label>
                <button type="button" className="recruit-button recruit-button--primary" onClick={() => void updateJob(jobId, { status: status ?? jobDetail.job.status }).then(() => loadJobDetail(jobId))}>
                  更新状态
                </button>
              </div>
            </div>
          </SectionCard>

          <div className="rx-stack">
            <SectionCard title="岗位漏斗" description="按阶段看候选人分布。" icon={<Filter size={15} />}>
              <div className="rx-funnel">
                {jobDetail.pipeline.map((item, index) => (
                  <div key={item.stage} className="rx-funnel__row" style={{ ['--i' as string]: index }}>
                    <span>{item.label}</span>
                    <MeterBar value={item.count} max={pipelineMax} tone={item.stage === 'rejected' ? 'amber' : index === 0 ? 'ink' : 'accent'} label={item.label} />
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="候选人队列" description="按最近更新排序。" icon={<UsersRound size={15} />}>
              <div className="rx-people">
                {jobDetail.candidates.map((candidate, index) => (
                  <Link key={candidate.candidate_id} to={`/recruit/candidates/${candidate.candidate_id}`} className="rx-person" style={{ ['--i' as string]: index }}>
                    <Avatar name={candidate.full_name} />
                    <span className="rx-person__main">
                      <strong>{candidate.full_name}</strong>
                      <span>{candidate.source_channel || '未知来源'}</span>
                    </span>
                    <StageChip stage={candidate.current_stage} />
                    <ScoreRing score={candidate.latest_screening?.total_score} max={candidate.latest_screening?.max_score} size={46} stroke={4} />
                  </Link>
                ))}
                {!jobDetail.candidates.length ? (
                  <EmptyState icon={<UsersRound size={20} />} title="暂无候选人" hint="还没有候选人投递到这个岗位。" action={{ to: '/recruit/candidates', label: '添加候选人' }} />
                ) : null}
              </div>
            </SectionCard>
          </div>
        </div>
      ) : null}
    </RecruitPage>
  )
}
