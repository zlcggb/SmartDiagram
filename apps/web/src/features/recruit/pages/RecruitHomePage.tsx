import { useEffect } from 'react'
import { ArrowUpRight, BarChart3, BrainCircuit, BriefcaseBusiness, CalendarClock, Sparkles, Trophy, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitPage, SectionCard, StatCard } from '@/features/recruit/components/RecruitPrimitives'
import { Avatar, EmptyState, MeterBar, ScoreRing, StageChip, TalentRadar, Ticker } from '@/features/recruit/components/RecruitUI'
import { stageLabel } from '@/features/recruit/lib/format'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

const PRINCIPLES = [
  'JD → 结构化评分卡',
  '0-4 行为锚定量表',
  '原文证据逐条核验',
  '硬性门槛封顶',
  '加分项任一满足',
  '忽略性别 / 年龄 / 学校名气',
  'STAR 面试追问',
  'PDF · Word · 图片 OCR',
]

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

  const recent = dashboard?.recent_candidates ?? []
  const pipeline = dashboard?.pipeline ?? []
  const pipelineMax = Math.max(1, ...pipeline.map((item) => item.count))
  const placeholder = loading ? '…' : 0

  return (
    <RecruitPage
      title="招聘概览"
      eyebrow="Talent Atlas · 今日"
      description="岗位、候选人、评分与面试的实时工作视图。"
      actions={
        <div className="recruit-action-group">
          <Link className="recruit-button" to="/recruit/candidates">候选人中心</Link>
        </div>
      }
    >
      <ErrorBanner message={error} />

      <section className="rx-hero" data-recruit-reveal>
        <div className="rx-hero__copy">
          <p className="rx-hero__kicker"><Sparkles size={13} />AI 人岗匹配</p>
          <h3>今天，谁<em>值得</em>被面试？</h3>
          <p>
            上传一份 PDF、Word 或截图简历，系统会按岗位评分卡逐项取证、核验原文，
            给出可解释的分数、风险与面试追问清单。
          </p>
          <div className="rx-hero__actions">
            <Link className="rx-glow" to="/recruit/screen">
              <span><BrainCircuit size={16} />开始 AI 评估</span>
            </Link>
            <Link className="rx-hero__link" to="/recruit/jobs">管理岗位 <ArrowUpRight size={14} /></Link>
          </div>
        </div>
        <div className="rx-hero__radar">
          <TalentRadar
            points={recent.map((candidate) => ({
              id: candidate.candidate_id,
              name: candidate.full_name || '候选人',
              score: candidate.latest_screening?.total_score,
            }))}
          />
          <ul className="rx-hero__legend">
            <li><i className="rx-dot rx-dot--strong" />A 强烈推荐 ≥80</li>
            <li><i className="rx-dot rx-dot--medium" />B 建议面试 ≥70</li>
            <li><i className="rx-dot rx-dot--pool" />C 待定 60–69</li>
          </ul>
        </div>
        <Ticker items={PRINCIPLES} />
      </section>

      <div className="recruit-stat-grid">
        <StatCard label="在招岗位" icon={<BriefcaseBusiness size={16} />} value={dashboard?.summary.job_count ?? placeholder} hint="当前活跃与草稿岗位" />
        <StatCard label="人才档案" icon={<UsersRound size={16} />} tone="ink" value={dashboard?.summary.candidate_count ?? placeholder} hint="已进入系统的候选人" />
        <StatCard label="面试记录" icon={<CalendarClock size={16} />} tone="amber" value={dashboard?.summary.interview_count ?? placeholder} hint="全量面试轮次沉淀" />
        <StatCard label="强匹配" icon={<Trophy size={16} />} tone="lime" value={dashboard?.summary.strong_match_count ?? placeholder} hint="评分达到 A 档（≥80）" />
      </div>

      <div className="recruit-dashboard-grid recruit-dashboard-grid--home">
        <SectionCard
          title="最近候选人"
          description="最新进入系统的人才与 AI 初筛得分。"
          icon={<UsersRound size={15} />}
          aside={<Link className="rx-text-link" to="/recruit/candidates">全部 <ArrowUpRight size={13} /></Link>}
        >
          <div className="rx-people">
            {recent.map((candidate, index) => (
              <Link
                key={candidate.candidate_id}
                to={`/recruit/candidates/${candidate.candidate_id}`}
                className="rx-person"
                style={{ ['--i' as string]: index }}
              >
                <Avatar name={candidate.full_name} />
                <span className="rx-person__main">
                  <strong>{candidate.full_name}</strong>
                  <span>{candidate.job_title}</span>
                </span>
                <StageChip stage={candidate.current_stage} />
                <ScoreRing score={candidate.latest_screening?.total_score} max={candidate.latest_screening?.max_score} size={46} stroke={4} />
              </Link>
            ))}
            {!recent.length && !loading ? (
              <EmptyState icon={<UsersRound size={20} />} title="还没有候选人" hint="上传一份简历即可开始 AI 初筛。" action={{ to: '/recruit/screen', label: '去评估第一份简历' }} />
            ) : null}
          </div>
        </SectionCard>

        <div className="rx-stack">
          <SectionCard title="招聘漏斗" description="候选人在各阶段的分布。" icon={<BarChart3 size={15} />}>
            <div className="rx-funnel">
              {pipeline.map((item, index) => (
                <div key={item.stage} className="rx-funnel__row" style={{ ['--i' as string]: index }}>
                  <span>{stageLabel(item.stage)}</span>
                  <MeterBar value={item.count} max={pipelineMax} tone={index === 0 ? 'ink' : 'accent'} label={stageLabel(item.stage)} />
                  <strong>{item.count}</strong>
                </div>
              ))}
              {!pipeline.length ? <p className="recruit-empty-state">暂无漏斗数据。</p> : null}
            </div>
          </SectionCard>

          <SectionCard title="岗位看板" description="重点岗位与进入漏斗的人数。" icon={<BriefcaseBusiness size={15} />}>
            <div className="rx-job-tiles">
              {(dashboard?.open_jobs ?? []).map((job) => (
                <Link key={job.job_id} to={`/recruit/jobs/${job.job_id}`} className="rx-job-tile rx-spot">
                  <span className={`rx-status rx-status--${job.status}`}>{job.status}</span>
                  <strong>{job.title}</strong>
                  <span>{job.department || '未填写部门'} · {job.location || '未填写地点'}</span>
                  <em><b>{job.candidate_count}</b> 位候选人 <ArrowUpRight size={13} /></em>
                </Link>
              ))}
              {!dashboard?.open_jobs.length && !loading ? (
                <EmptyState icon={<BriefcaseBusiness size={20} />} title="还没有岗位" hint="先建立一个岗位需求。" action={{ to: '/recruit/jobs', label: '新建岗位' }} />
              ) : null}
            </div>
          </SectionCard>
        </div>
      </div>
    </RecruitPage>
  )
}
