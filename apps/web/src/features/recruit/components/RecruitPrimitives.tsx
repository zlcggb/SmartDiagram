import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

import { AnimatedNumber } from './RecruitUI'

export function RecruitPage({ title, description, actions, children, compact = false, hideHeader = false, className, eyebrow = '招聘工作台' }: {
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
  compact?: boolean
  hideHeader?: boolean
  className?: string
  eyebrow?: string
}) {
  return (
    <section className={`recruit-page${compact ? ' recruit-page--compact' : ''}${className ? ` ${className}` : ''}`}>
      {!hideHeader ? (
        <header className={`recruit-page__header${compact ? ' recruit-page__header--compact' : ''}`} data-recruit-reveal>
          <div>
            <p className="recruit-page__eyebrow rx-header-fade"><i aria-hidden="true" />{eyebrow}</p>
            <h2 aria-label={title}>
              {Array.from(title).map((char, index) => (
                <span key={index} className="rx-char-mask" aria-hidden="true">
                  <span className="rx-char">{char === ' ' ? '\u00a0' : char}</span>
                </span>
              ))}
            </h2>
            <p className="rx-header-fade">{description}</p>
          </div>
          {actions ? <div className="recruit-page__actions rx-header-fade">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}

export function SectionCard({ title, description, children, icon, aside, className }: {
  title: string
  description?: string
  children: ReactNode
  icon?: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <section className={`recruit-panel${className ? ` ${className}` : ''}`} data-recruit-reveal>
      <header>
        {icon ? <span className="recruit-panel__icon" aria-hidden="true">{icon}</span> : null}
        <div className="recruit-panel__heading">
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {aside ? <div className="recruit-panel__aside">{aside}</div> : null}
      </header>
      <div className="recruit-panel__body">{children}</div>
    </section>
  )
}

export function RecruitDialog({ title, description, onClose, children }: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="recruit-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close() }}
    >
      <header className="recruit-dialog__header">
        <div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div>
        <button type="button" className="recruit-dialog__close" aria-label="关闭" onClick={() => dialogRef.current?.close()}><X size={18} /></button>
      </header>
      <div className="recruit-dialog__body">{children}</div>
    </dialog>
  )
}

export function StatCard({ label, value, hint, icon, tone = 'accent', decimals = 0 }: {
  label: string
  value: string | number
  hint: string
  icon?: ReactNode
  tone?: 'accent' | 'lime' | 'green' | 'amber' | 'ink'
  decimals?: number
}) {
  return (
    <article className={`recruit-stat recruit-stat--${tone}`} data-recruit-reveal>
      <div className="recruit-stat__head">
        <p>{label}</p>
        {icon ? <span className="recruit-stat__icon" aria-hidden="true">{icon}</span> : null}
      </div>
      <strong><AnimatedNumber value={value} decimals={decimals} /></strong>
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
  const tone = percentage === null ? 'empty' : percentage >= 80 ? 'strong' : percentage >= 70 ? 'medium' : 'watch'
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
