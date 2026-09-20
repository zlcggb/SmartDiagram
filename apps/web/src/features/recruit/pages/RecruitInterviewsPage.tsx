import { useEffect } from 'react'

import { ErrorBanner, RecruitPage, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

export function RecruitInterviewsPage() {
  const { interviews, error, loadInterviews } = useRecruitStore((state) => ({
    interviews: state.interviews,
    error: state.error,
    loadInterviews: state.loadInterviews
  }))

  useEffect(() => {
    void loadInterviews()
  }, [loadInterviews])

  return (
    <RecruitPage title="面试流程中心" description="统一查看初试、复试、终试等历史记录，便于复盘和协同。">
      <ErrorBanner message={error} />
      <SectionCard title="面试记录" description="所有候选人的面试沉淀会汇总到这里。">
        <div className="space-y-3">
          {interviews.map((interview) => (
            <article key={interview.interview_id} className="rounded-3xl border border-white/8 bg-white/5 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong className="text-sm text-white">{interview.candidate_name || '候选人'}</strong>
                  <p className="mt-1 text-xs text-slate-400">{interview.stage} · {interview.interviewer} · {interview.decision || '待定'}</p>
                </div>
                <span className="text-sm text-cyan-200">{interview.score ?? '—'} 分</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{interview.notes || interview.summary || '暂无面试备注'}</p>
            </article>
          ))}
        </div>
      </SectionCard>
    </RecruitPage>
  )
}
