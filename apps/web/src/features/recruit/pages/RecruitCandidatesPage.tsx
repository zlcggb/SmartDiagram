import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitPage, ScoreBadge, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { ensureRecruitDefaultJob, previewRecruitResume } from '@/features/recruit/lib/api'
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
  const { clearError, jobs, candidates, error, loadJobs, loadCandidates, createCandidate, loading } = useRecruitStore(useShallow((state) => ({
    clearError: state.clearError,
    jobs: state.jobs,
    candidates: state.candidates,
    error: state.error,
    loadJobs: state.loadJobs,
    loadCandidates: state.loadCandidates,
    createCandidate: state.createCandidate,
    loading: state.loading
  })))
  const [form, setForm] = useState<CreateRecruitCandidateInput>(DEFAULT_CANDIDATE)
  const [query, setQuery] = useState('')
  const [formError, setFormError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await loadJobs()
        if (cancelled) return
        if (useRecruitStore.getState().jobs.length === 0) {
          await ensureRecruitDefaultJob()
          if (!cancelled) await loadJobs()
        }
        if (!cancelled) await loadCandidates()
      } catch (loadError) {
        if (!cancelled) setFormError(loadError instanceof Error ? loadError.message : '招聘数据加载失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadCandidates, loadJobs])

  function handleResumeFile(file: File | null) {
    setForm((current) => ({ ...current, file }))
    setFormError('')
    if (!file) return

    setPreviewLoading(true)
    void previewRecruitResume(file)
      .then((preview) => {
        setForm((current) => ({
          ...current,
          file,
          full_name: current.full_name || preview.profile.full_name,
          email: current.email || preview.profile.email,
          phone: current.phone || preview.profile.phone,
          current_company: current.current_company || preview.profile.current_company,
          location: current.location || preview.profile.location,
          resume_text: current.resume_text || preview.parsed_text,
        }))
      })
      .catch((previewError) => {
        setFormError(previewError instanceof Error ? previewError.message : '简历解析失败，请继续手动补充')
      })
      .finally(() => setPreviewLoading(false))
  }

  const visibleCandidates = useMemo(() => {
    if (!query.trim()) return candidates
    const needle = query.trim().toLowerCase()
    return candidates.filter((candidate) =>
      [
        candidate.full_name,
        candidate.profile_summary?.full_name,
        candidate.profile_summary?.headline,
        candidate.profile_summary?.summary,
        candidate.email,
        candidate.current_company,
        candidate.job_title,
        ...(candidate.profile_summary?.skills ?? []),
      ].some((item) =>
        (item || '').toLowerCase().includes(needle)
      )
    )
  }, [candidates, query])
  const selectedJobId = form.job_id || jobs[0]?.job_id || ''

  return (
    <RecruitPage title="候选人" description="上传 PDF 简历后自动识别档案、完成评分，并进入岗位流程。">
      <ErrorBanner message={error} />
      <div className="recruit-workspace-grid">
        <SectionCard title="新增候选人" description="PDF 优先；识别到的信息可在候选人档案中再修正。">
          <form
            className="recruit-form"
            onSubmit={(event) => {
              event.preventDefault()
              setFormError('')
              clearError()
              if (!selectedJobId) {
                setFormError('请先选择一个岗位。')
                return
              }
              if (!form.resume_text.trim() && !form.file) {
                setFormError('请上传 PDF，或展开“手动补充”填写简历正文。')
                return
              }
              if (!form.file && (!form.full_name.trim() || !form.resume_text.trim())) {
                setFormError('手动录入模式需要填写姓名和简历正文；也可以直接上传 PDF 自动识别。')
                return
              }
              void createCandidate({ ...form, job_id: selectedJobId }).then((candidate) => {
                setForm(DEFAULT_CANDIDATE)
                window.location.href = `/recruit/candidates/${candidate.candidate_id}`
              }).catch(() => undefined)
            }}
          >
            <label className="recruit-upload-zone">
              <span className="recruit-upload-zone__head">
                <span>
                  <strong>上传简历 PDF</strong>
                  <span>上传 PDF → 选择岗位 → 自动识别信息并开始 AI 初筛</span>
                </span>
                {previewLoading ? <span className="recruit-upload-zone__status">正在识别…</span> : null}
              </span>
              <input type="file" accept=".pdf,application/pdf,.docx,.txt,.md" onChange={(event) => handleResumeFile(event.target.files?.[0] ?? null)} />
              <span className="recruit-upload-zone__caption">{form.file ? `已选择：${form.file.name}` : 'PDF 会自动识别姓名、邮箱、电话和简历正文。'}</span>
            </label>
            <label className="recruit-field">
              <span>投递岗位</span>
              <select required value={selectedJobId} onChange={(event) => setForm({ ...form, job_id: event.target.value })}>
              <option value="">选择岗位</option>
              {jobs.map((job) => <option key={job.job_id} value={job.job_id}>{job.title}</option>)}
              </select>
            </label>
            {jobs.length === 0 ? <p className="recruit-inline-note">正在准备默认 AI 岗位，请稍候…</p> : null}

            <details className="recruit-disclosure">
              <summary>手动补充信息（可选）</summary>
              <div className="recruit-disclosure__content recruit-field-grid">
                <input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} placeholder="姓名（PDF 会自动识别）" />
                <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="邮箱（PDF 会自动识别）" />
                <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="电话（可选）" />
                <input value={form.source_channel} onChange={(event) => setForm({ ...form, source_channel: event.target.value })} placeholder="来源渠道" />
                <input value={form.current_company} onChange={(event) => setForm({ ...form, current_company: event.target.value })} placeholder="当前公司（可选）" />
                <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="所在地（可选）" />
              </div>
            </details>

            <details className="recruit-disclosure">
              <summary>手动输入简历正文（没有 PDF 时使用）</summary>
              <div className="recruit-disclosure__content">
                <textarea value={form.resume_text} onChange={(event) => setForm({ ...form, resume_text: event.target.value })} rows={8} placeholder="粘贴简历正文、项目经历和作品信息。" />
              </div>
            </details>

            <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="标签，逗号分隔" />
            <button type="submit" disabled={loading || jobs.length === 0} className="recruit-button recruit-button--primary">{loading ? '保存中…' : '保存候选人并触发 AI 初筛'}</button>
            {formError ? <p className="recruit-form-error">{formError}</p> : null}
          </form>
        </SectionCard>

        <SectionCard title="候选人列表" description="按决策信息浏览候选人，而不是被联系方式淹没。">
          <div className="recruit-list-toolbar">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、技能、公司或岗位" />
          </div>
          <div className="recruit-candidate-list">
            {visibleCandidates.map((candidate) => (
              <article key={candidate.candidate_id} className="recruit-candidate-row">
                <Link to={`/recruit/candidates/${candidate.candidate_id}`} className="recruit-candidate-row__main">
                  <div className="recruit-candidate-row__header">
                    <div>
                      <strong>{candidate.profile_summary?.full_name || candidate.full_name || '未命名候选人'}</strong>
                      <p>{candidate.profile_summary?.headline || candidate.current_company || candidate.location || '待补充候选人定位'}</p>
                    </div>
                    <ScoreBadge
                      score={candidate.latest_screening?.total_score}
                      maxScore={candidate.latest_screening?.max_score}
                    />
                  </div>

                  <dl className="recruit-candidate-row__facts">
                    <CandidateFact label="岗位" value={candidate.job_title} />
                    <CandidateFact label="教育" value={formatProfileRecord(candidate.profile_summary?.education[0])} />
                    <CandidateFact label="经历" value={formatProfileRecord(candidate.profile_summary?.experience[0])} />
                    <CandidateFact label="项目" value={formatProfileRecord(candidate.profile_summary?.projects[0], false)} />
                  </dl>

                  {candidate.profile_summary?.skills.length ? (
                    <div className="recruit-candidate-row__skills">
                      {candidate.profile_summary.skills.map((skill) => <span key={skill}>{skill}</span>)}
                    </div>
                  ) : null}

                  <p className="recruit-candidate-row__summary">
                    {candidate.profile_summary?.summary || candidate.summary || candidate.notes || '尚未补充候选人摘要，点击进入档案后可直接修正。'}
                  </p>
                </Link>
                <Link to={`/recruit/candidates/${candidate.candidate_id}?edit=profile`} className="recruit-candidate-row__edit">
                  编辑档案
                </Link>
              </article>
            ))}
            {!visibleCandidates.length ? <p className="recruit-empty-state">没有符合当前条件的候选人。</p> : null}
          </div>
        </SectionCard>
      </div>
    </RecruitPage>
  )
}

function CandidateFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '未识别'}</dd>
    </div>
  )
}

function formatProfileRecord(record?: { title: string; detail: string; years: string }, includeDetail = true) {
  if (!record) return ''
  return [record.title, includeDetail ? record.detail : '', record.years].filter(Boolean).join(' · ')
}
