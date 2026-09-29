import { useEffect } from 'react'
import { CalendarClock, UserRound } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitPage, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { Avatar, EmptyState, ScoreRing, StageChip } from '@/features/recruit/components/RecruitUI'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

const formatDate = (value: string | null) => {
  if (!value) return '未排期'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function RecruitInterviewsPage() {
  const { interviews, error, loadInterviews, loading } = useRecruitStore(useShallow((state) => ({
    interviews: state.interviews,
    error: state.error,
    loadInterviews: state.loadInterviews,
    loading: state.loading,
  })))

  useEffect(() => {
    void loadInterviews()
  }, [loadInterviews])

  return (
    <RecruitPage title="面试流程" eyebrow="Loops · 面试" description="集中查看面试进展、面试官结论和需要复核的信号。">
      <ErrorBanner message={error} />
      <SectionCard
        title="面试时间线"
        description="所有候选人的面试沉淀按时间汇总。"
        icon={<CalendarClock size={15} />}
        aside={<span className="rx-count-pill">{interviews.length} 场</span>}
      >
        <ol className="rx-timeline">
          {interviews.map((interview, index) => (
            <li key={interview.interview_id} className="rx-timeline__item" style={{ ['--i' as string]: index }}>
              <span className="rx-timeline__node" aria-hidden="true" />
              <article className="rx-timeline__card rx-spot">
                <header>
                  <Avatar name={interview.candidate_name} size={36} />
                  <div>
                    <strong>{interview.candidate_name || '候选人'}</strong>
                    <p><UserRound size={12} />{interview.interviewer || '未指定面试官'} · {formatDate(interview.scheduled_at || interview.created_at)}</p>
                  </div>
                  <StageChip stage={interview.stage} />
                  <span className={`rx-decision rx-decision--${interview.decision || 'pending'}`}>{interview.decision || '待定'}</span>
                  {typeof interview.score === 'number' ? <ScoreRing score={interview.score} size={42} stroke={4} /> : null}
                </header>
                <p>{interview.notes || interview.summary || '暂无面试备注'}</p>
              </article>
            </li>
          ))}
        </ol>
        {!interviews.length && !loading ? (
          <EmptyState icon={<CalendarClock size={20} />} title="还没有面试记录" hint="在候选人档案中记录面试后，会在这里形成时间线。" action={{ to: '/recruit/candidates', label: '去候选人中心' }} />
        ) : null}
      </SectionCard>
    </RecruitPage>
  )
}
