import type { ReactNode } from 'react'

export function RecruitPage({ title, description, actions, children }: {
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-5 md:px-6">
      <header className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)] backdrop-blur lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-semibold text-white">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{description}</p>
        </div>
        {actions}
      </header>
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
    <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 backdrop-blur">
      <header className="mb-4">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      </header>
      {children}
    </section>
  )
}

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <strong className="mt-3 block text-3xl text-white">{value}</strong>
      <p className="mt-2 text-sm text-slate-400">{hint}</p>
    </article>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null
  return <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{message}</div>
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  const tone = score === undefined || score === null ? 'bg-slate-700/60 text-slate-200' : score >= 85 ? 'bg-emerald-400/15 text-emerald-200' : score >= 70 ? 'bg-cyan-400/15 text-cyan-200' : 'bg-amber-400/15 text-amber-200'
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{score ?? '—'} 分</span>
}
