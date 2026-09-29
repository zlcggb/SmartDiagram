import { useEffect, useRef, type ReactNode } from 'react'
import gsap from 'gsap'
import { Link } from 'react-router-dom'

import { scoreTone, stageLabel } from '../lib/format'
import { prefersReducedMotion } from '../lib/motion'

/** Counts from the previously rendered value to the new one; non-numeric values render verbatim. */
export function AnimatedNumber({ value, decimals = 0, duration = 1.1 }: {
  value: number | string | null | undefined
  decimals?: number
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const previous = useRef(0)
  const numeric = typeof value === 'number' && Number.isFinite(value)

  useEffect(() => {
    const element = ref.current
    if (!element || !numeric) return
    const target = value as number
    if (prefersReducedMotion()) {
      element.textContent = target.toFixed(decimals)
      previous.current = target
      return
    }
    const proxy = { value: previous.current }
    const tween = gsap.to(proxy, {
      value: target,
      duration,
      ease: 'power3.out',
      onUpdate: () => { element.textContent = proxy.value.toFixed(decimals) },
    })
    previous.current = target
    return () => { tween.kill() }
  }, [value, numeric, decimals, duration])

  return <span ref={ref} className="rx-number">{numeric ? (value as number).toFixed(decimals) : (value ?? '—')}</span>
}

export function ScoreRing({ score, max = 100, size = 56, stroke = 5, caption }: {
  score: number | null | undefined
  max?: number | null
  size?: number
  stroke?: number
  caption?: string
}) {
  const circleRef = useRef<SVGCircleElement>(null)
  const resolvedMax = typeof max === 'number' && max > 0 ? max : 100
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = typeof score === 'number' ? Math.max(0, Math.min(1, score / resolvedMax)) : 0
  const tone = scoreTone(score, resolvedMax)

  useEffect(() => {
    const circle = circleRef.current
    if (!circle) return
    const offset = circumference * (1 - ratio)
    if (prefersReducedMotion()) {
      circle.style.strokeDashoffset = String(offset)
      return
    }
    const tween = gsap.fromTo(circle, { strokeDashoffset: circumference }, {
      strokeDashoffset: offset, duration: 1.2, ease: 'expo.out', delay: 0.1,
    })
    return () => { tween.kill() }
  }, [circumference, ratio])

  return (
    <span
      className={`rx-ring rx-ring--${tone}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={typeof score === 'number' ? `匹配评分 ${score} / ${resolvedMax} 分` : '暂未评分'}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="rx-ring__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle
          ref={circleRef}
          className="rx-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="rx-ring__label">
        <strong style={{ fontSize: Math.max(13, Math.round(size * 0.31)) }}><AnimatedNumber value={typeof score === 'number' ? score : '—'} /></strong>
        {caption ? <em>{caption}</em> : null}
      </span>
    </span>
  )
}

export function MeterBar({ value, max, tone = 'accent', label }: {
  value: number
  max: number
  tone?: 'accent' | 'lime' | 'green' | 'amber' | 'ink'
  label?: string
}) {
  const fillRef = useRef<HTMLSpanElement>(null)
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0

  useEffect(() => {
    const fill = fillRef.current
    if (!fill) return
    if (prefersReducedMotion()) {
      fill.style.width = `${percent}%`
      return
    }
    const tween = gsap.fromTo(fill, { width: '0%' }, { width: `${percent}%`, duration: 1, ease: 'power3.out', delay: 0.15 })
    return () => { tween.kill() }
  }, [percent])

  return (
    <span className={`rx-meter rx-meter--${tone}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <span ref={fillRef} style={{ width: `${percent}%` }} />
    </span>
  )
}

const AVATAR_HUES = [228, 262, 168, 18, 336, 196, 44, 290]

export function Avatar({ name, size = 38 }: { name?: string | null; size?: number }) {
  const text = (name || '?').trim()
  const glyph = /^[\u4e00-\u9fff]/.test(text) ? text.slice(0, 1) : text.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const hash = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length]
  return (
    <span
      className="rx-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.42, ['--hue' as string]: hue }}
    >
      {glyph || '?'}
    </span>
  )
}

export function StageChip({ stage }: { stage?: string | null }) {
  return <span className={`rx-stage rx-stage--${stage || 'none'}`}>{stageLabel(stage)}</span>
}

export function AiLoader({ label = 'AI 正在分析…' }: { label?: string }) {
  return (
    <span className="rx-loader" role="status">
      <span className="rx-loader__bars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 0.12}s` }} />)}
      </span>
      <span>{label}</span>
    </span>
  )
}

export function EmptyState({ icon, title, hint, action }: {
  icon: ReactNode
  title: string
  hint?: string
  action?: { to: string; label: string }
}) {
  return (
    <div className="rx-empty">
      <span className="rx-empty__icon" aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      {hint ? <p>{hint}</p> : null}
      {action ? <Link className="recruit-button recruit-button--primary" to={action.to}>{action.label}</Link> : null}
    </div>
  )
}

export function Ticker({ items }: { items: string[] }) {
  const row = items.map((item) => <span key={item}>{item}<i aria-hidden="true">✦</i></span>)
  return (
    <div className="rx-ticker" aria-hidden="true">
      <div className="rx-ticker__track">{row}{row}</div>
    </div>
  )
}

/** Candidates plotted like a radar: distance from centre shrinks as the match score rises. */
export function TalentRadar({ points }: { points: Array<{ id: string; name: string; score: number | null | undefined }> }) {
  const ref = useRef<HTMLDivElement>(null)
  const plotted = points.slice(0, 14).map((point, index, list) => {
    const angle = (index / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2 + 0.35
    const score = typeof point.score === 'number' ? point.score : 0
    const distance = 12 + (1 - score / 100) * 34
    return { ...point, x: 50 + Math.cos(angle) * distance, y: 50 + Math.sin(angle) * distance, tone: scoreTone(point.score) }
  })

  useEffect(() => {
    if (!ref.current || !points.length || prefersReducedMotion()) return
    const context = gsap.context(() => {
      gsap.fromTo('.rx-radar__dot', { scale: 0, autoAlpha: 0 }, {
        scale: 1, autoAlpha: 1, duration: 0.6, ease: 'back.out(2.4)', stagger: 0.06, delay: 0.4,
      })
    }, ref)
    return () => context.revert()
  }, [points])

  return (
    <div ref={ref} className="rx-radar" aria-label="候选人匹配度雷达">
      <span className="rx-radar__ring" style={{ inset: '4%' }} />
      <span className="rx-radar__ring" style={{ inset: '20%' }} />
      <span className="rx-radar__ring" style={{ inset: '36%' }} />
      <span className="rx-radar__axis rx-radar__axis--x" />
      <span className="rx-radar__axis rx-radar__axis--y" />
      <span className="rx-radar__sweep" />
      <span className="rx-radar__core">A</span>
      {plotted.map((point) => (
        <Link
          key={point.id}
          to={`/recruit/candidates/${point.id}`}
          className={`rx-radar__dot rx-radar__dot--${point.tone}`}
          style={{ left: `${point.x}%`, top: `${point.y}%` }}
          title={`${point.name} · ${point.score ?? '未评分'}`}
        >
          <span>{point.name.slice(0, 1)}</span>
        </Link>
      ))}
    </div>
  )
}
