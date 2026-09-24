import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { BrainCircuit, CalendarClock, FileUp, Sparkles } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { ErrorBanner, RecruitPage, ScoreBadge, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { RecruitScoreReport } from '@/features/recruit/components/RecruitScoreReport'
import { persistRecruitScreening, previewRecruitResume, screenRecruitCandidate } from '@/features/recruit/lib/api'
import { getInterviewOpportunity } from '@/features/recruit/lib/screening'
import type { RecruitScreeningPreview } from '@/features/recruit/lib/types'

const DEFAULT_JD_TITLE = 'AI 应用产品工程师（业务系统方向）'
const DEFAULT_JD_TEXT = `我们希望招聘一位偏应用落地的 AI 人才，能够理解销售、客服、运营或生产等业务流程，快速完成需求澄清、原型设计和 demo 交付。

核心要求：
1. 熟悉前端或全栈开发，能独立做出可演示的业务系统页面
2. 会用 AI 编程工具、Prompt、Agent、RAG 或自动化工作流
3. 理解 CRM、销售支持、客服、运营、生产管理等业务系统
4. 能把需求拆解为 MVP，有业务思维和 demo 验证意识
5. 有个人网站、Github、Side Project 或自主创建经历加分

优先关注：
- 做过企业内部系统、运营后台、销售前台或生产协同系统
- 独立负责过从需求到上线的完整交付
- 能把 AI 与真实业务流程结合，而不只是做聊天机器人`

const OPPORTUNITY_STYLES = {
  high: 'recruit-screening-opportunity--high',
  review: 'recruit-screening-opportunity--review',
  pool: 'recruit-screening-opportunity--pool',
  low: 'recruit-screening-opportunity--low',
} as const

export function RecruitScreeningPage() {
  const navigate = useNavigate()
  const motionScopeRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const scoreValueRef = useRef<HTMLElement>(null)
  const [jdTitle, setJdTitle] = useState(DEFAULT_JD_TITLE)
  const [jdText, setJdText] = useState(DEFAULT_JD_TEXT)
  const [candidateName, setCandidateName] = useState('')
  const [candidateEmail, setCandidateEmail] = useState('')
  const [channel, setChannel] = useState('主动投递')
  const [resumeText, setResumeText] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [screening, setScreening] = useState<RecruitScreeningPreview | null>(null)
  const [screeningError, setScreeningError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const opportunity = useMemo(
    () => screening ? getInterviewOpportunity(screening) : null,
    [screening],
  )

  useLayoutEffect(() => {
    if (!motionScopeRef.current) return
    const context = gsap.context(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const revealItems = gsap.utils.toArray<HTMLElement>('[data-recruit-reveal]')
      gsap.fromTo(
        revealItems,
        { autoAlpha: 0, y: 18 },
        { autoAlpha: 1, y: 0, duration: 0.65, stagger: 0.07, ease: 'power3.out' },
      )
    }, motionScopeRef)
    return () => context.revert()
  }, [])

  useEffect(() => {
    if (!screening || !resultRef.current) return
    const scoreTarget = scoreValueRef.current
    const barElements = gsap.utils.toArray<HTMLElement>('[data-score-bar]', resultRef.current)
    const context = gsap.context(() => {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reducedMotion) {
        if (scoreTarget) scoreTarget.textContent = String(screening.total_score)
        barElements.forEach((element) => {
          element.style.width = element.dataset.scoreWidth || '0%'
        })
        return
      }

      const scoreProxy = { value: 0 }
      gsap.to(scoreProxy, {
        value: screening.total_score,
        duration: 0.9,
        ease: 'power3.out',
        onUpdate: () => {
          if (scoreTarget) scoreTarget.textContent = String(Math.round(scoreProxy.value))
        },
      })
      gsap.fromTo(
        barElements,
        { width: '0%' },
        {
          width: (index) => barElements[index]?.dataset.scoreWidth || '0%',
          duration: 0.8,
          stagger: 0.08,
          ease: 'power2.out',
        },
      )
      gsap.fromTo(
        resultRef.current,
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out' },
      )
    }, resultRef)
    return () => context.revert()
  }, [screening])

  function markDirty() {
    setIsDirty(true)
  }

  async function handleScreeningSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setScreeningError('')

    if (!jdTitle.trim() || !jdText.trim()) {
      setScreeningError('请先填写岗位名称和 JD 内容。')
      return
    }
    if (!resumeText.trim() && !selectedFile) {
      setScreeningError('请粘贴简历文本或上传 PDF 简历。')
      return
    }

    setSubmitting(true)
    try {
      const result = await screenRecruitCandidate({
        candidateName: candidateName.trim() || '候选人',
        channel: channel.trim(),
        jdText: jdText.trim(),
        resumeText: resumeText.trim(),
        file: selectedFile,
      })
      setScreening(result)
      setIsDirty(false)
    } catch (error) {
      setScreeningError(error instanceof Error ? error.message : '简历筛选失败')
    } finally {
      setSubmitting(false)
    }
  }

  function handleResumeFile(file: File | null) {
    setSelectedFile(file)
    markDirty()
    setScreeningError('')
    if (!file) return

    setPreviewLoading(true)
    void previewRecruitResume(file)
      .then((preview) => {
        setCandidateName((current) => current.trim() || preview.profile.full_name)
        setCandidateEmail((current) => current.trim() || preview.profile.email)
        setResumeText((current) => current.trim() || preview.parsed_text)
      })
      .catch((error) => {
        setScreeningError(error instanceof Error ? error.message : '简历解析失败，可继续手动填写')
      })
      .finally(() => setPreviewLoading(false))
  }

  async function handleSaveToAts() {
    if (!screening || !opportunity) return
    if (isDirty) {
      setScreeningError('岗位或简历信息已修改，请重新评分后再保存。')
      return
    }

    setSaving(true)
    setScreeningError('')
    try {
      const priority = opportunity.level === 'high' ? 'high' : opportunity.level === 'review' ? 'medium' : 'low'
      const result = await persistRecruitScreening({
        jdTitle: jdTitle.trim(),
        jdText: jdText.trim(),
        candidateName: screening.candidate_name || candidateName.trim(),
        candidateEmail: candidateEmail.trim(),
        channel: channel.trim() || '主动投递',
        resumeText: resumeText.trim(),
        file: selectedFile,
        priority,
      })
      navigate(`/recruit/candidates/${result.candidate.candidate_id}`)
    } catch (error) {
      setScreeningError(error instanceof Error ? error.message : '保存到人才库失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={motionScopeRef} className="contents">
      <RecruitPage
        title="AI 找人才"
        description="先确定岗位，再上传一份 PDF 简历；系统会输出可核查的评分与面试建议。"
        actions={<Link className="recruit-button" to="/recruit/candidates">查看人才库</Link>}
      >
      <ErrorBanner message={screeningError} />

      <div className="recruit-screening-grid">
        <form onSubmit={handleScreeningSubmit} className="recruit-screening-form">
          <SectionCard title="2. 岗位与 JD（可选调整）" description="默认 AI 岗位已可直接使用；需要时再改成你自己的岗位和业务场景。">
            <div className="recruit-form">
              <label className="recruit-field">
                <span>岗位名称</span>
                <input
                  value={jdTitle}
                  onChange={(event) => { setJdTitle(event.target.value); markDirty() }}
                  placeholder="例如：AI 应用产品工程师"
                />
              </label>
              <label className="recruit-field">
                <span>JD 内容</span>
                <textarea
                  value={jdText}
                  onChange={(event) => { setJdText(event.target.value); markDirty() }}
                  rows={15}
                  placeholder="职责、硬性要求、加分项、业务场景和交付目标"
                />
              </label>
              <div className="recruit-insight-note">
                <div>
                  <Sparkles size={16} />
                  评分会重点验证
                </div>
                <p>
                  AI 应用实践、前端 / 全栈交付、业务系统经验、需求理解、作品自驱和沟通协作。
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="1. 上传简历 PDF" description="上传后自动识别候选人；选择默认岗位即可直接评分。">
            <div className="recruit-form">
              <div className="recruit-field-grid">
                <label className="recruit-field">
                  <span>候选人姓名（PDF 可自动识别）</span>
                  <input
                    value={candidateName}
                    onChange={(event) => { setCandidateName(event.target.value); markDirty() }}
                    placeholder="例如：张三"
                  />
                </label>
                <label className="recruit-field">
                  <span>候选人邮箱（可选）</span>
                  <input
                    type="email"
                    value={candidateEmail}
                    onChange={(event) => setCandidateEmail(event.target.value)}
                    placeholder="用于人才库去重和联系"
                  />
                </label>
              </div>
              <label className="recruit-field">
                <span>来源渠道</span>
                <input
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                  placeholder="主动投递 / 猎头 / 内推"
                />
              </label>
              <label className="recruit-upload-zone">
                <span className="recruit-upload-zone__head">
                  <span>
                    <strong><FileUp size={17} />选择 PDF 简历</strong>
                    <span>优先使用原始 PDF，识别信息后即可直接开始评分。</span>
                  </span>
                  {previewLoading ? <span className="recruit-upload-zone__status">正在识别简历…</span> : null}
                </span>
                <input
                  type="file"
                  accept=".pdf,application/pdf,.docx,.txt,.md"
                  onChange={(event) => handleResumeFile(event.target.files?.[0] ?? null)}
                />
                <span className="recruit-upload-zone__caption">
                  {selectedFile ? `已选择：${selectedFile.name}，识别到姓名后可直接评分` : '上传 PDF 后会自动识别姓名和简历正文；邮箱、电话只用于联系。'}
                </span>
              </label>
              <label className="recruit-field">
                <span>简历正文（可选）</span>
                <textarea
                  value={resumeText}
                  onChange={(event) => { setResumeText(event.target.value); markDirty() }}
                  rows={7}
                  placeholder="如果 PDF 是扫描件，建议在这里粘贴 OCR 文本、项目经历或作品链接。"
                />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="recruit-button recruit-button--primary recruit-button--wide"
              >
                <BrainCircuit size={17} />
                {submitting ? 'AI 评分中…' : '开始评分并判断面试机会'}
              </button>
            </div>
          </SectionCard>
        </form>

        <div className="recruit-screening-result">
          <SectionCard title="3. 评分与面试判断" description="结果只作为招聘辅助，最终决定由招聘负责人确认。">
            <div ref={resultRef}>
            {!screening || !opportunity ? (
              <div className="recruit-screening-empty">
                <p><CalendarClock size={17} />完成一次评分后，这里会显示：</p>
                <ul>
                  <li>• 总分和六个维度的匹配证据</li>
                  <li>• 是否值得安排面试，以及面试优先级</li>
                  <li>• 本候选人最应该追问的面试问题</li>
                </ul>
              </div>
            ) : (
              <div className="recruit-screening-report">
                <div className="recruit-screening-decision">
                  <div className="recruit-screening-score">
                    <p>AI 匹配分</p>
                    <div>
                      <strong ref={scoreValueRef}>0</strong>
                      <span>/ {screening.max_score} 分</span>
                    </div>
                    <ScoreBadge score={screening.total_score} maxScore={screening.max_score} />
                    <small>{screening.evaluation_mode === 'ai' ? 'AI 结构化评分' : '规则兜底评分'}</small>
                  </div>
                  <div className={`recruit-screening-opportunity ${OPPORTUNITY_STYLES[opportunity.level]}`}>
                    <p>面试机会</p>
                    <strong>{opportunity.label}</strong>
                    <span>{opportunity.detail}</span>
                  </div>
                </div>

                <p className="recruit-screening-summary">{screening.overall_summary}</p>

                <RecruitScoreReport
                  report={screening.score_report}
                  totalScore={screening.total_score}
                  maxScore={screening.max_score}
                />

                <div className="recruit-screening-dimensions">
                  {screening.dimension_scores.map((item) => {
                    const percent = item.max_score ? Math.round((item.score / item.max_score) * 100) : 0
                    return (
                      <div key={item.key}>
                        <div className="recruit-screening-dimensions__head">
                          <span>{item.label}</span>
                          <strong>{item.score} / {item.max_score}</strong>
                        </div>
                        <div className="recruit-progress">
                          <div data-score-bar data-score-width={`${percent}%`} style={{ width: '0%' }} />
                        </div>
                        <p>{item.reason}</p>
                      </div>
                    )
                  })}
                </div>

                <div className="recruit-ats-metrics">
                  {Object.entries({
                    keyword_match: '关键词匹配',
                    skills_coverage: '技能覆盖',
                    section_completeness: '结构完整',
                  }).map(([key, label]) => {
                    const value = screening.score_breakdown[key as keyof typeof screening.score_breakdown] || 0
                    return (
                      <div key={key} className="recruit-ats-metric">
                        <div>
                          <span>{label}</span>
                          <strong>{Math.round(value)}%</strong>
                        </div>
                        <div className="recruit-ats-metric__bar">
                          <span data-score-bar data-score-width={`${value}%`} style={{ width: '0%' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="recruit-keywords">
                  <div>
                    <p>命中关键词</p>
                    <div>
                      {screening.matched_keywords.length > 0
                        ? screening.matched_keywords.map((keyword) => <span key={keyword} className="recruit-chip">{keyword}</span>)
                        : <span className="recruit-muted">暂无直接命中关键词</span>}
                    </div>
                  </div>
                  <div>
                    <p>缺失关键词</p>
                    <div>
                      {screening.missing_keywords.length > 0
                        ? screening.missing_keywords.slice(0, 10).map((keyword) => <span key={keyword} className="recruit-chip recruit-chip--missing">{keyword}</span>)
                        : <span className="recruit-muted">没有明显缺失关键词</span>}
                    </div>
                  </div>
                </div>

                <div className="recruit-screening-note">
                  <p>评分建议</p>
                  <ul>
                    {screening.recommendations.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>

                <div className="recruit-screening-signals">
                  <div className="recruit-screening-signal recruit-screening-signal--positive">
                    <p>匹配亮点</p>
                    <ul>
                      {screening.strengths.map((item) => <li key={item}>• {item}</li>)}
                    </ul>
                  </div>
                  <div className="recruit-screening-signal recruit-screening-signal--warning">
                    <p>需要验证</p>
                    <ul>
                      {screening.risks.map((item) => <li key={item}>• {item}</li>)}
                    </ul>
                  </div>
                </div>

                <div className="recruit-interview-focus">
                  <p>面试应该问什么</p>
                  <ul>
                    {screening.interview_questions.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>

                <div className="recruit-evidence-excerpt">
                  <p>简历证据</p>
                  <div>{screening.evidence_excerpt || '未提取到可引用的简历片段。'}</div>
                </div>

                <div className="recruit-screening-save">
                  <div>
                    <strong>下一步：进入正式 ATS</strong>
                    <p>
                      保存岗位和候选人后，可在候选人详情中推进阶段、查看问题集并记录面试。
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={saving || isDirty}
                    onClick={() => void handleSaveToAts()}
                    className="recruit-button recruit-button--primary"
                  >
                    {saving ? '保存中…' : opportunity.actionLabel}
                  </button>
                </div>
                {isDirty ? <p className="recruit-inline-note">表单已修改，请重新评分后再保存结果。</p> : null}
              </div>
            )}
            </div>
          </SectionCard>
        </div>
      </div>
      </RecruitPage>
    </div>
  )
}
