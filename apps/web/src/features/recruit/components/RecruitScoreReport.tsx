import type { RecruitScoreReport } from '@/features/recruit/lib/types'

interface RecruitScoreReportProps {
  report?: RecruitScoreReport
  totalScore?: number | null
  maxScore?: number | null
}

export function RecruitScoreReport({ report, totalScore, maxScore = 100 }: RecruitScoreReportProps) {
  if (!report) return null
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
}: {
  title: string
  items: string[]
  tone: 'positive' | 'warning' | 'neutral'
}) {
  return (
    <div className={`recruit-score-report__list recruit-score-report__list--${tone}`}>
      <p>{title}</p>
      <ul>
        {items.map((item) => <li key={item}>· {item}</li>)}
      </ul>
    </div>
  )
}
