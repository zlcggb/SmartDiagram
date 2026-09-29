import type { ReactNode } from 'react'
import { CircleCheck, CircleQuestionMark, CircleX, Link2, Quote, ShieldCheck, Target, TriangleAlert } from 'lucide-react'

import type {
  RecruitRequirementResult,
  RecruitScoreReport,
  RecruitScoreReportV3Fields,
} from '@/features/recruit/lib/types'

interface RecruitScoreReportProps {
  report?: RecruitScoreReport
  totalScore?: number | null
  maxScore?: number | null
  showTotal?: boolean
}

export function RecruitScoreReport({ report, totalScore, maxScore = 100, showTotal = true }: RecruitScoreReportProps) {
  if (!report) return null
  if (report.model === 'rubric-v3' && report.requirements && report.tier) {
    return <RubricReport report={report as RecruitScoreReport & RecruitScoreReportV3Fields} showTotal={showTotal} />
  }
  return <LegacyScoreReport report={report} totalScore={totalScore} maxScore={maxScore} />
}

const EXTRACTION_LABELS: Record<string, string> = {
  text: '文本直读',
  ocr: 'AI OCR 识别',
  mixed: '文本 + OCR',
  manual: '手动粘贴',
  none: '未提取',
}
const SPECIFICITY_LABELS: Record<string, string> = { high: '具体可验证', medium: '一般', low: '偏空泛' }
const FLAG_LABELS: Record<string, string> = {
  timeline: '时间线',
  vague: '描述空泛',
  inflation: '疑似夸大',
  mismatch: '条件不符',
  other: '其他',
}

