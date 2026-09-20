import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { ErrorBanner, RecruitPage, ScoreBadge, SectionCard } from '@/features/recruit/components/RecruitPrimitives'
import type { CreateInterviewInput } from '@/features/recruit/lib/types'
import { useRecruitStore } from '@/features/recruit/store/recruitStore'

const DEFAULT_INTERVIEW: CreateInterviewInput = {
  interview_type: 'onsite',
  stage: 'interview',
  interviewer: '',
  scheduled_at: '',
  decision: '',
  score: '',
  notes: '',
  summary: ''
}

export function RecruitCandidateDetailPage() {
  const { candidateId = '' } = useParams()
  const { candidateDetail, error, loadCandidateDetail, moveCandidateStage, addInterview, rerunScreening } = useRecruitStore((state) => ({
    candidateDetail: state.candidateDetail,
    error: state.error,
    loadCandidateDetail: state.loadCandidateDetail,
    moveCandidateStage: state.moveCandidateStage,
    addInterview: state.addInterview,
    rerunScreening: state.rerunScreening
  }))
  const [stage, setStage] = useState<string | undefined>(undefined)
  const [resumeText, setResumeText] = useState<string | undefined>(undefined)
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [interview, setInterview] = useState<CreateInterviewInput>(DEFAULT_INTERVIEW)

  useEffect(() => {
    if (candidateId) void loadCandidateDetail(candidateId)
  }, [candidateId, loadCandidateDetail])

  const candidate = candidateDetail?.candidate

  return (
    <RecruitPage title={candidate?.full_name || '候选人详情'} description="查看完整档案、历次 AI 初筛、面试问题和面试历史。">
      <ErrorBanner message={error} />
      {candidateDetail ? (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-6">
            <SectionCard title="候选人档案" description={candidateDetail.job?.title || '未关联岗位'}>
              <div className="space-y-3 text-sm text-slate-300">
                <p><strong className="text-white">邮箱：</strong>{candidate?.email || '未填写'}</p>
                <p><strong className="text-white">电话：</strong>{candidate?.phone || '未填写'}</p>
                <p><strong className="text-white">来源：</strong>{candidate?.source_channel || '未填写'}</p>
                <p><strong className="text-white">当前阶段：</strong>{candidate?.current_stage}</p>
                <p><strong className="text-white">当前评级：</strong>{candidate?.ranking}</p>
                <div className="flex items-center gap-3">
                  <select value={stage ?? candidateDetail.candidate.current_stage} onChange={(event) => setStage(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white">
                    {candidateDetail.job?.stage_config.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                  <button type="button" className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950" onClick={() => void moveCandidateStage(candidateId, stage ?? candidateDetail.candidate.current_stage)}>
                    更新阶段
                  </button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="重新初筛" description="修改简历文本或上传新版简历后可再次评分。">
              <textarea value={resumeText ?? candidateDetail.resumes[0]?.parsed_text ?? ''} onChange={(event) => setResumeText(event.target.value)} rows={10} className="w-full rounded-3xl border border-white/10 bg-slate-900/80 px-4 py-4 text-sm text-white" />
              <input type="file" accept=".pdf,.docx,.txt,.md" className="mt-3 block w-full text-xs text-slate-300" onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)} />
              <button type="button" className="mt-4 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-medium text-white" onClick={() => void rerunScreening(candidateId, resumeText ?? candidateDetail.resumes[0]?.parsed_text ?? '', resumeFile)}>
                重新生成 AI 评分
              </button>
            </SectionCard>

            <SectionCard title="面试记录" description="真实沉淀每一轮面试。">
              <div className="grid gap-3 md:grid-cols-2">
                <input value={interview.interviewer} onChange={(event) => setInterview({ ...interview, interviewer: event.target.value })} placeholder="面试官" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
                <input value={interview.scheduled_at} onChange={(event) => setInterview({ ...interview, scheduled_at: event.target.value })} placeholder="2026-09-20T10:00:00" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
                <input value={interview.decision} onChange={(event) => setInterview({ ...interview, decision: event.target.value })} placeholder="结论" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
                <input value={interview.score} onChange={(event) => setInterview({ ...interview, score: event.target.value })} placeholder="分数" className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white" />
              </div>
              <textarea value={interview.notes} onChange={(event) => setInterview({ ...interview, notes: event.target.value })} rows={4} placeholder="记录亮点、风险与业务理解。" className="mt-3 w-full rounded-3xl border border-white/10 bg-slate-900/80 px-4 py-4 text-sm text-white" />
              <button type="button" className="mt-4 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950" onClick={() => void addInterview(candidateId, interview).then(() => setInterview(DEFAULT_INTERVIEW))}>
                保存面试记录
              </button>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard title="AI 初筛结果" description="来自正式持久化的 screening 记录。">
              {candidateDetail.screenings.map((screening) => (
                <article key={screening.screening_id} className="mb-4 rounded-3xl border border-white/8 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <strong className="text-sm text-white">{screening.recommendation}</strong>
                      <p className="mt-1 text-xs text-slate-400">{screening.created_at}</p>
                    </div>
                    <ScoreBadge score={screening.total_score} />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{screening.overall_summary}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {screening.dimension_scores.map((item) => (
                      <div key={`${screening.screening_id}-${item.key}`} className="rounded-2xl border border-white/8 bg-slate-900/70 p-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-white">{item.label}</span>
                          <span className="text-cyan-200">{item.score}/{item.max_score}</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-400">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </SectionCard>

            <SectionCard title="问题集与活动时间线" description="迁移自 ATS/Job tracker 的正式沉淀方式。">
              <div className="space-y-4">
                {candidateDetail.question_sets.map((item) => (
                  <div key={item.question_set_id} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                    <strong className="text-sm text-white">{item.title}</strong>
                    <ul className="mt-3 space-y-2 text-sm text-slate-300">
                      {item.questions.map((question) => <li key={question}>• {question}</li>)}
                    </ul>
                  </div>
                ))}
                {candidateDetail.activities.map((item) => (
                  <div key={item.activity_id} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                    <p className="text-sm text-white">{item.message}</p>
                    <p className="mt-1 text-xs text-slate-400">{item.created_at}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      ) : null}
    </RecruitPage>
  )
}
