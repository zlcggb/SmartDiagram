import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitPage, ScoreBadge, SectionCard, StatCard } from '@/features/recruit/components/RecruitPrimitives'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

export function RecruitHomePage() {
  const { dashboard, error, loadDashboard, loading } = useRecruitStore(useShallow((state) => ({
    dashboard: state.dashboard,
    error: state.error,
    loadDashboard: state.loadDashboard,
    loading: state.loading
  })))

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  return (
    <RecruitPage
      title="招聘概览"
      description="岗位、候选人、评分与面试的实时工作视图。"
      actions={
        <div className="recruit-action-group">
          <Link className="recruit-button recruit-button--primary" to="/recruit/screen">AI 找人才</Link>
          <Link className="recruit-button" to="/recruit/candidates">候选人中心</Link>
        </div>
      }
    >
      <ErrorBanner message={error} />
      <div className="recruit-stat-grid">
        <StatCard label="岗位数" value={dashboard?.summary.job_count ?? (loading ? '…' : 0)} hint="当前活跃与草稿岗位" />
        <StatCard label="候选人数" value={dashboard?.summary.candidate_count ?? (loading ? '…' : 0)} hint="已进入系统的人才档案" />
        <StatCard label="面试记录" value={dashboard?.summary.interview_count ?? (loading ? '…' : 0)} hint="全量面试轮次沉淀" />
        <StatCard label="强匹配" value={dashboard?.summary.strong_match_count ?? (loading ? '…' : 0)} hint="AI 评分达到 85+ 的候选人" />
      </div>

      <div className="recruit-dashboard-grid">
        <SectionCard title="最近候选人" description="追踪最新进入系统的人才与当前初筛得分。">
          <div className="recruit-list">
            {(dashboard?.recent_candidates ?? []).map((candidate) => (
              <Link key={candidate.candidate_id} to={`/recruit/candidates/${candidate.candidate_id}`} className="recruit-list-row recruit-list-row--link">
                <div className="recruit-list-row__main">
                  <strong>{candidate.full_name}</strong>
                  <p>{candidate.job_title} · {candidate.current_stage}</p>
                </div>
                <div className="recruit-list-row__side">
                  <ScoreBadge
                    score={candidate.latest_screening?.total_score}
                    maxScore={candidate.latest_screening?.max_score}
                  />
                </div>
              </Link>
            ))}
            {!dashboard?.recent_candidates.length ? <p className="recruit-empty-state">还没有候选人。上传一份 PDF 简历即可开始初筛。</p> : null}
          </div>
        </SectionCard>

        <SectionCard title="岗位看板" description="查看重点岗位及当前进入漏斗的人数。">
          <div className="recruit-list">
            {(dashboard?.open_jobs ?? []).map((job) => (
              <Link key={job.job_id} to={`/recruit/jobs/${job.job_id}`} className="recruit-list-row recruit-list-row--link">
                <div className="recruit-list-row__main">
                  <strong>{job.title}</strong>
                  <p>{job.department || '未填写部门'} · {job.location || '未填写地点'} · {job.status}</p>
                </div>
                <span className="recruit-count">{job.candidate_count} 人</span>
              </Link>
            ))}
            {!dashboard?.open_jobs.length ? <p className="recruit-empty-state">还没有岗位。先建立一个岗位需求。</p> : null}
          </div>
        </SectionCard>
      </div>
    </RecruitPage>
  )
}
