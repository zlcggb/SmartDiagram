import type { ReactNode } from 'react'

export function RecruitPage({ title, description, actions, children, compact = false, hideHeader = false, className }: {
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
  compact?: boolean
  hideHeader?: boolean
  className?: string
}) {
  return (
    <section className={`recruit-page${compact ? ' recruit-page--compact' : ''}${className ? ` ${className}` : ''}`}>
      {!hideHeader ? (
        <header className={`recruit-page__header${compact ? ' recruit-page__header--compact' : ''}`} data-recruit-reveal>
          <div>
            <p className="recruit-page__eyebrow">招聘工作台</p>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {actions ? <div className="recruit-page__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}

export function SectionCard({ title, description, children }: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="recruit-panel" data-recruit-reveal>
      <header>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="recruit-panel__body">{children}</div>
    </section>
  )
}

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <article className="recruit-stat" data-recruit-reveal>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{hint}</span>
    </article>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null
  return <div className="recruit-error px-4 py-3">{message}</div>
}

export function ScoreBadge({
  score,
  maxScore = 100,
}: {
  score: number | null | undefined
  maxScore?: number | null
}) {
  const resolvedMaxScore = typeof maxScore === 'number' && maxScore > 0 ? maxScore : 100
  const percentage = score === undefined || score === null ? null : (score / resolvedMaxScore) * 100
  const tone = percentage === null ? 'empty' : percentage >= 85 ? 'strong' : percentage >= 70 ? 'medium' : 'watch'
  const label = percentage === null
    ? `暂未评分，满分 ${resolvedMaxScore} 分`
    : `匹配评分 ${score} / ${resolvedMaxScore} 分`

  return (
    <span className={`recruit-score-badge recruit-score-badge--${tone}`} aria-label={label}>
      <span className="recruit-score-badge__value">{score ?? '—'}</span>
      <span className="recruit-score-badge__max"> / {resolvedMaxScore}</span>
      <span className="recruit-score-badge__unit">分</span>
    </span>
  )
}
