import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { ErrorBanner, RecruitPage, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

export function RecruitJobDetailPage() {
  const { jobId = '' } = useParams()
  const { jobDetail, error, loadJobDetail, updateJob } = useRecruitStore((state) => ({
    jobDetail: state.jobDetail,
    error: state.error,
    loadJobDetail: state.loadJobDetail,
    updateJob: state.updateJob
  }))
  const [status, setStatus] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (jobId) void loadJobDetail(jobId)
  }, [jobId, loadJobDetail])

  return (
    <RecruitPage title={jobDetail?.job.title || '岗位详情'} description="从岗位视角查看 JD、当前 pipeline 与已进入该岗位的候选人。">
      <ErrorBanner message={error} />
      {jobDetail ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionCard title="岗位信息" description="真实 ATS 的岗位管理入口。">
            <div className="space-y-4 text-sm text-slate-300">
              <p><strong className="text-white">部门：</strong>{jobDetail.job.department || '未填写'}</p>
              <p><strong className="text-white">地点：</strong>{jobDetail.job.location || '未填写'}</p>
              <p><strong className="text-white">负责人：</strong>{jobDetail.job.hiring_manager || '未填写'}</p>
              <p><strong className="text-white">Recruiter：</strong>{jobDetail.job.recruiter || '未填写'}</p>
              <div className="rounded-3xl border border-white/8 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">岗位描述</p>
                <p className="mt-3 whitespace-pre-wrap leading-6">{jobDetail.job.description || '未填写岗位描述'}</p>
              </div>
              <div className="rounded-3xl border border-white/8 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">关键要求</p>
                <p className="mt-3 whitespace-pre-wrap leading-6">{jobDetail.job.requirements || '未填写关键要求'}</p>
              </div>
              <div className="flex items-center gap-3">
                <select value={status ?? jobDetail.job.status} onChange={(event) => setStatus(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white">
                  <option value="draft">draft</option>
                  <option value="open">open</option>
                  <option value="on_hold">on_hold</option>
                  <option value="closed">closed</option>
                </select>
                <button type="button" className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950" onClick={() => void updateJob(jobId, { status: status ?? jobDetail.job.status }).then(() => loadJobDetail(jobId))}>
                  更新状态
                </button>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="岗位 Pipeline" description="按阶段看候选人漏斗。">
            <div className="grid gap-3 md:grid-cols-2">
              {jobDetail.pipeline.map((item) => (
                <article key={item.stage} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                  <strong className="mt-2 block text-2xl text-white">{item.count}</strong>
                </article>
              ))}
            </div>
            <div className="mt-6 space-y-3">
              {jobDetail.candidates.map((candidate) => (
                <a key={candidate.candidate_id} href={`/recruit/candidates/${candidate.candidate_id}`} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                  <div>
                    <strong className="text-sm text-white">{candidate.full_name}</strong>
                    <p className="mt-1 text-xs text-slate-400">{candidate.current_stage} · {candidate.source_channel}</p>
                  </div>
                  <span className="text-sm text-cyan-200">{candidate.latest_screening?.total_score ?? '—'} 分</span>
                </a>
              ))}
            </div>
          </SectionCard>
        </div>
      ) : null}
    </RecruitPage>
  )
}
