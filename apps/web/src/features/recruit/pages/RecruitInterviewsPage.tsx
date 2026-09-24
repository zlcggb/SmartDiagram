import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitPage, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

export function RecruitInterviewsPage() {
  const { interviews, error, loadInterviews } = useRecruitStore(useShallow((state) => ({
    interviews: state.interviews,
    error: state.error,
    loadInterviews: state.loadInterviews
  })))

  useEffect(() => {
    void loadInterviews()
  }, [loadInterviews])

  return (
    <RecruitPage title="面试" description="集中查看面试进展、面试官结论和需要复核的信号。">
      <ErrorBanner message={error} />
      <SectionCard title="面试记录" description="所有候选人的面试沉淀会汇总到这里。">
        <div className="recruit-interview-list">
          {interviews.map((interview) => (
            <article key={interview.interview_id} className="recruit-interview-row">
              <div className="recruit-interview-row__head">
                <div>
                  <strong>{interview.candidate_name || '候选人'}</strong>
                  <p>{interview.stage} · {interview.interviewer} · {interview.decision || '待定'}</p>
                </div>
                <span className="recruit-count">{interview.score ?? '—'} 分</span>
              </div>
              <p>{interview.notes || interview.summary || '暂无面试备注'}</p>
            </article>
          ))}
          {!interviews.length ? <p className="recruit-empty-state">还没有面试记录。完成候选人的面试后会在这里汇总。</p> : null}
        </div>
      </SectionCard>
    </RecruitPage>
  )
}
