import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { ErrorBanner, RecruitPage, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

export function RecruitJobDetailPage() {
  const { jobId = '' } = useParams()
  const { jobDetail, error, loadJobDetail, updateJob } = useRecruitStore(useShallow((state) => ({
    jobDetail: state.jobDetail,
    error: state.error,
    loadJobDetail: state.loadJobDetail,
    updateJob: state.updateJob
  })))
  const [status, setStatus] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (jobId) void loadJobDetail(jobId)
  }, [jobId, loadJobDetail])

  return (
    <RecruitPage title={jobDetail?.job.title || '岗位详情'} description="从岗位视角浏览 JD、候选人队列和当前招聘阶段。">
      <ErrorBanner message={error} />
      {jobDetail ? (
        <div className="recruit-dashboard-grid">
          <SectionCard title="岗位信息" description="岗位负责人、JD 与关键要求。">
            <div className="recruit-job-profile">
              <dl className="recruit-definition-list">
                <div><dt>部门</dt><dd>{jobDetail.job.department || '未填写'}</dd></div>
                <div><dt>地点</dt><dd>{jobDetail.job.location || '未填写'}</dd></div>
                <div><dt>负责人</dt><dd>{jobDetail.job.hiring_manager || '未填写'}</dd></div>
                <div><dt>Recruiter</dt><dd>{jobDetail.job.recruiter || '未填写'}</dd></div>
              </dl>
              <section className="recruit-copy-section">
                <p>岗位描述</p>
                <div>{jobDetail.job.description || '未填写岗位描述'}</div>
              </section>
              <section className="recruit-copy-section">
                <p>关键要求</p>
                <div>{jobDetail.job.requirements || '未填写关键要求'}</div>
              </section>
              <div className="recruit-status-control">
                <label>
                  <span>岗位状态</span>
                  <select value={status ?? jobDetail.job.status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="draft">draft</option>
                    <option value="open">open</option>
                    <option value="on_hold">on_hold</option>
                    <option value="closed">closed</option>
                  </select>
                </label>
                <button type="button" className="recruit-button recruit-button--primary" onClick={() => void updateJob(jobId, { status: status ?? jobDetail.job.status }).then(() => loadJobDetail(jobId))}>
                  更新状态
                </button>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="岗位 Pipeline" description="按阶段看候选人漏斗。">
            <div className="recruit-pipeline">
              {jobDetail.pipeline.map((item) => (
                <article key={item.stage}>
                  <p>{item.label}</p>
                  <strong>{item.count}</strong>
                </article>
              ))}
            </div>
            <div className="recruit-list recruit-list--top-spaced">
              {jobDetail.candidates.map((candidate) => (
                <Link key={candidate.candidate_id} to={`/recruit/candidates/${candidate.candidate_id}`} className="recruit-list-row recruit-list-row--link">
                  <div className="recruit-list-row__main">
                    <strong>{candidate.full_name}</strong>
                    <p>{candidate.current_stage} · {candidate.source_channel}</p>
                  </div>
                  <span className="recruit-count">{candidate.latest_screening?.total_score ?? '—'} 分</span>
                </Link>
              ))}
              {!jobDetail.candidates.length ? <p className="recruit-empty-state">还没有候选人投递到这个岗位。</p> : null}
            </div>
          </SectionCard>
        </div>
      ) : null}
    </RecruitPage>
  )
}