function RubricReport({ report, showTotal }: { report: RecruitScoreReport & RecruitScoreReportV3Fields; showTotal: boolean }) {
  const requirements = report.requirements
  const labelByKey = Object.fromEntries(requirements.map((item) => [item.key, item.label]))
  const extraction = report.extraction || {}
  const candidate = report.candidate
  const skillGroups = Object.entries(candidate?.skill_groups || {}).filter(([, items]) => items.length > 0)

  return (
    <div className="recruit-report">
      <section className={`recruit-report__hero recruit-report__hero--${report.tier.grade.toLowerCase()}`}>
        <div className="recruit-report__hero-main">
          {showTotal ? (
            <div className="recruit-report__grade" aria-label={`评级 ${report.tier.grade}`}>
              <strong>{report.tier.grade}</strong>
              <span>{report.total_score}<em>/100</em></span>
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="recruit-report__eyebrow">{report.title} · {report.tier.label}</p>
            <p className="recruit-report__summary">{report.summary}</p>
            {report.capped ? (
              <p className="recruit-report__capped">
                <TriangleAlert size={13} />未封顶前得分 {report.uncapped_score}，因不满足硬性条件已封顶。
              </p>
            ) : null}
          </div>
        </div>
        <div className="recruit-report__chips">
          <span>置信度 {Math.round(report.confidence)}%</span>
          <span>证据核验 {Math.round(report.evidence_quality.verified_ratio)}%</span>
          <span>{report.evaluation_mode === 'ai' ? 'AI 逐项评估' : '规则兜底评估'}</span>
          {report.rubric.role_level_label ? <span>{report.rubric.role_level_label}标准</span> : null}
          {extraction.method ? <span>{EXTRACTION_LABELS[extraction.method] || extraction.method}</span> : null}
        </div>
        <p className="recruit-report__decision">{report.decision.reason}</p>
      </section>

      {report.knockouts.length > 0 ? (
        <ReportSection title="硬性门槛" hint="不满足任一门槛时总分封顶，未知项需人工确认">
          <div className="recruit-report__knockouts">
            {report.knockouts.map((item) => (
              <div key={item.key} className={`recruit-report__knockout recruit-report__knockout--${item.status}`}>
                {item.status === 'pass' ? <CircleCheck size={15} /> : item.status === 'fail' ? <CircleX size={15} /> : <CircleQuestionMark size={15} />}
                <div className="min-w-0">
                  <strong>{item.label}</strong>
                  <span>{item.status === 'pass' ? '满足' : item.status === 'fail' ? '不满足' : '待确认'}{item.note ? ` · ${item.note}` : ''}</span>
                  {item.evidence ? <em>“{item.evidence}”</em> : null}
                </div>
              </div>
            ))}
          </div>
        </ReportSection>
      ) : null}

      <ReportSection title="分项得分" hint="核心能力与潜力逐项累加；加分项任一满足即计分，取最高一项">
        <div className="recruit-report__categories">
          {report.categories.map((item) => (
            <div key={item.key} className="recruit-report__category">
              <div>
                <span>{item.label}</span>
                <strong>{item.score} <em>/ {item.max_score}</em></strong>
              </div>
              <div className="recruit-progress">
                <span style={{ width: `${Math.min(100, item.ratio)}%` }} />
              </div>
              <p>达成 {Math.round(item.ratio)}% · {item.rule}</p>
            </div>
          ))}
        </div>
      </ReportSection>

      <ReportSection title="岗位要求逐项评估" hint="等级 0-4 行为锚定：无证据 / 仅提及 / 有实践 / 扎实 / 突出">
        <div className="recruit-report__requirements">
          {requirements.map((item) => <RequirementRow key={item.key} item={item} />)}
        </div>
      </ReportSection>

      {candidate ? (
        <ReportSection title="候选人画像" hint="由 AI 从简历结构化提取，用于快速了解背景">
          <div className="recruit-report__profile">
            <dl>
              <div><dt>学校</dt><dd>{candidate.school || '—'}</dd></div>
              <div><dt>学历 / 专业</dt><dd>{[candidate.degree, candidate.major].filter(Boolean).join(' · ') || '—'}</dd></div>
              <div><dt>毕业时间</dt><dd>{candidate.graduation || '—'}</dd></div>
              <div><dt>实习 / 项目</dt><dd>{candidate.internship_count} 段 / {candidate.project_count} 个</dd></div>
            </dl>
            {skillGroups.length > 0 ? (
              <div className="recruit-report__skills">
                {skillGroups.map(([group, items]) => (
                  <div key={group}>
                    <span>{group}</span>
                    <div>{items.map((skill) => <span key={skill} className="recruit-chip">{skill}</span>)}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {candidate.timeline.length > 0 ? (
              <ol className="recruit-report__timeline">
                {candidate.timeline.map((item, index) => (
                  <li key={`${item.org}-${index}`}>
                    <span>{item.period || '—'}</span>
                    <strong>{item.org}</strong>
                    <em>{item.role}</em>
                  </li>
                ))}
              </ol>
            ) : null}
            {candidate.links.length > 0 ? (
              <div className="recruit-report__links">
                {candidate.links.map((link) => <span key={link}><Link2 size={12} />{link}</span>)}
              </div>
            ) : null}
          </div>
        </ReportSection>
      ) : null}

      <div className="recruit-score-report__signals">
        <ReportList title="核心亮点" items={report.highlights} tone="positive" empty="暂无突出亮点" />
        <ReportList title="与岗位的差距" items={report.concerns} tone="warning" empty="未发现明显差距" />
      </div>
      {report.red_flags.length > 0 ? (
        <ReportSection title="风险提示" hint="需在面试或背调中核实">
          <ul className="recruit-report__flags">
            {report.red_flags.map((flag) => (
              <li key={flag.detail}><span>{FLAG_LABELS[flag.type] || flag.type}</span>{flag.detail}</li>
            ))}
          </ul>
        </ReportSection>
      ) : null}

      <ReportSection title="证据质量与置信度" hint="置信度反映本次判断的可靠程度，不影响总分">
        <div className="recruit-report__quality">
          <div><strong>{report.evidence_quality.quantified_results}</strong><span>条量化成果</span></div>
          <div><strong>{Math.round(report.evidence_quality.verified_ratio)}%</strong><span>引用可核验</span></div>
          <div><strong>{SPECIFICITY_LABELS[report.evidence_quality.specificity] || report.evidence_quality.specificity}</strong><span>描述具体度</span></div>
          <div><strong>{report.evidence_quality.verifiable_links.length}</strong><span>作品/代码链接</span></div>
        </div>
        {report.evidence_quality.note ? <p className="recruit-report__note">{report.evidence_quality.note}</p> : null}
        <div className="recruit-report__factors">
          {report.confidence_factors.map((factor) => (
            <div key={factor.label}>
              <span>{factor.label}</span>
              <div className="recruit-progress"><span style={{ width: `${factor.value}%` }} /></div>
              <em>{factor.value}%</em>
            </div>
          ))}
        </div>
      </ReportSection>

      <ReportSection title="结构化面试计划" hint="优先追问高权重但证据不足的项，并核实亮点真实性">
        <ol className="recruit-report__plan">
          {report.interview_plan.map((item, index) => (
            <li key={`${item.target_key}-${index}`}>
              <div className="recruit-report__plan-head">
                <span>Q{index + 1}</span>
                {item.target_key && labelByKey[item.target_key] ? <em><Target size={11} />{labelByKey[item.target_key]}</em> : null}
              </div>
              <p>{item.question}</p>
              {item.purpose ? <small>考察：{item.purpose}</small> : null}
              {(item.good_signals.length > 0 || item.red_signals.length > 0) ? (
                <div className="recruit-report__plan-signals">
                  {item.good_signals.length > 0 ? <div><b>好的回答</b>{item.good_signals.join('；')}</div> : null}
                  {item.red_signals.length > 0 ? <div><b>警惕信号</b>{item.red_signals.join('；')}</div> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </ReportSection>

      <details className="recruit-report__method">
        <summary><ShieldCheck size={14} />评分方法与参考指标</summary>
        <p>{report.score_explanation}</p>
        <ul className="recruit-report__scale">
          {report.level_scale.map((item) => (
            <li key={item.level}><b>{item.level} {item.label}</b>{item.anchor}</li>
          ))}
        </ul>
        <div className="recruit-report__ats">
          <p>ATS 关键词参考（不计入总分）：关键词覆盖 {Math.round(report.ats_reference.keyword_match)}% · 技能词覆盖 {Math.round(report.ats_reference.skills_coverage)}% · 结构完整度 {Math.round(report.ats_reference.section_completeness)}%</p>
          {report.ats_reference.missing_keywords.length > 0 ? (
            <div>{report.ats_reference.missing_keywords.slice(0, 12).map((keyword) => <span key={keyword} className="recruit-chip recruit-chip--missing">{keyword}</span>)}</div>
          ) : null}
        </div>
        {extraction.method ? (
          <p className="recruit-report__note">
            文字提取：{EXTRACTION_LABELS[extraction.method] || extraction.method}
            {typeof extraction.char_count === 'number' ? ` · ${extraction.char_count} 字` : ''}
            {extraction.ocr_pages && extraction.ocr_pages.length > 0 ? ` · OCR 页：${extraction.ocr_pages.join('、')}` : ''}
            {extraction.warnings && extraction.warnings.length > 0 ? ` · ${extraction.warnings.join('；')}` : ''}
          </p>
        ) : null}
        <p className="recruit-report__note">评分卡来源：{report.rubric.source === 'ai' ? 'AI 根据 JD 生成' : report.rubric.source === 'custom' ? '人工调整' : '规则解析 JD'} · 指纹 {report.rubric.fingerprint}</p>
      </details>
    </div>
  )
}

function RequirementRow({ item }: { item: RecruitRequirementResult }) {
  return (
    <article className={`recruit-report__req${item.counted ? '' : ' is-muted'}`}>
      <div className="recruit-report__req-head">
        <div className="min-w-0">
          <strong>{item.label}</strong>
          <span className={`recruit-report__cat recruit-report__cat--${item.category}`}>{item.category_label} · 权重 {item.weight}</span>
          {item.adjusted ? <span className="recruit-report__badge">证据未核验，已降级</span> : null}
          {!item.counted ? <span className="recruit-report__badge recruit-report__badge--muted">未计入（加分项取最高一项）</span> : null}
        </div>
        <div className="recruit-report__req-score">
          <LevelMeter level={item.level} />
          <span>{item.level_label} · {item.points}/{item.max_points}</span>
        </div>
      </div>
      {item.rationale ? <p>{item.rationale}</p> : null}
      {item.evidence.length > 0 ? (
        <div className="recruit-report__quotes">
          {item.evidence.map((evidence, index) => (
            <div key={`${item.key}-${index}`} className={evidence.verified ? 'is-verified' : 'is-unverified'}>
              <Quote size={11} />
              <span>{evidence.text}</span>
              <em>{evidence.verified ? '原文已核验' : '未在原文中找到'}{evidence.source_locator ? ` · ${evidence.source_locator}` : ''}</em>
            </div>
          ))}
        </div>
      ) : null}
      {item.gap ? <p className="recruit-report__gap">差距：{item.gap}</p> : null}
    </article>
  )
}

function LevelMeter({ level }: { level: number }) {
  return (
    <span className="recruit-report__meter" aria-label={`等级 ${level} / 4`}>
      {[1, 2, 3, 4].map((step) => <i key={step} className={step <= level ? 'is-on' : ''} />)}
    </span>
  )
}

function ReportSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="recruit-report__section">
      <header>
        <h4>{title}</h4>
        {hint ? <p>{hint}</p> : null}
      </header>
      {children}
    </section>
  )
}

function LegacyScoreReport({ report, totalScore, maxScore = 100 }: Omit<RecruitScoreReportProps, 'report' | 'showTotal'> & { report: RecruitScoreReport }) {
  const resolvedMaxScore = typeof maxScore === 'number' && maxScore > 0 ? maxScore : 100
  const hasTotalScore = typeof totalScore === 'number'

  return (
    <div className="recruit-score-report">
      <section className="recruit-score-report__summary">
        <div className="recruit-score-report__summary-head">
          <div>
            <p className="recruit-score-report__eyebrow">{report.title}</p>
            <p className="recruit-score-report__explanation">{report.score_explanation}</p>
          </div>
          <div className="recruit-score-report__meta">
            {hasTotalScore ? (
              <output className="recruit-score-report__total">
                <span>总匹配评分</span>
                <span className="recruit-score-report__total-value">
                  <strong>{totalScore}</strong>
                  <em> / {resolvedMaxScore} 分</em>
                </span>
              </output>
            ) : null}
            <span>证据覆盖 {Math.round(report.evidence_coverage)}%</span>
            <span>置信度 {Math.round(report.confidence)}%</span>
          </div>
        </div>
        <div className="recruit-score-report__decision">
          {report.decision.reason}
        </div>
      </section>

      <div className="recruit-score-report__components">
        {report.component_scores.map((item) => (
          <div key={item.key} className="recruit-score-report__component">
            <div className="recruit-score-report__component-head">
              <span>{item.label}</span>
              <strong>{Math.round(item.score)} / {item.max_score} 分</strong>
            </div>
            <div className="recruit-progress">
              <span style={{ width: `${Math.min(100, Math.max(0, (item.score / item.max_score) * 100))}%` }} />
            </div>
            <p>占总分 {item.weight}% · 贡献 {item.contribution}</p>
          </div>
        ))}
      </div>

      <div className="recruit-score-report__signals">
        <ReportList title="匹配优势" items={report.strengths} tone="positive" />
        <ReportList title="证据缺口" items={report.gaps} tone="warning" />
        <ReportList title="需要核实" items={report.risks} tone="neutral" />
      </div>

      <div className="recruit-score-report__dimensions">
        {report.dimension_scores.map((item) => (
          <article key={item.key}>
            <div className="recruit-score-report__dimension-head">
              <div>
                <strong>{item.label}</strong>
                <span>权重 {item.weight ?? item.max_score}%</span>
              </div>
              <span>{item.score} / {item.max_score} 分</span>
            </div>
            <p>{item.reason}</p>
            {(item.evidence?.length ?? 0) > 0 ? (
              <div className="recruit-score-report__evidence">
                {item.evidence?.map((evidence, index) => (
                  <div key={`${item.key}-${index}`}>
                    <span>{evidence.text}</span>
                    {evidence.source_locator ? <span>({evidence.source_locator})</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {(item.gaps?.length ?? 0) > 0 ? (
              <ul className="recruit-score-report__gaps">
                {item.gaps?.map((gap) => <li key={gap}>· {gap}</li>)}
              </ul>
            ) : null}
          </article>
        ))}
      </div>

      <section className="recruit-score-report__interview">
        <p>面试重点</p>
        <ul>
          {report.interview_focus.map((question) => <li key={question}>· {question}</li>)}
        </ul>
      </section>
    </div>
  )
}

function ReportList({
  title,
  items,
  tone,
  empty,
}: {
  title: string
  items: string[]
  tone: 'positive' | 'warning' | 'neutral'
  empty?: string
}) {
  return (
    <div className={`recruit-score-report__list recruit-score-report__list--${tone}`}>
      <p>{title}</p>
      <ul>
        {items.length > 0 ? items.map((item) => <li key={item}>· {item}</li>) : <li>{empty ?? '—'}</li>}
      </ul>
    </div>
  )
}
