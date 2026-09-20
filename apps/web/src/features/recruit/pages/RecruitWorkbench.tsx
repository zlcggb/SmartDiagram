import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, BrainCircuit, BriefcaseBusiness, FileUp, Sparkles, UserRoundPen } from 'lucide-react'

import { screenCandidate } from '@/features/recruit/lib/api'
import { recruitStorage } from '@/features/recruit/lib/storage'
import type { InterviewRecord, RecruitCandidateRecord } from '@/features/recruit/lib/types'

const DEFAULT_JD_TITLE = 'AI 应用产品工程师（销服前端 / 业务系统方向）'
const DEFAULT_JD_TEXT = `我们希望招聘一位偏应用落地的 AI 人才，能够理解销售、客服、运营或生产等业务流程，快速完成需求澄清、原型设计和 demo 交付。

核心要求：
1. 熟悉前端或全栈开发，能独立做出可演示的业务系统页面
2. 会用 AI 编程工具、Prompt、Agent/RAG/自动化工作流
3. 理解 CRM、销售支持、客服、运营、生产管理等业务系统优先
4. 能把需求拆解为 MVP，有业务思维和 demo 验证意识
5. 有个人网站、Github、Side Project 或自主创建经历加分

优先关注：
- 做过企业内部系统、运营后台、销售前台或生产协同系统
- 独立负责过从需求到上线的完整交付
- 能把 AI 与真实业务流程结合，而不只是做聊天机器人`

const LEARNING_REFERENCES = [
  {
    name: 'OpenCATS',
    focus: '招聘流程底座',
    summary: '参考其候选人状态流转、岗位管理和面试记录闭环。'
  },
  {
    name: 'Resume Matcher',
    focus: 'JD 匹配评分',
    summary: '参考其 JD 与简历匹配思路，用现有 AI 配置做初筛评分。'
  },
  {
    name: 'FreeATS',
    focus: '轻量人才库',
    summary: '参考其人才池、备注和复盘思路，用本地记录先验证流程。'
  }
]

