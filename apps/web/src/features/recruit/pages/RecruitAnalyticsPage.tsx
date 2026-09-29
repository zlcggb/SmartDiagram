import { useEffect } from 'react'
import { BarChart3, Gauge, Layers, Radio, Waypoints } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitPage, SectionCard, StatCard } from '@/features/recruit/components/RecruitPrimitives'
import { EmptyState, MeterBar, ScoreRing } from '@/features/recruit/components/RecruitUI'
import { stageLabel } from '@/features/recruit/lib/format'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

export function RecruitAnalyticsPage() {
  const { analytics, error, loadAnalytics } = useRecruitStore(useShallow((state) => ({
    analytics: state.analytics,
    error: state.error,
    loadAnalytics: state.loadAnalytics
  })))

  useEffect(() => {
    void loadAnalytics()
  }, [loadAnalytics])

  const stages = analytics?.stage_breakdown ?? []
  const sources = analytics?.source_breakdown ?? []
  const jobs = analytics?.job_breakdown ?? []
  const stageMax = Math.max(1, ...stages.map((item) => item.count))
  const sourceMax = Math.max(1, ...sources.map((item) => item.count))
  const candidateTotal = stages.reduce((sum, item) => sum + item.count, 0)

  return (
    <RecruitPage title="统计分析" eyebrow="Insights · 数据" description="用招聘漏斗、来源与岗位转化判断当前队列的质量。">
      <ErrorBanner message={error} />
      <div className="recruit-stat-grid recruit-stat-grid--three">
        <StatCard label="平均 AI 分数" icon={<Gauge size={16} />} tone="lime" value={analytics?.average_score ?? 0} decimals={1} hint="所有初筛结果的平均分" />
        <StatCard label="活跃阶段" icon={<Layers size={16} />} value={stages.length} hint="当前漏斗中的阶段数" />
        <StatCard label="来源渠道" icon={<Radio size={16} />} tone="ink" value={sources.length} hint="候选人来源维度" />
      </div>

      <div className="recruit-dashboard-grid">
        <SectionCard title="阶段漏斗" description="候选人在各阶段的数量分布。" icon={<Waypoints size={15} />}>
          <div className="rx-funnel">
            {stages.map((item, index) => (
              <div key={item.stage} className="rx-funnel__row" style={{ ['--i' as string]: index }}>
                <span>{stageLabel(item.stage)}</span>
                <MeterBar value={item.count} max={stageMax} tone={index === 0 ? 'ink' : 'accent'} label={stageLabel(item.stage)} />
                <strong>{item.count}<em>{candidateTotal ? `${Math.round((item.count / candidateTotal) * 100)}%` : ''}</em></strong>
              </div>
            ))}
            {!stages.length ? <EmptyState icon={<Waypoints size={20} />} title="还没有阶段数据" /> : null}
          </div>
        </SectionCard>
        <SectionCard title="来源分布" description="不同来源渠道进入系统的人数。" icon={<Radio size={15} />}>
          <div className="rx-funnel">
            {sources.map((item, index) => (
              <div key={item.source} className="rx-funnel__row" style={{ ['--i' as string]: index }}>
                <span>{item.source || '未知'}</span>
                <MeterBar value={item.count} max={sourceMax} tone="lime" label={item.source} />
                <strong>{item.count}</strong>
              </div>
            ))}
            {!sources.length ? <EmptyState icon={<Radio size={20} />} title="还没有来源数据" /> : null}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="岗位转化" description="按岗位查看候选人量、通过初筛量（B 档以上）和 Offer 数。" icon={<BarChart3 size={15} />}>
        <div className="rx-conversion">
          {jobs.map((item, index) => {
            const passRate = item.candidate_count ? Math.round((item.screen_pass_count / item.candidate_count) * 100) : 0
            return (
              <article key={item.job_id} className="rx-conversion__row rx-spot" style={{ ['--i' as string]: index }}>
                <ScoreRing score={passRate} size={52} stroke={4} caption="%" />
                <div className="rx-conversion__main">
                  <strong>{item.title}</strong>
                  <div className="rx-conversion__steps">
                    <span>候选人 <b>{item.candidate_count}</b></span>
                    <i aria-hidden="true" />
                    <span>通过初筛 <b>{item.screen_pass_count}</b></span>
                    <i aria-hidden="true" />
                    <span>Offer <b>{item.offer_count}</b></span>
                  </div>
                  <MeterBar value={item.screen_pass_count} max={Math.max(1, item.candidate_count)} tone="green" label="初筛通过率" />
                </div>
              </article>
            )
          })}
          {!jobs.length ? <EmptyState icon={<BarChart3 size={20} />} title="还没有岗位转化数据" /> : null}
        </div>
      </SectionCard>
    </RecruitPage>
  )
}
