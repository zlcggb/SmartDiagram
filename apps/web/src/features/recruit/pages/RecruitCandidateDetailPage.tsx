import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarPlus, FilePenLine, FileSearch, RefreshCw, UsersRound } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitPage, ScoreBadge } from '@/features/recruit/components/RecruitPrimitives'
import { RecruitScoreReport } from '@/features/recruit/components/RecruitScoreReport'
import type {
  CreateInterviewInput,
  RecruitCandidateSummary,
  RecruitResumeProfile,
  RecruitScreeningSummary,
  UpdateRecruitCandidateProfileInput,
} from '@/features/recruit/lib/types'
import { getInterviewOpportunity } from '@/features/recruit/lib/screening'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

const DEFAULT_INTERVIEW: CreateInterviewInput = {
  interview_type: 'onsite',
  stage: 'interview',
  interviewer: '',
  scheduled_at: '',
  decision: '',
  score: '',
  notes: '',
  summary: ''
}

const SCORE_BREAKDOWN_LABELS = {
  keyword_match: '关键词匹配',
  skills_coverage: '技能覆盖',
  section_completeness: '结构完整',
} as const

type CandidateProfileDraft = {
  full_name: string
  email: string
  phone: string
  current_company: string
  location: string
  headline: string
  summary: string
  education: string
  experience: string
  projects: string
  skills: string
  source_channel: string
  portfolio_url: string
  linkedin_url: string
  notes: string
  tags: string
  base_profile: RecruitResumeProfile
}

