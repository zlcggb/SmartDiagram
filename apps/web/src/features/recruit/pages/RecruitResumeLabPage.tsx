import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, FilePenLine, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitDialog, RecruitPage, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { AiLoader, EmptyState, ScoreRing } from '@/features/recruit/components/RecruitUI'
import { fetchRecruitCandidates } from '@/features/recruit/lib/api'
import {
  createResumeDraft,
  deleteResumeDraft,
  fetchResumeDrafts,
  resumeLabErrorMessage,
  resumeLabStorage,
  type ResumeDraftSummary,
  type ResumeLabStorage,
} from '@/features/recruit/lib/resumeLab'
import type { RecruitCandidateSummary } from '@/features/recruit/lib/types'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

import '../resume-lab.css'

type Source = 'candidate' | 'paste'

export function RecruitResumeLabPage() {
  const navigate = useNavigate()
  const { jobs, loadJobs } = useRecruitStore(useShallow((state) => ({ jobs: state.jobs, loadJobs: state.loadJobs })))
  const [drafts, setDrafts] = useState<ResumeDraftSummary[] | null>(null)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [source, setSource] = useState<Source>('candidate')
  const [candidates, setCandidates] = useState<RecruitCandidateSummary[]>([])
  const [candidateQuery, setCandidateQuery] = useState('')
  const [candidateId, setCandidateId] = useState('')
  const [jobId, setJobId] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [creating, setCreating] = useState(false)
  const [storage, setStorage] = useState<ResumeLabStorage>('server')

  useEffect(() => {
    resumeLabStorage().then(setStorage).catch(() => undefined)
    fetchResumeDrafts().then(setDrafts).catch((reason) => { setDrafts([]); setError(resumeLabErrorMessage(reason)) })
  }, [])

  useEffect(() => {
    if (!dialogOpen) return
    void loadJobs()
    fetchRecruitCandidates().then(setCandidates).catch(() => setCandidates([]))
  }, [dialogOpen, loadJobs])

  const filteredCandidates = useMemo(() => {
    const query = candidateQuery.trim().toLowerCase()
    const list = query
      ? candidates.filter((item) => `${item.full_name} ${item.job_title} ${item.current_company}`.toLowerCase().includes(query))
      : candidates
    return list.slice(0, 30)
  }, [candidates, candidateQuery])

  const canCreate = source === 'candidate' ? Boolean(candidateId) : Boolean(jobId && resumeText.trim())

  const create = async () => {
    if (!canCreate || creating) return
    setCreating(true)
    setError('')
    try {
      const draft = await createResumeDraft(source === 'candidate'
        ? { candidate_id: candidateId }
        : { job_id: jobId, resume_text: resumeText.trim() })
      navigate(`/recruit/resume-lab/${draft.id}`)
    } catch (reason) {
      setError(resumeLabErrorMessage(reason))
      setCreating(false)
      setDialogOpen(false)
    }
  }

  const remove = async (draft: ResumeDraftSummary) => {
    if (!window.confirm(`删除「${draft.title}」？对话和评分记录会一起删除。`)) return
    try {
      await deleteResumeDraft(draft.id)
      setDrafts((current) => current?.filter((item) => item.id !== draft.id) ?? null)
    } catch (reason) {
      setError(resumeLabErrorMessage(reason))
    }
  }

  return (
    <RecruitPage
      title="简历优化"
      eyebrow="Resume Lab · 简历工作台"
      description="左边和 AI 对话改简历，右边实时预览、随手改；一键对照岗位评分，改到满意的分数为止。"
      actions={<button type="button" className="recruit-button recruit-button--primary" onClick={() => setDialogOpen(true)}><Plus size={15} />新建优化</button>}
    >
      <ErrorBanner message={error} />
      {dialogOpen ? (
        <RecruitDialog title="新建简历优化" description="选一份简历和目标岗位，AI 会把简历整理成可编辑模板。" onClose={() => { if (!creating) setDialogOpen(false) }}>
          <div className="recruit-form">
            <div className="rl-source-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={source === 'candidate'} className={source === 'candidate' ? 'is-active' : ''} onClick={() => setSource('candidate')}>从候选人导入</button>
              <button type="button" role="tab" aria-selected={source === 'paste'} className={source === 'paste' ? 'is-active' : ''} onClick={() => setSource('paste')}>粘贴简历文本</button>
            </div>
            {source === 'candidate' ? (
              <>
                <label className="recruit-field">
                  <span>搜索候选人</span>
                  <input value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="姓名 / 岗位 / 公司" />
                </label>
                <div className="rl-candidate-list" role="listbox">
                  {filteredCandidates.length ? filteredCandidates.map((item) => (
                    <button
                      key={item.candidate_id}
                      type="button"
                      role="option"
                      aria-selected={candidateId === item.candidate_id}
                      className={candidateId === item.candidate_id ? 'is-active' : ''}
                      onClick={() => setCandidateId(item.candidate_id)}
                    >
                      <strong>{item.full_name}</strong>
                      <span>{item.job_title}</span>
                      <em>{typeof item.latest_screening?.total_score === 'number' ? `${item.latest_screening.total_score} 分` : '未评分'}</em>
                    </button>
                  )) : <p className="rl-muted">暂无候选人</p>}
                </div>
              </>
            ) : (
              <>
                <label className="recruit-field">
                  <span>目标岗位</span>
                  <select value={jobId} onChange={(event) => setJobId(event.target.value)}>
                    <option value="">请选择岗位（评分依据）</option>
                    {jobs.map((job) => <option key={job.job_id} value={job.job_id}>{job.title}</option>)}
                  </select>
                </label>
                <label className="recruit-field">
                  <span>简历正文</span>
                  <textarea rows={9} value={resumeText} onChange={(event) => setResumeText(event.target.value)} placeholder="把简历内容粘贴到这里…" />
                </label>
              </>
            )}
            <button type="button" disabled={!canCreate || creating} className="recruit-button recruit-button--primary recruit-button--wide" onClick={() => void create()}>
              {creating ? <AiLoader label="AI 正在整理简历…" /> : <><Sparkles size={15} />开始优化</>}
            </button>
          </div>
        </RecruitDialog>
      ) : null}

      <SectionCard
        title="我的简历草稿"
        description={storage === 'browser'
          ? '访客模式：草稿、对话和评分只保存在当前浏览器，清理浏览器数据会丢失；登录后可保存到账号。'
          : '每份草稿都保留完整的对话、版本评分和修改记录。'}
        icon={<FilePenLine size={15} />}
        aside={<span className="rx-count-pill">{drafts?.length ?? 0} 份</span>}
      >
        {drafts === null ? <AiLoader label="加载中…" /> : drafts.length ? (
          <div className="rl-draft-grid">
            {drafts.map((draft) => {
              const delta = draft.latest_score !== null && draft.first_score !== null ? draft.latest_score - draft.first_score : null
              return (
                <div key={draft.id} className="rl-draft-card-wrap">
                  <Link to={`/recruit/resume-lab/${draft.id}`} className="rl-draft-card">
                    <ScoreRing score={draft.latest_score} size={52} stroke={5} />
                    <div className="rl-draft-card__body">
                      <strong>{draft.title}</strong>
                      <span>
                        {draft.score_count ? `${draft.score_count} 次评分` : '尚未评分'}
                        {delta ? <b className={delta > 0 ? 'is-up' : 'is-down'}>{delta > 0 ? `+${delta}` : delta}</b> : null}
                      </span>
                      <em>更新于 {new Date(draft.updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</em>
                    </div>
                    <ArrowUpRight size={16} className="rl-draft-card__go" />
                  </Link>
                  <button type="button" className="rl-draft-card__delete" title="删除草稿" aria-label={`删除 ${draft.title}`} onClick={() => void remove(draft)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState icon={<FilePenLine size={20} />} title="还没有简历草稿" hint="从候选人导入一份简历，或直接粘贴简历文本开始优化。" />
        )}
      </SectionCard>
    </RecruitPage>
  )
}
