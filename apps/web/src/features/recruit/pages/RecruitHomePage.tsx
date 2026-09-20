import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import { ErrorBanner, RecruitPage, ScoreBadge, SectionCard, StatCard } from '@/features/recruit/components/RecruitPrimitives'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

export function RecruitHomePage() {
  const { dashboard, error, loadDashboard, loading } = useRecruitStore((state) => ({
    dashboard: state.dashboard,
    error: state.error,
    loadDashboard: state.loadDashboard,
    loading: state.loading
  }))

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  return (
    <RecruitPage
      title="招聘首页"
      description="总览岗位数量、候选人流转、来源渠道与强匹配人才，用于作为正式 ATS 子系统的管理入口。"
      actions={<Link className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950" to="/recruit/candidates">去处理候选人</Link>}
    >
      <ErrorBanner message={error} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="岗位数" value={dashboard?.summary.job_count ?? (loading ? '…' : 0)} hint="当前活跃与草稿岗位" />
        <StatCard label="候选人数" value={dashboard?.summary.candidate_count ?? (loading ? '…' : 0)} hint="已进入系统的人才档案" />
        <StatCard label="面试记录" value={dashboard?.summary.interview_count ?? (loading ? '…' : 0)} hint="全量面试轮次沉淀" />
        <StatCard label="强匹配" value={dashboard?.summary.strong_match_count ?? (loading ? '…' : 0)} hint="AI 评分达到 85+ 的候选人" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard title="最近候选人" description="追踪最新进入系统的人才与当前初筛得分。">
          <div className="space-y-3">
            {(dashboard?.recent_candidates ?? []).map((candidate) => (
              <Link key={candidate.candidate_id} to={`/recruit/candidates/${candidate.candidate_id}`} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-4 py-3 transition hover:bg-white/8">
                <div>
                  <strong className="text-sm text-white">{candidate.full_name}</strong>
                  <p className="mt-1 text-xs text-slate-400">{candidate.job_title} · {candidate.current_stage}</p>
                </div>
                <ScoreBadge score={candidate.latest_screening?.total_score} />
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="岗位看板" description="查看重点岗位及当前进入漏斗的人数。">
          <div className="space-y-3">
            {(dashboard?.open_jobs ?? []).map((job) => (
              <Link key={job.job_id} to={`/recruit/jobs/${job.job_id}`} className="block rounded-2xl border border-white/8 bg-white/5 px-4 py-4 transition hover:bg-white/8">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm text-white">{job.title}</strong>
                  <span className="text-xs text-cyan-200">{job.candidate_count} 人</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">{job.department || '未填写部门'} · {job.location || '未填写地点'} · {job.status}</p>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>
    </RecruitPage>
  )
}