export function RecruitCandidateDetailPage() {
  const { candidateId = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    candidateDetail,
    candidates,
    error,
    loading,
    loadCandidateDetail,
    loadCandidates,
    updateCandidateProfile,
    moveCandidateStage,
    addInterview,
    rerunScreening,
  } = useRecruitStore(useShallow((state) => ({
    candidateDetail: state.candidateDetail,
    candidates: state.candidates,
    error: state.error,
    loading: state.loading,
    loadCandidateDetail: state.loadCandidateDetail,
    loadCandidates: state.loadCandidates,
    updateCandidateProfile: state.updateCandidateProfile,
    moveCandidateStage: state.moveCandidateStage,
    addInterview: state.addInterview,
    rerunScreening: state.rerunScreening,
  })))
  const [stagesByCandidate, setStagesByCandidate] = useState<Record<string, string>>({})
  const [resumeTextByCandidate, setResumeTextByCandidate] = useState<Record<string, string>>({})
  const [resumeFileByCandidate, setResumeFileByCandidate] = useState<Record<string, File | null>>({})
  const [interviewByCandidate, setInterviewByCandidate] = useState<Record<string, CreateInterviewInput>>({})
  const [profileSaveError, setProfileSaveError] = useState('')
  const profileScrollRef = useRef<HTMLDivElement>(null)
  const assessmentScrollRef = useRef<HTMLDivElement>(null)
  const candidate = candidateDetail?.candidate
  const profile = candidateDetail?.resumes[0]?.profile
  const profileEditorOpen = searchParams.get('edit') === 'profile'

  useEffect(() => {
    if (candidateId) void loadCandidateDetail(candidateId)
  }, [candidateId, loadCandidateDetail])

  useLayoutEffect(() => {
    if (profileScrollRef.current) profileScrollRef.current.scrollTop = 0
    if (assessmentScrollRef.current) assessmentScrollRef.current.scrollTop = 0
  }, [candidateId, profileEditorOpen])

  useEffect(() => {
    if (candidate?.job_id) void loadCandidates({ job_id: candidate.job_id })
  }, [candidate?.job_id, loadCandidates])

  const candidateOptions = useMemo(() => {
    if (!candidate) return []
    const sameJobCandidates = candidates.filter((item) => item.job_id === candidate.job_id)
    return sameJobCandidates.some((item) => item.candidate_id === candidate.candidate_id)
      ? sameJobCandidates
      : [candidate, ...sameJobCandidates]
  }, [candidate, candidates])

  const latestScreening = candidateDetail?.screenings[0]
  const interviewOpportunity = latestScreening ? getInterviewOpportunity(latestScreening) : null
  const selectedStage = candidate ? stagesByCandidate[candidateId] ?? candidate.current_stage : ''
  const selectedResumeText = resumeTextByCandidate[candidateId] ?? candidateDetail?.resumes[0]?.parsed_text ?? ''
  const selectedResumeFile = resumeFileByCandidate[candidateId] ?? null
  const interview = interviewByCandidate[candidateId] ?? DEFAULT_INTERVIEW

  async function handleStageUpdate() {
    if (!candidateDetail) return
    await moveCandidateStage(candidateId, selectedStage)
  }

  async function handleRerunScreening() {
    if (!candidateDetail) return
    await rerunScreening(candidateId, selectedResumeText, selectedResumeFile)
  }

  async function handleAddInterview() {
    await addInterview(candidateId, interview)
    setInterviewByCandidate((current) => ({ ...current, [candidateId]: DEFAULT_INTERVIEW }))
  }

  function setProfileEditorOpen(open: boolean) {
    const nextParams = new URLSearchParams(searchParams)
    if (open) nextParams.set('edit', 'profile')
    else nextParams.delete('edit')
    setSearchParams(nextParams, { replace: true })
  }

  async function handleProfileSave(draft: CandidateProfileDraft) {
    setProfileSaveError('')
    try {
      await updateCandidateProfile(candidateId, profileDraftToInput(draft))
      setProfileEditorOpen(false)
    } catch (saveError) {
      setProfileSaveError(saveError instanceof Error ? saveError.message : '保存候选人档案失败')
    }
  }

  function updateInterview(patch: Partial<CreateInterviewInput>) {
    setInterviewByCandidate((current) => ({
      ...current,
      [candidateId]: { ...(current[candidateId] ?? DEFAULT_INTERVIEW), ...patch },
    }))
  }

  return (
    <RecruitPage
      className="recruit-page--candidate-detail"
      compact
      hideHeader
      title={candidateDetail?.job?.title || '候选人工作台'}
      description="切换候选人后，画像与 AI 评估会在各自面板中独立滚动。"
    >
      <div className="recruit-candidate-detail">
        <ErrorBanner message={error} />
        {candidateDetail && candidate ? (
          <>
            <CandidateSwitcher
              candidates={candidateOptions}
              currentCandidateId={candidateId}
              currentCandidateName={profile?.full_name || candidate.full_name}
              onSelect={(id) => navigate(`/recruit/candidates/${id}`)}
            />

            <div className="recruit-candidate-workbench">
              <section className="recruit-native-pane recruit-candidate-pane recruit-candidate-pane--profile">
                <header className="recruit-candidate-pane__header">
                  <div>
                    <p className="recruit-pane-eyebrow">候选人资料</p>
                    <h3>画像</h3>
                    <p>{candidateDetail.job?.title || '未关联岗位'}</p>
                  </div>
                  <div className="recruit-pane-header-actions">
                    <button type="button" className="recruit-button recruit-button--quiet" onClick={() => setProfileEditorOpen(true)}>
                      <FilePenLine size={14} />
                      编辑档案
                    </button>
                    <ScoreBadge score={latestScreening?.total_score} maxScore={latestScreening?.max_score} />
                  </div>
                </header>

                <div ref={profileScrollRef} className="recruit-candidate-pane__scroll">
                  {profileEditorOpen ? (
                    <CandidateProfileEditor
                      key={`${candidate.candidate_id}-${candidateDetail.resumes[0]?.resume_id ?? 'manual'}`}
                      candidate={candidate}
                      profile={profile}
                      saving={loading}
                      error={profileSaveError}
                      onCancel={() => setProfileEditorOpen(false)}
                      onSave={(draft) => void handleProfileSave(draft)}
                    />
                  ) : null}

                  <div className="recruit-candidate-identity">
                    <span className="recruit-candidate-identity__avatar" aria-hidden="true">
                      {(profile?.full_name || candidate.full_name || '候').trim().slice(0, 1)}
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4>{profile?.full_name || candidate.full_name || '候选人'}</h4>
                        {profile?.headline ? <span className="recruit-chip">{profile.headline}</span> : null}
                      </div>
                      {profile?.summary ? <p>{profile.summary}</p> : null}
                    </div>
                  </div>

                  <div className="recruit-stage-control">
                    <label>
                      <span>招聘阶段</span>
                      <select
                        value={selectedStage}
                        onChange={(event) => setStagesByCandidate((current) => ({ ...current, [candidateId]: event.target.value }))}
                      >
                        {candidateDetail.job?.stage_config.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                      </select>
                    </label>
                    <button type="button" className="recruit-button recruit-button--primary" onClick={() => void handleStageUpdate()}>
                      更新阶段
                    </button>
                  </div>

                  <ProfileSection title="教育背景">
                    {profile?.education?.length ? profile.education.map((item) => (
                      <div key={`${item.institution}-${item.years}`} className="recruit-profile-record">
                        <div>
                          <strong>{item.institution || '学校未识别'}</strong>
                          <span>{item.years}</span>
                        </div>
                        <p>{[item.degree, item.major].filter(Boolean).join(' · ') || '专业信息未识别'}</p>
                      </div>
                    )) : <EmptyProfileState>简历未提取到教育背景。</EmptyProfileState>}
                  </ProfileSection>

                  <ProfileSection title="工作 / 实习经历">
                    {profile?.experience?.length ? profile.experience.map((item, index) => (
                      <div key={`${item.company}-${item.years}-${index}`} className="recruit-profile-record">
                        <div>
                          <strong>{item.company || '经历主体未识别'}</strong>
                          <span>{item.years}</span>
                        </div>
                        <p>{item.evidence}</p>
                      </div>
                    )) : <EmptyProfileState>简历未提取到工作或实习经历。</EmptyProfileState>}
                  </ProfileSection>

                  <ProfileSection title="项目与成果">
                    {profile?.projects?.length ? profile.projects.map((item, index) => (
                      <div key={`${item.name}-${item.years}-${index}`} className="recruit-profile-record">
                        <div>
                          <strong>{item.name || '项目名称未识别'}</strong>
                          <span>{item.years}</span>
                        </div>
                        <p>{item.evidence}</p>
                      </div>
                    )) : <EmptyProfileState>简历未提取到项目成果。</EmptyProfileState>}
                  </ProfileSection>

                  <ProfileSection title="技能">
                    {profile?.skills?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {profile.skills.map((skill) => <span key={skill} className="recruit-chip">{skill}</span>)}
                      </div>
                    ) : <EmptyProfileState>简历未提取到技能关键词。</EmptyProfileState>}
                  </ProfileSection>

                  <details className="recruit-disclosure">
                    <summary><FileSearch size={16} /> 联系信息与来源</summary>
                    <div className="recruit-disclosure__content grid gap-2 text-xs sm:grid-cols-2">
                      <p>邮箱：{candidate.email || '未填写'}</p>
                      <p>电话：{candidate.phone || '未填写'}</p>
                      <p>所在地：{profile?.location || candidate.location || '未填写'}</p>
                      <p>来源：{candidate.source_channel || '未填写'}</p>
                    </div>
                  </details>

                  <details className="recruit-disclosure">
                    <summary><RefreshCw size={16} /> 上传新版简历并重新评分</summary>
                    <div className="recruit-disclosure__content">
                      <p className="mb-3 text-xs text-slate-400">用于补充简历文本或替换 PDF；新结果会保留为一条独立初筛记录。</p>
                      <textarea
                        value={selectedResumeText}
                        onChange={(event) => setResumeTextByCandidate((current) => ({ ...current, [candidateId]: event.target.value }))}
                        rows={7}
                      />
                      <input
                        type="file"
                        accept=".pdf,.docx,.txt,.md"
                        onChange={(event) => setResumeFileByCandidate((current) => ({ ...current, [candidateId]: event.target.files?.[0] ?? null }))}
                      />
                      <button type="button" className="recruit-button recruit-button--primary mt-3" onClick={() => void handleRerunScreening()}>
                        <RefreshCw size={16} />
                        重新生成 AI 评分
                      </button>
                    </div>
                  </details>
                </div>
              </section>

              <section className="recruit-native-pane recruit-candidate-pane recruit-candidate-pane--assessment">
                <header className="recruit-candidate-pane__header">
                  <div>
                    <p className="recruit-pane-eyebrow">候选人评估</p>
                    <h3>评分与面试</h3>
                    <p>证据、缺口与下一轮验证重点。</p>
                  </div>
                  <span className="recruit-pane-status">{formatRanking(candidate.ranking)}</span>
                </header>

                <div ref={assessmentScrollRef} className="recruit-candidate-pane__scroll">
                  {interviewOpportunity ? (
                    <section className={`recruit-decision-card recruit-decision-card--${interviewOpportunity.level}`}>
                      <div>
                        <p>当前建议</p>
                        <h4>{interviewOpportunity.label}</h4>
                        <span>{interviewOpportunity.detail}</span>
                      </div>
                      <div className="recruit-decision-card__actions">
                        <ScoreBadge score={latestScreening?.total_score} maxScore={latestScreening?.max_score} />
                        {interviewOpportunity.shouldInterview ? (
                          <button type="button" className="recruit-button recruit-button--primary" onClick={() => void moveCandidateStage(candidateId, 'interview')}>
                            <CalendarPlus size={16} />
                            进入面试
                          </button>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  <section className="recruit-assessment-section">
                    <div className="recruit-assessment-section__heading">
                      <div>
                        <p className="recruit-pane-eyebrow">历史初筛</p>
                        <h4>AI 初筛结果</h4>
                      </div>
                      <span>{candidateDetail.screenings.length} 条记录</span>
                    </div>
                    <div className="space-y-3">
                      {candidateDetail.screenings.map((screening, index) => (
                        <ScreeningRecord key={screening.screening_id} screening={screening} open={index === 0} />
                      ))}
                    </div>
                  </section>

                  <details className="recruit-disclosure recruit-disclosure--assessment">
                    <summary><FilePenLine size={16} /> 面试问题与活动</summary>
                    <div className="recruit-disclosure__content space-y-4">
                      {candidateDetail.question_sets.map((item) => (
                        <div key={item.question_set_id} className="recruit-question-set">
                          <strong>{item.title}</strong>
                          <ul>{item.questions.map((question) => <li key={question}>{question}</li>)}</ul>
                        </div>
                      ))}
                      {candidateDetail.activities.map((item) => (
                        <div key={item.activity_id} className="recruit-activity-item">
                          <p>{item.message}</p>
                          <span>{item.created_at}</span>
                        </div>
                      ))}
                    </div>
                  </details>

                  <details className="recruit-disclosure recruit-disclosure--assessment">
                    <summary><CalendarPlus size={16} /> 记录一轮面试</summary>
                    <div className="recruit-disclosure__content">
                      <div className="grid gap-3 md:grid-cols-2">
                        <input value={interview.interviewer} onChange={(event) => updateInterview({ interviewer: event.target.value })} placeholder="面试官" />
                        <input value={interview.scheduled_at} onChange={(event) => updateInterview({ scheduled_at: event.target.value })} placeholder="2026-09-20T10:00:00" />
                        <input value={interview.decision} onChange={(event) => updateInterview({ decision: event.target.value })} placeholder="结论" />
                        <input value={interview.score} onChange={(event) => updateInterview({ score: event.target.value })} placeholder="面试分数" />
                      </div>
                      <textarea value={interview.notes} onChange={(event) => updateInterview({ notes: event.target.value })} rows={4} placeholder="记录亮点、风险与业务理解。" />
                      <button type="button" className="recruit-button recruit-button--primary mt-3" onClick={() => void handleAddInterview()}>
                        <CalendarPlus size={16} />
                        保存面试记录
                      </button>
                    </div>
                  </details>
                </div>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </RecruitPage>
  )
}

function CandidateSwitcher({
  candidates,
  currentCandidateId,
  currentCandidateName,
  onSelect,
}: {
  candidates: RecruitCandidateSummary[]
  currentCandidateId: string
  currentCandidateName: string
  onSelect: (candidateId: string) => void
}) {
  return (
    <nav className="recruit-candidate-switcher" aria-label="候选人切换">
      <div className="recruit-candidate-switcher__context">
        <span><UsersRound size={15} /> 候选人</span>
        <strong>{candidates.length} 位候选人</strong>
      </div>
      <div className="recruit-candidate-switcher__list">
        {candidates.map((item) => {
          const isActive = item.candidate_id === currentCandidateId
          const displayName = isActive
            ? currentCandidateName || item.profile_summary?.full_name || item.full_name
            : item.profile_summary?.full_name || item.full_name
          return (
            <button
              key={item.candidate_id}
              type="button"
              className={`recruit-candidate-switcher__item${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(item.candidate_id)}
            >
              <span className="recruit-candidate-switcher__copy">
                <strong>{displayName || '未命名候选人'}</strong>
                <span>{item.current_company || item.source_channel || '候选人档案'}</span>
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function ScreeningRecord({ screening, open }: { screening: RecruitScreeningSummary; open: boolean }) {
  return (
    <details className="recruit-screening-record" open={open}>
      <summary>
        <span>
          <strong>{screening.recommendation}</strong>
          <em>{screening.created_at}</em>
        </span>
        <ScoreBadge score={screening.total_score} maxScore={screening.max_score} />
      </summary>
      <div className="recruit-screening-record__content">
        <p className="recruit-screening-record__summary">{screening.overall_summary}</p>
        {screening.score_report ? (
          <RecruitScoreReport
            report={screening.score_report}
            totalScore={screening.total_score}
            maxScore={screening.max_score}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {screening.dimension_scores.map((item) => (
              <div key={`${screening.screening_id}-${item.key}`} className="recruit-score-fallback">
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.score} / {item.max_score} 分</span>
                </div>
                <p>{item.reason}</p>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {Object.entries(SCORE_BREAKDOWN_LABELS).map(([key, label]) => {
            const value = screening.score_breakdown[key as keyof typeof screening.score_breakdown] || 0
            return (
              <div key={key} className="recruit-ats-metric p-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                  <span>{label}</span>
                  <strong>{Math.round(value)}%</strong>
                </div>
                <div className="recruit-ats-metric__bar">
                  <span style={{ width: `${value}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </details>
  )
}

function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="recruit-profile-section">
      <h4>{title}</h4>
      <div>{children}</div>
    </section>
  )
}

function EmptyProfileState({ children }: { children: ReactNode }) {
  return <p className="recruit-empty-profile">{children}</p>
}

function formatRanking(ranking: string) {
  const labels: Record<string, string> = {
    strong: '强匹配',
    medium: '可复核',
    watch: '待复核',
    low: '暂缓',
  }
  return labels[ranking] || ranking || '未评级'
}

function CandidateProfileEditor({
  candidate,
  profile,
  saving,
  error,
  onCancel,
  onSave,
}: {
  candidate: RecruitCandidateSummary
  profile?: RecruitResumeProfile
  saving: boolean
  error: string
  onCancel: () => void
  onSave: (draft: CandidateProfileDraft) => void
}) {
  const [draft, setDraft] = useState(() => createCandidateProfileDraft(candidate, profile))

  function update(field: Exclude<keyof CandidateProfileDraft, 'base_profile'>, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  return (
    <section className="recruit-profile-editor" aria-label="编辑候选人档案">
      <div className="recruit-profile-editor__header">
        <div>
          <p className="recruit-pane-eyebrow">人工校正</p>
          <h4>编辑候选人档案</h4>
          <p>修正 PDF 识别结果后会真实保存；AI 初筛仍以原始简历证据为准。</p>
        </div>
        <button type="button" className="recruit-button recruit-button--quiet" onClick={onCancel}>关闭</button>
      </div>

      <div className="recruit-profile-editor__grid">
        <ProfileEditorField label="姓名" value={draft.full_name} onChange={(value) => update('full_name', value)} />
        <ProfileEditorField label="所在城市" value={draft.location} onChange={(value) => update('location', value)} />
        <ProfileEditorField label="当前公司 / 学校" value={draft.current_company} onChange={(value) => update('current_company', value)} />
        <ProfileEditorField label="人才来源" value={draft.source_channel} onChange={(value) => update('source_channel', value)} />
        <ProfileEditorField label="邮箱" value={draft.email} onChange={(value) => update('email', value)} />
        <ProfileEditorField label="电话" value={draft.phone} onChange={(value) => update('phone', value)} />
      </div>

      <ProfileEditorField
        label="候选人定位"
        value={draft.headline}
        onChange={(value) => update('headline', value)}
        placeholder="例如：AI 应用产品工程师 / 机器学习工程师"
      />
      <ProfileEditorField
        label="招聘摘要"
        value={draft.summary}
        onChange={(value) => update('summary', value)}
        placeholder="只写招聘判断需要的信息：方向、强项、交付成果与风险。"
        multiline
      />

      <ProfileEditorField
        label="教育背景"
        value={draft.education}
        onChange={(value) => update('education', value)}
        placeholder="每行一条：学校 | 学位 | 专业 | 时间"
        helper="每行一条，字段用 | 分隔。"
        multiline
      />
      <ProfileEditorField
        label="工作 / 实习经历"
        value={draft.experience}
        onChange={(value) => update('experience', value)}
        placeholder="每行一条：公司 | 职位 | 时间 | 关键职责或结果"
        helper="简历未写的内容不要补造；可写待面试验证。"
        multiline
      />
      <ProfileEditorField
        label="项目与成果"
        value={draft.projects}
        onChange={(value) => update('projects', value)}
        placeholder="每行一条：项目 | 角色 | 时间 | 结果或证据"
        multiline
      />
      <ProfileEditorField
        label="核心技能"
        value={draft.skills}
        onChange={(value) => update('skills', value)}
        placeholder="例如：Python，React，RAG，Docker"
        helper="用逗号分隔，列表与档案会同步展示。"
      />

      <div className="recruit-profile-editor__grid">
        <ProfileEditorField label="作品链接" value={draft.portfolio_url} onChange={(value) => update('portfolio_url', value)} />
        <ProfileEditorField label="LinkedIn" value={draft.linkedin_url} onChange={(value) => update('linkedin_url', value)} />
      </div>
      <ProfileEditorField label="标签" value={draft.tags} onChange={(value) => update('tags', value)} placeholder="例如：AI，前端，候选人池" />
      <ProfileEditorField
        label="招聘备注"
        value={draft.notes}
        onChange={(value) => update('notes', value)}
        placeholder="内部记录，不参与 AI 评分。"
        multiline
      />

      {error ? <p className="recruit-profile-editor__error">{error}</p> : null}
      <div className="recruit-profile-editor__actions">
        <button type="button" className="recruit-button recruit-button--quiet" onClick={onCancel}>取消</button>
        <button type="button" className="recruit-button recruit-button--primary" disabled={saving} onClick={() => onSave(draft)}>
          {saving ? '保存中…' : '保存候选人档案'}
        </button>
      </div>
    </section>
  )
}

function ProfileEditorField({
  label,
  value,
  onChange,
  placeholder,
  helper,
  multiline = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  helper?: string
  multiline?: boolean
}) {
  return (
    <label className={`recruit-profile-editor__field${multiline ? ' is-multiline' : ''}`}>
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} rows={4} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
      {helper ? <small>{helper}</small> : null}
    </label>
  )
}

function createCandidateProfileDraft(
  candidate: RecruitCandidateSummary,
  profile?: RecruitResumeProfile,
): CandidateProfileDraft {
  const baseProfile: RecruitResumeProfile = {
    full_name: profile?.full_name || candidate.full_name,
    email: profile?.email || candidate.email,
    phone: profile?.phone || candidate.phone,
    current_company: profile?.current_company || candidate.current_company,
    location: profile?.location || candidate.location,
    headline: profile?.headline || '',
    summary: profile?.summary || candidate.summary,
    education: profile?.education ?? [],
    experience: profile?.experience ?? [],
    projects: profile?.projects ?? [],
    competitions: profile?.competitions ?? [],
    skills: profile?.skills ?? [],
    certifications: profile?.certifications ?? [],
    section_presence: profile?.section_presence ?? {},
    section_evidence: profile?.section_evidence ?? {},
  }
  return {
    full_name: baseProfile.full_name,
    email: baseProfile.email,
    phone: baseProfile.phone,
    current_company: baseProfile.current_company,
    location: baseProfile.location,
    headline: baseProfile.headline || '',
    summary: baseProfile.summary || '',
    education: baseProfile.education.map((item) => profileDraftLine([item.institution, item.degree, item.major, item.years, item.evidence])).join('\n'),
    experience: baseProfile.experience.map((item) => profileDraftLine([item.company, item.title, item.years, item.evidence])).join('\n'),
    projects: baseProfile.projects.map(projectDraftLine).join('\n'),
    skills: baseProfile.skills.join('，'),
    source_channel: candidate.source_channel,
    portfolio_url: candidate.portfolio_url,
    linkedin_url: candidate.linkedin_url,
    notes: candidate.notes,
    tags: candidate.tags.join('，'),
    base_profile: baseProfile,
  }
}

function profileDraftToInput(draft: CandidateProfileDraft): UpdateRecruitCandidateProfileInput {
  return {
    full_name: draft.full_name.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    current_company: draft.current_company.trim(),
    location: draft.location.trim(),
    source_channel: draft.source_channel.trim(),
    portfolio_url: draft.portfolio_url.trim(),
    linkedin_url: draft.linkedin_url.trim(),
    summary: draft.summary.trim(),
    notes: draft.notes.trim(),
    tags: splitEditableTokens(draft.tags),
    profile: {
      ...draft.base_profile,
      full_name: draft.full_name.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      current_company: draft.current_company.trim(),
      location: draft.location.trim(),
      headline: draft.headline.trim(),
      summary: draft.summary.trim(),
      education: parseEducationRecords(draft.education),
      experience: parseExperienceRecords(draft.experience),
      projects: parseProjectRecords(draft.projects),
      skills: splitEditableTokens(draft.skills),
    },
  }
}

function splitEditableTokens(value: string) {
  return [...new Set(value.split(/[,\n，]/).map((item) => item.trim()).filter(Boolean))]
}

function profileDraftLine(values: string[]) {
  return values.map((value) => value || '').join(' | ')
}

function projectDraftLine(project: RecruitResumeProfile['projects'][number]) {
  const roleLooksLikeDate = /\d{4}[./-]\d{1,2}/.test(project.role)
  if (roleLooksLikeDate && project.years.startsWith(project.role)) {
    const evidence = project.evidence || project.years.slice(project.role.length).trim()
    return profileDraftLine([project.name, '', project.role, evidence])
  }
  return profileDraftLine([project.name, project.role, project.years, project.evidence])
}

function splitProfileLine(value: string, expectedLength: number) {
  const cells = value.split('|').map((item) => item.trim())
  return Array.from({ length: expectedLength }, (_, index) => cells[index] || '')
}

function parseEducationRecords(value: string): RecruitResumeProfile['education'] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [institution, degree, major, years, evidence] = splitProfileLine(line, 5)
    return { institution, degree, major, years, evidence, source_locator: '人工修订' }
  })
}

function parseExperienceRecords(value: string): RecruitResumeProfile['experience'] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [company, title, years, evidence] = splitProfileLine(line, 4)
    return { company, title, years, evidence, source_locator: '人工修订' }
  })
}

function parseProjectRecords(value: string): RecruitResumeProfile['projects'] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, role, years, evidence] = splitProfileLine(line, 4)
    return { name, role, years, evidence, source_locator: '人工修订' }
  })
}
