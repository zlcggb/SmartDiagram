import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitPage, SectionCard, StatCard } from '@/features/recruit/components/RecruitPrimitives'
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

  return (
    <RecruitPage title="统计" description="用招聘漏斗、来源与岗位转化判断当前队列的质量。">
      <ErrorBanner message={error} />
      <div className="recruit-stat-grid recruit-stat-grid--three">
        <StatCard label="平均 AI 分数" value={analytics?.average_score ?? 0} hint="所有初筛结果的平均分" />
        <StatCard label="阶段数" value={analytics?.stage_breakdown.length ?? 0} hint="当前漏斗中的活跃阶段" />
        <StatCard label="来源数" value={analytics?.source_breakdown.length ?? 0} hint="来源渠道维度" />
      </div>

      <div className="recruit-dashboard-grid">
        <SectionCard title="阶段漏斗" description="候选人在各阶段的数量分布。">
          <div className="recruit-metric-list">
            {analytics?.stage_breakdown.map((item) => (
              <div key={item.stage}>
                <span>{item.stage}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
            {!analytics?.stage_breakdown.length ? <p className="recruit-empty-state">还没有阶段数据。</p> : null}
          </div>
        </SectionCard>
        <SectionCard title="来源转化" description="不同来源渠道进入系统的人数。">
          <div className="recruit-metric-list">
            {analytics?.source_breakdown.map((item) => (
              <div key={item.source}>
                <span>{item.source}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
            {!analytics?.source_breakdown.length ? <p className="recruit-empty-state">还没有来源数据。</p> : null}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="岗位转化概览" description="按岗位查看候选人量、通过量和 Offer 数。">
        <div className="recruit-analytics-list">
          {analytics?.job_breakdown.map((item) => (
            <div key={item.job_id}>
              <strong>{item.title}</strong>
              <span>候选人 <b>{item.candidate_count}</b></span>
              <span>通过初筛 <b>{item.screen_pass_count}</b></span>
              <span>Offer <b>{item.offer_count}</b></span>
            </div>
          ))}
          {!analytics?.job_breakdown.length ? <p className="recruit-empty-state">还没有岗位转化数据。</p> : null}
        </div>
      </SectionCard>
    </RecruitPage>
  )
}