function generateId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function RecruitWorkbench() {
  const [records, setRecords] = useState<RecruitCandidateRecord[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [jdTitle, setJdTitle] = useState(DEFAULT_JD_TITLE)
  const [jdText, setJdText] = useState(DEFAULT_JD_TEXT)
  const [candidateName, setCandidateName] = useState('')
  const [channel, setChannel] = useState('主动投递')
  const [resumeText, setResumeText] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [screeningError, setScreeningError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [interviewer, setInterviewer] = useState('')
  const [stage, setStage] = useState('初试')
  const [decision, setDecision] = useState('进入下一轮')
  const [interviewScore, setInterviewScore] = useState('')
  const [interviewNotes, setInterviewNotes] = useState('')

  useEffect(() => {
    const initialRecords = recruitStorage.list()
    setRecords(initialRecords)
    setSelectedRecordId(initialRecords[0]?.id ?? null)
  }, [])

  const selectedRecord = useMemo(
    () => records.find((item) => item.id === selectedRecordId) ?? null,
    [records, selectedRecordId]
  )

  const latestScreening = selectedRecord?.screening ?? null

  async function handleScreeningSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setScreeningError('')
    try {
      const screening = await screenCandidate({
        candidateName: candidateName.trim() || '候选人',
        channel: channel.trim(),
        jdText,
        resumeText,
        file: selectedFile
      })
      const record: RecruitCandidateRecord = {
        id: generateId('candidate'),
        candidateName: screening.candidate_name,
        channel: screening.channel || channel,
        jdTitle,
        jdText,
        resumeDraft: resumeText.slice(0, 3000),
        createdAt: new Date().toISOString(),
        screening,
        interviews: []
      }
      const nextRecords = recruitStorage.save(record)
      setRecords(nextRecords)
      setSelectedRecordId(record.id)
    } catch (error) {
      setScreeningError(error instanceof Error ? error.message : '简历筛选失败')
    } finally {
      setSubmitting(false)
    }
  }

  function handleSaveInterview() {
    if (!selectedRecord) return
    if (!interviewNotes.trim()) return
    const nextInterview: InterviewRecord = {
      id: generateId('interview'),
      stage,
      interviewer: interviewer.trim() || '待填写',
      decision,
      score: interviewScore ? Number(interviewScore) : null,
      notes: interviewNotes.trim(),
      createdAt: new Date().toISOString()
    }
    const nextRecords = recruitStorage.appendInterview(selectedRecord.id, nextInterview)
    setRecords(nextRecords)
    setInterviewer('')
    setInterviewScore('')
    setInterviewNotes('')
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-7xl flex-col gap-6 overflow-auto px-4 py-5 text-slate-100 md:px-6">
      <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.45)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
              <BrainCircuit size={14} />
              AI 招聘筛选 Demo
            </span>
            <div>
              <h1 className="text-3xl font-semibold text-white">在 SmartDiagram 内新增招聘筛选模块</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                结合优秀开源项目的流程设计思路，用当前项目现有 AI 配置完成 JD 编辑、简历初筛、候选人记录与面试追踪。
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {LEARNING_REFERENCES.map((item) => (
              <article key={item.name} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{item.focus}</p>
                <strong className="mt-2 block text-sm text-white">{item.name}</strong>
                <p className="mt-2 text-xs leading-5 text-slate-300">{item.summary}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.95fr_1.1fr]">
        <form onSubmit={handleScreeningSubmit} className="space-y-6 rounded-[28px] border border-white/10 bg-slate-950/70 p-6 backdrop-blur">
          <header className="flex items-center gap-3">
            <BriefcaseBusiness className="text-cyan-200" />
            <div>
              <h2 className="text-lg font-semibold text-white">岗位 JD</h2>
              <p className="text-sm text-slate-400">先定义要招什么人，再让 AI 按同一把尺子筛选简历。</p>
            </div>
          </header>
          <label className="block space-y-2">
            <span className="text-sm text-slate-300">岗位名称</span>
            <input
              value={jdTitle}
              onChange={(event) => setJdTitle(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm text-slate-300">JD 内容</span>
            <textarea
              value={jdText}
              onChange={(event) => setJdText(event.target.value)}
              rows={18}
              className="w-full rounded-3xl border border-white/10 bg-slate-900/80 px-4 py-4 text-sm leading-6 text-white outline-none transition focus:border-cyan-300/60"
            />
          </label>
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles size={16} />
              当前评分重点
            </div>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-emerald-50/90">
              <li>• AI 应用与编程实践</li>
              <li>• 前端 / 全栈交付能力</li>
              <li>• 业务系统经验与需求理解</li>
              <li>• 作品、自驱与沟通稳定性</li>
            </ul>
          </div>
        </form>

        <form onSubmit={handleScreeningSubmit} className="space-y-6 rounded-[28px] border border-white/10 bg-slate-950/70 p-6 backdrop-blur">
          <header className="flex items-center gap-3">
            <FileUp className="text-violet-200" />
            <div>
              <h2 className="text-lg font-semibold text-white">候选人初筛</h2>
              <p className="text-sm text-slate-400">支持贴简历文本，或上传 PDF / DOCX / TXT。</p>
            </div>
          </header>
          <label className="block space-y-2">
            <span className="text-sm text-slate-300">候选人姓名</span>
            <input
              value={candidateName}
              onChange={(event) => setCandidateName(event.target.value)}
              placeholder="例如：张三"
              className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-300/60"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm text-slate-300">来源渠道</span>
            <input
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-300/60"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm text-slate-300">简历文本（可选）</span>
            <textarea
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              rows={14}
              placeholder="可直接粘贴简历、项目经历、作品链接与面试备注。"
              className="w-full rounded-3xl border border-white/10 bg-slate-900/80 px-4 py-4 text-sm leading-6 text-white outline-none transition focus:border-violet-300/60"
            />
          </label>
          <label className="flex cursor-pointer flex-col gap-2 rounded-3xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-slate-300 transition hover:border-violet-300/50">
            <span>上传简历文件</span>
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            <span className="rounded-2xl bg-slate-900/80 px-3 py-3 text-xs text-slate-200">
              {selectedFile ? `已选择：${selectedFile.name}` : '点击选择 PDF / DOCX / TXT / MD'}
            </span>
          </label>
          {screeningError ? (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {screeningError}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:bg-violet-500/60"
          >
            <BadgeCheck size={16} />
            {submitting ? 'AI 评分中…' : '开始 AI 初筛'}
          </button>
        </form>

        <section className="space-y-6 rounded-[28px] border border-white/10 bg-slate-950/70 p-6 backdrop-blur">
          <header className="flex items-center gap-3">
            <UserRoundPen className="text-amber-200" />
            <div>
              <h2 className="text-lg font-semibold text-white">候选人结果与面试记录</h2>
              <p className="text-sm text-slate-400">每次筛选都会沉淀下来，方便继续追踪下一轮面试。</p>
            </div>
          </header>

          <div className="grid gap-3">
            {records.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-400">
                还没有候选人记录，先用左侧表单做一次筛选。
              </div>
            ) : (
              records.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => setSelectedRecordId(record.id)}
                  className="rounded-3xl border px-4 py-4 text-left transition"
                  style={{
                    borderColor: selectedRecordId === record.id ? 'rgba(56,189,248,0.55)' : 'rgba(255,255,255,0.08)',
                    background: selectedRecordId === record.id ? 'rgba(8,47,73,0.55)' : 'rgba(255,255,255,0.04)'
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong className="text-sm text-white">{record.candidateName}</strong>
                      <p className="mt-1 text-xs text-slate-400">{record.channel} · {record.jdTitle}</p>
                    </div>
                    <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                      {record.screening.total_score} / 100
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-300">{record.screening.recommendation}</p>
                </button>
              ))
            )}
          </div>

          {latestScreening ? (
            <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/75 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-white">{selectedRecord?.candidateName}</h3>
                  <p className="mt-1 text-sm text-slate-400">{latestScreening.recommendation} · {latestScreening.evaluation_mode === 'ai' ? 'AI 评分' : '规则兜底'}</p>
                </div>
                <div className="rounded-3xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-center">
                  <strong className="block text-2xl text-cyan-100">{latestScreening.total_score}</strong>
                  <span className="text-xs text-cyan-200/80">总分 / {latestScreening.max_score}</span>
                </div>
              </div>
              <p className="text-sm leading-6 text-slate-300">{latestScreening.overall_summary}</p>
              <div className="space-y-3">
                {latestScreening.dimension_scores.map((item) => (
                  <div key={item.key} className="rounded-2xl border border-white/8 bg-white/5 p-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-white">{item.label}</span>
                      <strong className="text-cyan-200">{item.score} / {item.max_score}</strong>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-400">{item.reason}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">亮点</p>
                  <ul className="mt-3 space-y-2 text-sm text-emerald-50">
                    {latestScreening.strengths.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-amber-200">风险点</p>
                  <ul className="mt-3 space-y-2 text-sm text-amber-50">
                    {latestScreening.risks.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">建议面试问题</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-200">
                  {latestScreening.interview_questions.map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </div>
            </div>
          ) : null}

          {selectedRecord ? (
            <section className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/75 p-5">
              <h3 className="text-base font-semibold text-white">面试记录</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={stage}
                  onChange={(event) => setStage(event.target.value)}
                  placeholder="轮次"
                  className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
                />
                <input
                  value={interviewer}
                  onChange={(event) => setInterviewer(event.target.value)}
                  placeholder="面试官"
                  className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
                />
                <input
                  value={decision}
                  onChange={(event) => setDecision(event.target.value)}
                  placeholder="结论"
                  className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
                />
                <input
                  value={interviewScore}
                  onChange={(event) => setInterviewScore(event.target.value)}
                  placeholder="评分（可选）"
                  inputMode="numeric"
                  className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
                />
              </div>
              <textarea
                value={interviewNotes}
                onChange={(event) => setInterviewNotes(event.target.value)}
                rows={4}
                placeholder="记录优势、风险、是否进入下一轮等。"
                className="w-full rounded-3xl border border-white/10 bg-slate-950/70 px-4 py-4 text-sm text-white outline-none"
              />
              <button
                type="button"
                onClick={handleSaveInterview}
                className="inline-flex items-center rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
              >
                保存面试记录
              </button>
              <div className="space-y-3">
                {selectedRecord.interviews.length === 0 ? (
                  <p className="text-sm text-slate-400">还没有面试记录。</p>
                ) : selectedRecord.interviews.map((item) => (
                  <article key={item.id} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>{item.stage}</span>
                      <span>·</span>
                      <span>{item.interviewer}</span>
                      <span>·</span>
                      <span>{item.decision}</span>
                      {item.score !== null ? (
                        <>
                          <span>·</span>
                          <span>{item.score} 分</span>
                        </>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-200">{item.notes}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      </section>
    </main>
  )
}
