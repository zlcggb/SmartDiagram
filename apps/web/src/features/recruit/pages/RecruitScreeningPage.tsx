import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { BrainCircuit, FileUp, FileSearch, ListChecks, RefreshCw, ScanText, Sparkles, Target } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { ErrorBanner, RecruitPage, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { RecruitScoreReport } from '@/features/recruit/components/RecruitScoreReport'
import { AiLoader, ScoreRing } from '@/features/recruit/components/RecruitUI'
import { fetchRecruitRubric, persistRecruitScreening, previewRecruitResume, screenRecruitCandidate } from '@/features/recruit/lib/api'
import { prefersReducedMotion } from '@/features/recruit/lib/motion'
import { getInterviewOpportunity } from '@/features/recruit/lib/screening'
import { RecruitTalentSearchPage } from '@/features/recruit/pages/RecruitTalentSearchPage'
import type {
  RecruitExtractionInfo,
  RecruitRubric,
  RecruitRubricCategory,
  RecruitScreeningPreview,
} from '@/features/recruit/lib/types'

const DEFAULT_JD_TITLE = 'AI 解决方案工程师（业务系统方向）· 校招'
const DEFAULT_JD_TEXT = `岗位定位
我们是一家 LED 制造企业，正在用 AI 改造销售、客服、运营与生产协同的核心业务流程。这个岗位面向应届生同学——不要求你经验丰富，但要求你动手能力强、对 AI 应用落地有热情。

你将做什么
1. 参与销售、客服、运营等业务场景的需求调研，把业务痛点拆解成可落地的小方案，快速做出原型验证；
2. 在导师指导下，逐步独立完成 AI 应用的全栈开发：前端页面、后端服务、数据接口，覆盖从需求到上线的完整流程；
3. 围绕销售前端场景（如 CRM、客户跟进、报价支持、订单协同等）落地 AI 能力，比如智能问数、AI 陪练、智能工程化配置等；
4. 使用大模型相关技术解决实际业务问题：Prompt 工程、RAG、Agent、自动化工作流，有项目经验即可，不强求精通；
5. 深度使用 AI 编程工具（Cursor / Claude Code / Codex 等）提升开发效率，和团队一起探索 AI 时代新的开发方式。

我们希望你是
1. 本科及以上学历（2027 届应届生），计算机、软件工程、自动化等相关理工科专业优先，但更看重实际作品，专业不限；
2. 掌握至少一门编程语言和一个前端框架（Vue / React），独立完成过完整的项目（课程设计、个人项目、实习项目均可）；
3. 有业务好奇心，愿意去理解销售、客服、运营是怎么工作的，能听懂业务语言、把需求翻译成技术方案；
4. 自驱力强、沟通顺畅，遇到问题能主动查、主动问、主动试。

加分项（满足任意一条都很亮眼）
1. 实习中接触过 CRM、ERP、运营后台等企业系统，或对制造业数字化感兴趣；
2. 参加过黑客松、创新创业比赛，或有校园项目独立交付经历。

我们提供
- 导师带教：入职配备资深导师，前 6 个月有清晰的成长计划；
- 真实落地场景：你做的系统被销售、客服、运营团队每天使用；
- AI 原生工作方式：团队全面使用 AI 编程工具；
- base 深圳宝安：双休不加班，提供人才房等。`

const CATEGORY_ORDER: Array<{ key: RecruitRubricCategory; label: string; hint: string }> = [
  { key: 'core', label: '核心能力', hint: '逐项累加' },
  { key: 'potential', label: '潜力与素质', hint: '逐项累加' },
  { key: 'bonus', label: '加分项', hint: '任一满足即计分，取最高' },
]
const EXTRACTION_LABELS: Record<string, string> = {
  text: '文本直读',
  ocr: 'AI OCR 识别',
  mixed: '文本 + OCR',
  none: '未提取到文字',
}
const QUALITY_LABELS: Record<string, string> = { good: '完整', fair: '一般', poor: '偏少' }

type Phase = 'idle' | 'rubric' | 'evaluating'

const jdKey = (title: string, text: string) => `${title.trim()}\n${text.trim()}`

const OPPORTUNITY_STYLES = {
  high: 'recruit-screening-opportunity--high',
  review: 'recruit-screening-opportunity--review',
  pool: 'recruit-screening-opportunity--pool',
  low: 'recruit-screening-opportunity--low',
} as const

export function RecruitScreeningPage() {
  const [params] = useSearchParams()
  return params.get('mode') === 'single' ? <RecruitSingleScreeningPage /> : <RecruitTalentSearchPage />
}

function RecruitSingleScreeningPage() {
  const navigate = useNavigate()
  const resultRef = useRef<HTMLDivElement>(null)
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
  const [phase, setPhase] = useState<Phase>('idle')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [extraction, setExtraction] = useState<RecruitExtractionInfo | null>(null)
  const [rubric, setRubric] = useState<RecruitRubric | null>(null)
  const [rubricFor, setRubricFor] = useState('')
  const [rubricLoading, setRubricLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const rubricStale = Boolean(rubric) && rubricFor !== jdKey(jdTitle, jdText)
  const weightTotal = useMemo(
    () => (rubric?.requirements || []).filter((item) => item.category !== 'bonus').reduce((sum, item) => sum + item.weight, 0),
    [rubric],
  )

  const loadRubric = useCallback(async (title: string, text: string, refresh = false) => {
    setRubricLoading(true)
    try {
      const next = await fetchRecruitRubric({ jdTitle: title.trim(), jdText: text.trim(), refresh })
      setRubric(next)
      setRubricFor(jdKey(title, text))
      return next
    } finally {
      setRubricLoading(false)
    }
  }, [])

  useEffect(() => {
    // Prefetch the default role's scorecard so the first evaluation skips rubric generation.
    let cancelled = false
    fetchRecruitRubric({ jdTitle: DEFAULT_JD_TITLE, jdText: DEFAULT_JD_TEXT })
      .then((next) => {
        if (cancelled) return
        setRubric((current) => current ?? next)
        setRubricFor((current) => current || jdKey(DEFAULT_JD_TITLE, DEFAULT_JD_TEXT))
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const opportunity = useMemo(
    () => screening ? getInterviewOpportunity(screening) : null,
    [screening],
  )

  useEffect(() => {
    const scope = resultRef.current
    if (!screening || !scope || prefersReducedMotion()) return
    const context = gsap.context(() => {
      gsap.fromTo(
        scope.querySelectorAll('.recruit-screening-report > *, .recruit-score-report > *'),
        { autoAlpha: 0, y: 16 },
        { autoAlpha: 1, y: 0, duration: 0.55, stagger: 0.05, ease: 'power3.out', clearProps: 'transform' },
      )
    }, scope)
    return () => context.revert()
  }, [screening])

  function markDirty() {
    setIsDirty(true)
  }

  function updateWeight(key: string, value: number) {
    setRubric((current) => current ? {
      ...current,
      source: 'custom',
      requirements: current.requirements.map((item) => item.key === key
        ? { ...item, weight: Math.max(0, Math.min(60, Math.round(value) || 0)) }
        : item),
    } : current)
    markDirty()
  }

  async function handleRubricRefresh() {
    setScreeningError('')
    try {
      await loadRubric(jdTitle, jdText, true)
      markDirty()
    } catch (error) {
      setScreeningError(error instanceof Error ? error.message : '评分细则生成失败')
    }
  }

  async function handleScreeningSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setScreeningError('')

    if (!jdTitle.trim() || !jdText.trim()) {
      setScreeningError('请先填写岗位名称和 JD 内容。')
      return
    }
    if (!resumeText.trim() && !selectedFile) {
      setScreeningError('请上传简历文件或粘贴简历正文。')
      return
    }

    setSubmitting(true)
    try {
      let activeRubric = rubric
      if (!activeRubric || rubricStale) {
        setPhase('rubric')
        activeRubric = await loadRubric(jdTitle, jdText)
      }
      setPhase('evaluating')
      const result = await screenRecruitCandidate({
        candidateName: candidateName.trim() || '候选人',
        channel: channel.trim(),
        jdTitle: jdTitle.trim(),
        jdText: jdText.trim(),
        rubric: activeRubric,
        resumeText: resumeText.trim(),
        file: selectedFile,
      })
      setScreening(result)
      setIsDirty(false)
    } catch (error) {
      setScreeningError(error instanceof Error ? error.message : '简历筛选失败')
    } finally {
      setSubmitting(false)
      setPhase('idle')
    }
  }

  function handleResumeFile(file: File | null) {
    setSelectedFile(file)
    markDirty()
    setScreeningError('')
    setExtraction(null)
    if (!file) return

    setPreviewLoading(true)
    void previewRecruitResume(file)
      .then((preview) => {
        setCandidateName(preview.profile.full_name || '')
        setCandidateEmail(preview.profile.email || '')
        setResumeText(preview.parsed_text)
        setExtraction(preview.extraction ?? null)
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
        rubric: screening.rubric ?? rubric,
      })
      navigate(`/recruit/candidates/${result.candidate.candidate_id}`)
    } catch (error) {
      setScreeningError(error instanceof Error ? error.message : '保存到人才库失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <RecruitPage
        title="AI 找人才"
        eyebrow="Screen · 人岗匹配"
        description="上传 PDF / Word / 图片简历，按岗位评分卡逐项比对证据，输出可核查的匹配报告与面试计划。"
        actions={<Link className="recruit-button" to="/recruit/screen">从人才库找人</Link>}
      >
      <ErrorBanner message={screeningError} />

      <div className="recruit-screening-grid">
        <form onSubmit={handleScreeningSubmit} className="recruit-screening-form">
          <SectionCard
            title="岗位与评分卡"
            description="JD 会被转成带权重的评分卡（硬性门槛 / 核心能力 / 潜力 / 加分项），同一岗位的所有候选人用同一把尺子。"
            icon={<b className="rx-step">02</b>}
          >
            <div className="recruit-form">
              <label className="recruit-field">
                <span>岗位名称</span>
                <input
                  value={jdTitle}
                  onChange={(event) => { setJdTitle(event.target.value); markDirty() }}
                  placeholder="例如：AI 解决方案工程师"
                />
              </label>
              <label className="recruit-field">
                <span>JD 内容</span>
                <textarea
                  value={jdText}
                  onChange={(event) => { setJdText(event.target.value); markDirty() }}
                  rows={12}
                  placeholder="职责、硬性要求、加分项、业务场景和交付目标"
                />
              </label>
              <div className="recruit-rubric">
                <div className="recruit-rubric__head">
                  <div>
                    <strong><ListChecks size={15} />评分细则</strong>
                    <span>
                      {rubricLoading
                        ? <AiLoader label="AI 正在根据 JD 生成评分卡" />
                        : rubric
                          ? `${rubric.source === 'ai' ? 'AI 生成' : rubric.source === 'custom' ? '已手动调整' : '规则解析'} · ${rubric.requirements.length} 项 · 核心+潜力权重合计 ${weightTotal}（按比例换算为百分制）`
                          : '尚未生成，评分时会自动生成'}
                    </span>
                  </div>
                  <button type="button" className="recruit-button" disabled={rubricLoading || submitting} onClick={() => void handleRubricRefresh()}>
                    <RefreshCw size={14} />{rubric ? '重新生成' : '生成'}
                  </button>
                </div>
                {rubricStale ? <p className="recruit-inline-note">JD 已修改，开始评分时会按新 JD 重新生成评分卡（手动调整的权重将被覆盖）。</p> : null}
                {rubric && rubric.knockouts.length > 0 ? (
                  <div className="recruit-rubric__knockouts">
                    <span>硬性门槛</span>
                    {rubric.knockouts.map((item) => <em key={item.key}>{item.label}</em>)}
                  </div>
                ) : null}
                {rubric ? CATEGORY_ORDER.map((category) => {
                  const items = rubric.requirements.filter((item) => item.category === category.key)
                  if (items.length === 0) return null
                  return (
                    <div key={category.key} className="recruit-rubric__group">
                      <p>{category.label}<span>{category.hint}</span></p>
                      {items.map((item) => (
                        <div key={item.key} className="recruit-rubric__item">
                          <div className="min-w-0" title={item.description}>
                            <strong>{item.label}</strong>
                            <span>{item.description}</span>
                          </div>
                          <label>
                            <input
                              type="number"
                              min={0}
                              max={60}
                              value={item.weight}
                              aria-label={`${item.label} 权重`}
                              onChange={(event) => updateWeight(item.key, Number(event.target.value))}
                            />
                            <span>权重</span>
                          </label>
                        </div>
                      ))}
                    </div>
                  )
                }) : null}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="上传简历"
            description="支持 PDF、Word（.docx）、图片；扫描件和图片会自动 AI OCR 提取文字。"
            icon={<b className="rx-step">01</b>}
          >
            <div className="recruit-form">
              <label className="recruit-upload-zone">
                <span className="recruit-upload-zone__head">
                  <span className="recruit-upload-zone__icon" aria-hidden="true"><FileUp size={18} /></span>
                  <span>
                    <strong>拖入或选择简历文件</strong>
                    <span>PDF / DOCX / PNG / JPG / WEBP / TXT，最大 15MB。</span>
                  </span>
                  {previewLoading ? <AiLoader label="提取文字中" /> : null}
                </span>
                <input
                  type="file"
                  accept=".pdf,application/pdf,.docx,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp,.txt,.md"
                  onChange={(event) => handleResumeFile(event.target.files?.[0] ?? null)}
                />
                <span className="recruit-upload-zone__caption">
                  {selectedFile ? `已选择：${selectedFile.name}` : '上传后自动识别姓名与正文；联系方式只用于去重，不参与评分。'}
                </span>
              </label>
              {extraction ? (
                <div className={`recruit-extraction recruit-extraction--${extraction.quality || 'good'}`}>
                  <ScanText size={15} />
                  <div>
                    <strong>
                      {EXTRACTION_LABELS[extraction.method] || extraction.method}
                      {extraction.ocr_pages.length > 0 ? ` · OCR ${extraction.ocr_pages.length} 页` : ''}
                      {` · ${extraction.char_count} 字`}
                      {extraction.quality ? ` · 信息量${QUALITY_LABELS[extraction.quality] || extraction.quality}` : ''}
                    </strong>
                    {extraction.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                  </div>
                </div>
              ) : null}
              <div className="recruit-field-grid">
                <label className="recruit-field">
                  <span>候选人姓名（自动识别）</span>
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
              <label className="recruit-field">
                <span>简历正文（自动填充，可校对或补充作品链接）</span>
                <textarea
                  value={resumeText}
                  onChange={(event) => { setResumeText(event.target.value); markDirty() }}
                  rows={7}
                  placeholder="也可以直接粘贴简历文本。"
                />
              </label>
              <button
                type="submit"
                disabled={submitting || previewLoading}
                className="rx-glow rx-glow--block"
              >
                <span>
                  {submitting ? <AiLoader label={phase === 'rubric' ? '正在生成评分卡' : 'AI 正在逐项评估'} /> : <><BrainCircuit size={17} />开始评估并生成报告</>}
                </span>
              </button>
            </div>
          </SectionCard>
        </form>

        <div className="recruit-screening-result">
          <SectionCard
            title="人岗匹配报告"
            description="结果只作为招聘辅助，最终决定由招聘负责人确认。"
            icon={<b className="rx-step">03</b>}
            className="recruit-panel--report"
          >
            <div ref={resultRef}>
            {submitting ? (
              <div className="rx-scan">
                <div className="rx-scan__doc" aria-hidden="true">
                  {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ width: `${55 + ((index * 37) % 40)}%` }} />)}
                  <span className="rx-scan__beam" />
                </div>
                <ol className="recruit-progress-steps">
                  <li className="is-done">提取简历文字{extraction ? `（${EXTRACTION_LABELS[extraction.method] || extraction.method}）` : ''}</li>
                  <li className={phase === 'rubric' ? 'is-active' : 'is-done'}>载入岗位评分卡</li>
                  <li className={phase === 'evaluating' ? 'is-active' : ''}>AI 逐项对照证据评级（0-4 行为锚定）</li>
                  <li>核验引用原文 · 计算得分 · 生成面试计划</li>
                </ol>
              </div>
            ) : !screening || !opportunity ? (
              <div className="rx-report-empty">
                <div className="rx-report-empty__art" aria-hidden="true">
                  <span><FileSearch size={22} /></span>
                  <span><Target size={22} /></span>
                  <span><Sparkles size={22} /></span>
                </div>
                <strong>报告将在这里生成</strong>
                <ul>
                  <li><b>01</b>硬性门槛核验与 A / B / C / D 评级</li>
                  <li><b>02</b>每项要求的等级、权重、得分与原文证据</li>
                  <li><b>03</b>候选人画像、亮点 / 差距 / 风险与置信度</li>
                  <li><b>04</b>针对薄弱项与亮点核实的结构化面试计划</li>
                </ul>
              </div>
            ) : (
              <div className="recruit-screening-report">
                <div className="recruit-screening-decision">
                  <div className="recruit-screening-score">
                    <ScoreRing
                      score={screening.total_score}
                      max={screening.max_score}
                      size={108}
                      stroke={8}
                      caption={screening.score_report?.tier ? `${screening.score_report.tier.grade} · ${screening.score_report.tier.label}` : '分'}
                    />
                    <div>
                      <p>人岗匹配分</p>
                      <small>{screening.evaluation_mode === 'ai' ? 'AI 逐项评估 · 证据已核验' : '规则兜底评估（AI 不可用）'}</small>
                    </div>
                  </div>
                  <div className={`recruit-screening-opportunity ${OPPORTUNITY_STYLES[opportunity.level]}`}>
                    <p>面试机会</p>
                    <strong>{opportunity.label}</strong>
                    <span>{opportunity.detail}</span>
                  </div>
                </div>

                <RecruitScoreReport
                  report={screening.score_report}
                  totalScore={screening.total_score}
                  maxScore={screening.max_score}
                  showTotal={false}
                />

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
  )
}
