import { useEffect } from 'react'

import { ErrorBanner, RecruitPage, SectionCard, StatCard } from '@/features/recruit/components/RecruitPrimitives'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

export function RecruitAnalyticsPage() {
  const { analytics, error, loadAnalytics } = useRecruitStore((state) => ({
    analytics: state.analytics,
    error: state.error,
    loadAnalytics: state.loadAnalytics
  }))

  useEffect(() => {
    void loadAnalytics()
  }, [loadAnalytics])

  return (
    <RecruitPage title="统计分析" description="查看招聘漏斗、来源转化、岗位通过率和面试负载。">
      <ErrorBanner message={error} />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="平均 AI 分数" value={analytics?.average_score ?? 0} hint="所有初筛结果的平均分" />
        <StatCard label="阶段数" value={analytics?.stage_breakdown.length ?? 0} hint="当前漏斗中的活跃阶段" />
        <StatCard label="来源数" value={analytics?.source_breakdown.length ?? 0} hint="来源渠道维度" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="阶段漏斗" description="候选人在各阶段的数量分布。">
          <div className="space-y-3">
            {analytics?.stage_breakdown.map((item) => (
              <div key={item.stage} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                <span className="text-sm text-white">{item.stage}</span>
                <span className="text-sm text-cyan-200">{item.count}</span>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="来源转化" description="不同来源渠道进入系统的人数。">
          <div className="space-y-3">
            {analytics?.source_breakdown.map((item) => (
              <div key={item.source} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                <span className="text-sm text-white">{item.source}</span>
                <span className="text-sm text-cyan-200">{item.count}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="岗位转化概览" description="按岗位查看候选人量、通过量和 Offer 数。">
        <div className="space-y-3">
          {analytics?.job_breakdown.map((item) => (
            <div key={item.job_id} className="grid gap-3 rounded-3xl border border-white/8 bg-white/5 px-4 py-4 md:grid-cols-4">
              <strong className="text-sm text-white">{item.title}</strong>
              <span className="text-sm text-slate-300">候选人：{item.candidate_count}</span>
              <span className="text-sm text-slate-300">通过初筛：{item.screen_pass_count}</span>
              <span className="text-sm text-slate-300">Offer：{item.offer_count}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </RecruitPage>
  )
}
