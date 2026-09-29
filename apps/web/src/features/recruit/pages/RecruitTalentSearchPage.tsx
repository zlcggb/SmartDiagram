import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BriefcaseBusiness, Check, ChevronDown, FileSearch, FileUp, History, LoaderCircle, Plus, RotateCcw, Send, Sparkles, UsersRound, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorBanner, RecruitPage } from '@/features/recruit/components/RecruitPrimitives'
import { RecruitScoreReport } from '@/features/recruit/components/RecruitScoreReport'
import { AiLoader, EmptyState, ScoreRing } from '@/features/recruit/components/RecruitUI'
import { appendRecruitSearchTurn, createRecruitSearchConversation, fetchRecruitJobs, fetchRecruitSearchConversation, fetchRecruitSearchConversations, previewRecruitJd, retryRecruitSearchTurn, streamRecruitSearchProgress, type RecruitSearchConversation, type RecruitSearchProgressEvent, type RecruitSearchSummary, type RecruitSearchTurn, type RecruitTalentMatches } from '@/features/recruit/lib/api'
import type { RecruitJobSummary, RecruitRubric } from '@/features/recruit/lib/types'

type TalentSource = { label: string; title: string; text: string; kind: 'job' | 'file' }

const SUGGESTIONS = [
  '找做过 AI 项目、熟悉 React 的应届生',
  '寻找有 CRM 经验、擅长跨团队协作的产品经理',
  '找在深圳、有制造业数字化经验的全栈工程师',
]

type TalentSearchProcessPhase = 'done' | 'active' | 'upcoming' | 'attention' | 'error'

function TalentSearchProcess({
  status,
  rubric,
  matches,
  events,
  pendingChanges,
  interactive,
  onAdjustCriteria,
  onRefineSearch,
}: {
  status: RecruitSearchTurn['status']
  rubric: RecruitRubric | null | undefined
  matches: RecruitTalentMatches | null | undefined
  events: RecruitSearchProgressEvent[]
  pendingChanges: boolean
  interactive: boolean
  onAdjustCriteria: () => void
  onRefineSearch: () => void
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const steps = [
    { node: 'requirements', title: '拆解岗位需求' },
    { node: 'resume_scan', title: '读取人才库简历' },
    { node: 'keyword_retrieval', title: '关键词召回' },
    { node: 'evaluation', title: '逐份评估' },
    { node: 'ranking', title: '排序并生成结果' },
  ] as const
  const lastEvent = events.at(-1)
  const lastActiveEvent = [...events].reverse().find((event) => event.status === 'started' || event.status === 'progress')
  const fallbackNode = status === 'analyzing' ? 'requirements' : status === 'matching' ? 'resume_scan' : null
  const lastEventIndex = lastEvent ? steps.findIndex((step) => step.node === lastEvent.node) : -1
  const activeNode = status === 'completed' || status === 'failed'
    ? null
    : lastEvent?.status === 'completed'
      ? steps[Math.min(lastEventIndex + 1, steps.length - 1)]?.node ?? fallbackNode
      : lastActiveEvent?.node ?? fallbackNode
  const failedEvent = [...events].reverse().find((event) => event.status === 'failed')
  const completedNodes = new Set(events.filter((event) => event.status === 'completed').map((event) => event.node))
  const defaultNode = pendingChanges ? 'keyword_retrieval' : status === 'completed' ? 'ranking' : failedEvent?.node ?? activeNode ?? fallbackNode ?? 'requirements'
  const selectedStepIndex = selectedIndex ?? Math.max(0, steps.findIndex((step) => step.node === defaultNode))
  const phaseLabels: Record<TalentSearchProcessPhase, string> = {
    done: '已完成',
    active: '进行中',
    upcoming: '待执行',
    attention: '待重跑',
    error: '已中断',
  }
  function getPhase(stepIndex: number): TalentSearchProcessPhase {
    const step = steps[stepIndex]
    if (status === 'failed') {
      const failedIndex = steps.findIndex((item) => item.node === (failedEvent?.node ?? (rubric ? 'resume_scan' : 'requirements')))
      return stepIndex < failedIndex ? 'done' : stepIndex === failedIndex ? 'error' : 'upcoming'
    }
    if (pendingChanges) return stepIndex === 0 ? 'done' : stepIndex === 2 ? 'attention' : 'upcoming'
    if (status === 'completed') return 'done'
    if (completedNodes.has(step.node)) return 'done'
    const activeIndex = steps.findIndex((item) => item.node === activeNode)
    if (stepIndex === activeIndex) return 'active'
    return activeIndex > stepIndex ? 'done' : 'upcoming'
  }

  const selectedStep = steps[selectedStepIndex]
  const selectedPhase = getPhase(selectedStepIndex)
  const selectedEvent = [...events].reverse().find((event) => event.node === selectedStep.node)
  const stepDetails: Record<(typeof steps)[number]['node'], string> = {
    requirements: rubric
      ? `已整理 ${rubric.requirements.length} 项评分要求、${rubric.knockouts.length} 项硬性门槛。可展开评分依据检查细项。`
      : '从 JD 中提取岗位目标、评分要求与硬性门槛。',
    resume_scan: matches
      ? `检查人才库候选档案并读取最新可解析简历；本次召回 ${matches.total} 份。`
      : '按组织权限检查候选档案，并读取每位候选人最新的可解析简历。',
    keyword_retrieval: '从 JD 与评分标准提取关键词，统计简历命中数并预排序。',
    evaluation: matches
      ? `评估完成 ${matches.evaluated} / ${matches.total} 份简历。`
      : '按关键词预排序，对最多 8 份简历逐一进行人岗评估。',
    ranking: matches
      ? `评估完成 ${matches.evaluated} / ${matches.total} 份简历，按评估总分排序。`
      : '所有评估完成后，按人岗评分总分排序。',
  }
  const detail = pendingChanges && selectedStep.node !== 'requirements'
    ? '评分标准已调整，重新匹配后才会生成与新条件一致的候选人清单。'
    : selectedPhase === 'error'
      ? selectedEvent?.detail || '当前步骤已中断，请查看错误提示后重试。'
      : selectedEvent?.detail || stepDetails[selectedStep.node]
  const keywordTerms = selectedStep.node === 'keyword_retrieval' ? selectedEvent?.data?.keyword_terms ?? [] : []
  const candidateProgress = new Map<number, RecruitSearchProgressEvent>()
  for (const event of events) {
    if (event.node === 'evaluation' && event.data?.candidate_index) candidateProgress.set(event.data.candidate_index, event)
  }
  const candidateEvents = [...candidateProgress.values()].sort((left, right) => (left.data?.candidate_index ?? 0) - (right.data?.candidate_index ?? 0))

  function showCandidateStatus(event: RecruitSearchProgressEvent) {
    const data = event.data
    if (data?.evaluation_status === 'completed') return `得分 ${data.score ?? 0} / ${data.max_score ?? 100}`
    return '评估中'
  }

  return (
    <section className="recruit-talent-process" aria-label="人才匹配流程">
      <ol className="recruit-talent-process__steps">
        {steps.map((step, stepIndex) => {
          const phase = getPhase(stepIndex)
          const selected = selectedStepIndex === stepIndex
          return (
            <li className={`recruit-talent-process__item is-${phase}`} key={step.title}>
              <button
                type="button"
                className={`recruit-talent-process__step${selected ? ' is-selected' : ''}`}
                aria-current={phase === 'active' ? 'step' : undefined}
                aria-pressed={selected}
                aria-label={`${step.title}，${phaseLabels[phase]}`}
                onClick={() => setSelectedIndex(stepIndex)}
              >
                <span className="recruit-talent-process__marker" aria-hidden="true">
                  {phase === 'done' ? <Check size={14} /> : phase === 'active' ? <LoaderCircle className="recruit-talent-process__spinner" size={14} /> : phase === 'error' ? <X size={14} /> : phase === 'attention' ? '!' : String(stepIndex + 1).padStart(2, '0')}
                </span>
                <span className="recruit-talent-process__step-copy">
                  <strong>{step.title}</strong>
                  <small>{phaseLabels[phase]}</small>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className={`recruit-talent-process__detail is-${selectedPhase}`} aria-live="polite">
        <span className="recruit-talent-process__detail-index">{String(selectedStepIndex + 1).padStart(2, '0')}</span>
        <div>
          <strong>{selectedStep.title}</strong>
          <p>{detail}</p>
          {keywordTerms.length > 0 ? <ul className="recruit-talent-process__keywords" aria-label="本次检索关键词">{keywordTerms.map((term) => <li key={term}>{term}</li>)}</ul> : null}
          {selectedStep.node === 'evaluation' && candidateEvents.length > 0 ? (
            <ol className="recruit-talent-process__candidate-progress" aria-label="逐份简历评估进度">
              {candidateEvents.map((event) => (
                <li className={event.data?.evaluation_status === 'completed' ? 'is-complete' : 'is-active'} key={event.data?.candidate_index}>
                  <span>{String(event.data?.candidate_index ?? 0).padStart(2, '0')}</span>
                  <strong>{event.data?.candidate_name || '未命名候选人'}</strong>
                  <small>{showCandidateStatus(event)}</small>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </div>
      {interactive && status === 'completed' && !pendingChanges && rubric && matches ? (
        <div className="recruit-talent-process__actions" role="group" aria-label="匹配后的下一步操作">
          <span>继续调整</span>
          <button type="button" onClick={onAdjustCriteria}>调整评分标准</button>
          <button type="button" onClick={onRefineSearch}>补充招聘条件</button>
        </div>
      ) : null}
    </section>
  )
}

export function RecruitTalentSearchPage() {
  const [jobs, setJobs] = useState<RecruitJobSummary[]>([])
  const [draft, setDraft] = useState('')
  const [source, setSource] = useState<TalentSource | null>(null)
  const [query, setQuery] = useState<{ title: string; text: string } | null>(null)
  const [turns, setTurns] = useState<RecruitSearchTurn[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [history, setHistory] = useState<RecruitSearchSummary[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [activeTurnId, setActiveTurnId] = useState(0)
  const [rubric, setRubric] = useState<RecruitRubric | null>(null)
  const [rubricChanged, setRubricChanged] = useState(false)
  const [matches, setMatches] = useState<RecruitTalentMatches | null>(null)
  const [selectedIds, setSelectedIds] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<'upload' | 'analyze' | 'match' | null>(null)
  const [error, setError] = useState('')
  const [attachOpen, setAttachOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const criteriaDetailsRef = useRef<HTMLDetailsElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const viewVersionRef = useRef(0)
  const conversationIdRef = useRef<string | null>(null)
  const turnsRef = useRef(turns)
  turnsRef.current = turns

  useEffect(() => {
    let active = true
    void fetchRecruitJobs().then((items) => { if (active) setJobs(items) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const version = viewVersionRef.current
    void fetchRecruitSearchConversations().then(async (items) => {
      if (!active || viewVersionRef.current !== version) return
      setHistory(items)
      if (items.length) {
        const conversation = await fetchRecruitSearchConversation(items[0].id)
        if (active && viewVersionRef.current === version) showConversation(conversation)
      }
    }).catch((cause) => {
      if (active && viewVersionRef.current === version) setError(cause instanceof Error ? cause.message : '读取对话记录失败。')
    }).finally(() => { if (active) setLoadingHistory(false) })
    return () => { active = false; viewVersionRef.current += 1 }
  }, [])

  useEffect(() => {
    if (!conversationId || !activeTurnId || (busy !== 'analyze' && busy !== 'match')) return
    const activeConversationId = conversationId
    let active = true
    let retryTimer: number | undefined
    let lastEventId = turnsRef.current.find((turn) => turn.id === activeTurnId)?.events?.at(-1)?.id ?? 0
    const controller = new AbortController()

    async function refreshConversation() {
      const conversation = await fetchRecruitSearchConversation(activeConversationId)
      if (!active || conversationIdRef.current !== activeConversationId) return null
      showConversation(conversation)
      return conversation
    }

    async function connect() {
      while (active) {
        try {
          lastEventId = await streamRecruitSearchProgress(
            activeConversationId,
            lastEventId,
            (event) => {
              lastEventId = Math.max(lastEventId, event.id)
              if (conversationIdRef.current !== activeConversationId) return
              setTurns((current) => current.map((turn) => {
                if (turn.id !== activeTurnId) return turn
                const events = turn.events ?? []
                if (events.some((existing) => existing.id === event.id)) return turn
                return { ...turn, events: [...events, event].sort((left, right) => left.id - right.id) }
              }))
            },
            controller.signal,
          )
          if (!active) return
          const conversation = await refreshConversation()
          if (!conversation || (conversation.status !== 'analyzing' && conversation.status !== 'matching')) return
        } catch {
          if (!active || controller.signal.aborted) return
          let conversation: RecruitSearchConversation | null = null
          try {
            conversation = await refreshConversation()
          } catch (refreshCause) {
            setError(refreshCause instanceof Error ? refreshCause.message : '刷新检索状态失败，正在重连。')
          }
          if (!active || !conversation || (conversation.status !== 'analyzing' && conversation.status !== 'matching')) return
          await new Promise<void>((resolve) => { retryTimer = window.setTimeout(resolve, 1200) })
        }
      }
    }

    void connect()
    return () => {
      active = false
      controller.abort()
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [conversationId, busy, activeTurnId])

  function showConversation(conversation: RecruitSearchConversation) {
    conversationIdRef.current = conversation.id
    setConversationId(conversation.id)
    setQuery({ title: conversation.jd_title, text: conversation.jd_text })
    setSource(conversation.source?.kind === 'job' || conversation.source?.kind === 'file' ? conversation.source as TalentSource : null)
    setTurns(conversation.turns)
    const last = conversation.turns.at(-1)
    setActiveTurnId(last?.id ?? 0)
    setRubric(last?.rubric ?? null)
    setMatches(last?.matches ?? null)
    setRubricChanged(false)
    setBusy(conversation.status === 'analyzing' ? 'analyze' : conversation.status === 'matching' ? 'match' : null)
    setError('')
    setHistory((items) => [
      { id: conversation.id, title: conversation.title, status: conversation.status, updated_at: conversation.updated_at },
      ...items.filter((item) => item.id !== conversation.id),
    ])
  }

  function resetSearch() {
    viewVersionRef.current += 1
    conversationIdRef.current = null
    setConversationId(null)
    setQuery(null)
    setTurns([])
    setActiveTurnId(0)
    setRubric(null)
    setRubricChanged(false)
    setMatches(null)
    setSelectedIds({})
    setError('')
  }

  function chooseJob(job: RecruitJobSummary) {
    const text = [job.description, job.requirements].filter(Boolean).join('\n\n')
    if (!text) { setError('该岗位还没有 JD，请先在岗位中心补充内容。'); return }
    resetSearch()
    setSource({ label: job.title, title: job.title, text, kind: 'job' })
    setAttachOpen(false)
  }

  async function handleFile(file: File | null) {
    if (!file) return
    setBusy('upload')
    setError('')
    try {
      const preview = await previewRecruitJd(file)
      resetSearch()
      setSource({ label: file.name, title: file.name.replace(/\.[^.]+$/, ''), text: preview.parsed_text, kind: 'file' })
      setAttachOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'JD 文件解析失败，请粘贴需求重试。')
    } finally {
      setBusy(null)
    }
  }

  async function submit(message = draft) {
    const text = message.trim()
    if (busy || loadingHistory || (!text && (!source || query))) return
    const title = source?.title || query?.title || '人才检索'
    const nextText = [query?.text || source?.text, text && (query ? `补充条件：${text}` : text)].filter(Boolean).join('\n\n')
    if (!nextText.trim()) { setError('请描述想找的人，或引用一个有 JD 的岗位。'); return }
    const version = viewVersionRef.current
    const currentId = conversationIdRef.current
    setAttachOpen(false)
    setBusy('analyze')
    setError('')
    try {
      const conversation = currentId
        ? await appendRecruitSearchTurn(currentId, text)
        : await createRecruitSearchConversation({ jdTitle: title, jdText: nextText, message: text, source })
      if (viewVersionRef.current !== version) return
      setDraft('')
      showConversation(conversation)
    } catch (cause) {
      if (viewVersionRef.current === version) {
        setBusy(null)
        setError(cause instanceof Error ? cause.message : '提交招聘需求失败，请重试。')
      }
    }
  }

  async function retry(existingRubric?: RecruitRubric) {
    const currentId = conversationIdRef.current
    if (!currentId || busy) return
    const version = viewVersionRef.current
    setBusy(existingRubric ? 'match' : 'analyze')
    setError('')
    try {
      const conversation = await retryRecruitSearchTurn(currentId, existingRubric)
      if (viewVersionRef.current === version) showConversation(conversation)
    } catch (cause) {
      if (viewVersionRef.current === version) {
        setBusy(null)
        setError(cause instanceof Error ? cause.message : '重新匹配失败，请重试。')
      }
    }
  }

  async function openConversation(id: string) {
    const version = ++viewVersionRef.current
    conversationIdRef.current = null
    setConversationId(null)
    setHistoryOpen(false)
    setLoadingHistory(true)
    setBusy(null)
    setError('')
    try {
      const conversation = await fetchRecruitSearchConversation(id)
      if (viewVersionRef.current === version) { setSelectedIds({}); showConversation(conversation) }
    } catch (cause) {
      if (viewVersionRef.current === version) setError(cause instanceof Error ? cause.message : '恢复对话失败。')
    } finally {
      if (viewVersionRef.current === version) setLoadingHistory(false)
    }
  }

  function updateRubric(next: RecruitRubric) {
    setRubric(next)
    setRubricChanged(true)
    setMatches(null)
    setSelectedIds((current) => ({ ...current, [activeTurnId]: '' }))
  }

  function newConversation() {
    resetSearch()
    setSource(null)
    setDraft('')
    setAttachOpen(false)
    setHistoryOpen(false)
    setBusy(null)
  }

  function openCriteria() {
    const details = criteriaDetailsRef.current
    if (!details) return
    details.open = true
    details.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function focusComposer() {
    composerRef.current?.focus()
  }

  return (
    <RecruitPage title="AI 找人才" description="用一句话描述招聘需求，从人才库中找到值得优先联系的人。" hideHeader className="recruit-page--talent-chat">
      <div className="recruit-talent-chat">
        <header className="recruit-talent-chat__topbar">
          <div className="recruit-talent-chat__identity">
            <span className="recruit-talent-chat__mark"><Sparkles size={19} /></span>
            <div><span>TALENT ATLAS / SEARCH</span><h2>AI 找人才</h2></div>
          </div>
          <div className="recruit-talent-chat__top-actions">
            <div className="recruit-talent-chat__history-control">
              <button type="button" title="对话记录" aria-label="对话记录" aria-expanded={historyOpen} aria-controls="recruit-search-history-menu" onClick={() => setHistoryOpen((open) => !open)}><History size={17} /></button>
              {historyOpen ? <div id="recruit-search-history-menu" className="recruit-talent-chat__history-menu">
                <strong>对话记录</strong>
                {history.length ? history.map((item) => <button type="button" key={item.id} className={item.id === conversationId ? 'is-active' : ''} onClick={() => void openConversation(item.id)}><span>{item.title}</span><small>{item.status === 'analyzing' || item.status === 'matching' ? '进行中' : new Date(item.updated_at).toLocaleDateString('zh-CN')}</small></button>) : <p>暂无对话记录</p>}
              </div> : null}
            </div>
            {turns.length > 0 ? <button type="button" title="新对话" aria-label="新对话" onClick={newConversation}><RotateCcw size={17} /></button> : null}
            <Link to="/recruit/screen?mode=single">单份简历评估 <ArrowUpRight size={14} /></Link>
          </div>
        </header>

        <div className={`recruit-talent-chat__history${turns.length ? ' has-turns' : ''}`}>
          {loadingHistory ? <div className="recruit-talent-chat__loading" role="status"><AiLoader label="正在恢复对话记录" /></div> : turns.length === 0 ? (
            busy === 'analyze' ? (
              <div className="recruit-talent-chat__initial-process">
                <TalentSearchProcess status="analyzing" rubric={null} matches={null} events={[]} pendingChanges={false} interactive={false} onAdjustCriteria={openCriteria} onRefineSearch={focusComposer} />
              </div>
            ) : (
              <div className="recruit-talent-chat__welcome" data-recruit-reveal>
                <span className="recruit-talent-chat__welcome-mark"><Sparkles size={22} /></span>
                <h3>这次，想找什么样的人？</h3>
                <p>从一句话开始，寻找值得优先联系的候选人。</p>
                <div className="recruit-talent-chat__suggestions">
                  {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" disabled={busy !== null} onClick={() => void submit(suggestion)}>{suggestion}<ArrowUpRight size={15} /></button>)}
                </div>
              </div>
            )
          ) : turns.map((turn) => {
            const active = turn.id === activeTurnId
            const turnRubric = active ? rubric : turn.rubric
            const turnMatches = active ? matches : turn.matches
            const turnSelected = turnMatches?.matches.find(({ candidate }) => candidate.candidate_id === (selectedIds[turn.id] || turnMatches.matches[0]?.candidate.candidate_id))
            const processBusy = active && (busy === 'analyze' || busy === 'match')
            const processStatus: RecruitSearchTurn['status'] = processBusy ? busy === 'analyze' ? 'analyzing' : 'matching' : turn.status
            const showProcess = Boolean(turnRubric || turnMatches || processBusy || turn.status === 'failed')
            return (
            <div className="recruit-talent-chat__turn" key={turn.id}>
              <div className="recruit-talent-chat__user-message">{turn.text}</div>
              <div className="recruit-talent-chat__assistant">
                <span className="recruit-talent-chat__assistant-mark"><Sparkles size={16} /></span>
                <div className="recruit-talent-chat__response">
                  <>
                      {showProcess ? <TalentSearchProcess status={processStatus} rubric={turnRubric} matches={turnMatches} events={turn.events ?? []} pendingChanges={active && rubricChanged} interactive={active && !busy} onAdjustCriteria={openCriteria} onRefineSearch={focusComposer} /> : null}
                      {turn.error && (!active || !busy) ? <div className="recruit-talent-chat__error" role="alert"><p>{turn.error}</p>{active ? <button type="button" onClick={() => void retry(rubric || undefined)}>重试</button> : null}</div> : null}
                      {turnRubric ? (
                        <>
                          <h3>{turnMatches ? '本次匹配结果' : '已整理招聘条件'}</h3>
                          <p className="recruit-talent-chat__summary">{turnRubric.role_summary}</p>
                          <details ref={active ? criteriaDetailsRef : undefined} className="recruit-talent-chat__criteria">
                            <summary><span>评分依据 · {turnRubric.requirements.length} 项要求{turnRubric.knockouts.length ? ` / ${turnRubric.knockouts.length} 项门槛` : ''}</span><ChevronDown size={15} /></summary>
                            {turnRubric.knockouts.length > 0 ? (
                              <div className="recruit-talent-chat__knockouts"><span>硬性门槛</span>{turnRubric.knockouts.map((item) => <span key={item.key}>{item.label}{active ? <button type="button" disabled={busy !== null} title={`移除 ${item.label}`} aria-label={`移除 ${item.label}`} onClick={() => updateRubric({ ...turnRubric, knockouts: turnRubric.knockouts.filter((entry) => entry.key !== item.key) })}><X size={12} /></button> : null}</span>)}</div>
                            ) : null}
                            <div className="recruit-talent-chat__requirements">
                              {turnRubric.requirements.map((item) => (
                                <div className="recruit-talent-chat__requirement" key={item.key}>
                                  <div><strong>{item.label}</strong><span>{item.description}</span></div>
                                  <label><span>权重</span><input type="number" min="0" max="100" value={item.weight} disabled={!active || busy !== null} aria-label={`${item.label}权重`} onChange={(event) => updateRubric({ ...turnRubric, requirements: turnRubric.requirements.map((entry) => entry.key === item.key ? { ...entry, weight: Math.max(0, Math.min(100, Number(event.target.value))) } : entry) })} /></label>
                                </div>
                              ))}
                            </div>
                          </details>
                          {active && rubricChanged && query ? <button type="button" className="recruit-talent-chat__rerun" disabled={busy !== null} onClick={() => void retry(rubric || undefined)}>按调整后的条件重新匹配 <ArrowUpRight size={14} /></button> : null}
                          {turnMatches && (!active || !rubricChanged) ? (
                            <div className="recruit-talent-chat__matches">
                              <div className="recruit-talent-chat__matches-heading"><strong>人才库匹配</strong><span>{turnMatches.evaluated} / {turnMatches.total} 份简历已评估</span></div>
                              {turnMatches.total > turnMatches.evaluated ? <p className="recruit-talent-chat__coverage">仅评估关键词召回的前 {turnMatches.evaluated} 份简历，其余尚未评分；这不是全库排名。</p> : null}
                              {turnMatches.total === 0 ? <EmptyState icon={<UsersRound size={20} />} title="人才库暂无可检索的简历" hint="可前往候选人库新增简历。" action={{ to: '/recruit/candidates', label: '打开候选人库' }} /> : (
                                <div className="recruit-talent-chat__match-layout">
                                  <div className="recruit-talent-chat__match-list" role="group" aria-label="本次匹配候选人" tabIndex={0}>
                                    {turnMatches.matches.map(({ candidate, screening }, index) => (
                                      <button key={candidate.candidate_id} type="button" className={`recruit-talent-row${turnSelected?.candidate.candidate_id === candidate.candidate_id ? ' is-selected' : ''}`} aria-pressed={turnSelected?.candidate.candidate_id === candidate.candidate_id} onClick={() => setSelectedIds((current) => ({ ...current, [turn.id]: candidate.candidate_id }))}>
                                        <span className="recruit-talent-row__rank">{String(index + 1).padStart(2, '0')}</span>
                                        <span className="recruit-talent-row__info"><strong>{candidate.full_name || '未命名候选人'}</strong><small>{candidate.profile_summary?.headline || candidate.current_company || candidate.job_title || '候选人档案'}</small></span>
                                        <b>{screening.total_score}<small> / {screening.max_score || 100}</small></b>
                                      </button>
                                    ))}
                                  </div>
                                  {turnSelected ? <div className="recruit-talent-chat__match-detail" role="region" aria-label={`${turnSelected.candidate.full_name || '候选人'}的评估详情`} tabIndex={0}><div className="recruit-talent-detail__header"><div><strong>{turnSelected.candidate.full_name}</strong><p>{turnSelected.screening.evaluation_mode === 'ai' ? '本次 AI 评估 · 原文证据' : '本次规则评估'}</p></div><ScoreRing score={turnSelected.screening.total_score} max={turnSelected.screening.max_score} size={64} stroke={5} /></div><RecruitScoreReport report={turnSelected.screening.score_report} totalScore={turnSelected.screening.total_score} maxScore={turnSelected.screening.max_score} showTotal={false} /><Link className="recruit-button" to={`/recruit/candidates/${turnSelected.candidate.candidate_id}`}>查看候选人档案 <ArrowUpRight size={14} /></Link></div> : null}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </>
                </div>
              </div>
            </div>
          ) })}
        </div>

        <div className="recruit-talent-chat__dock">
          <ErrorBanner message={error} />
          {source ? <div className="recruit-talent-chat__source">{source.kind === 'job' ? <BriefcaseBusiness size={15} /> : <FileSearch size={15} />}<span>{source.label}</span><button type="button" disabled={busy !== null} title="移除引用的 JD" aria-label="移除引用的 JD" onClick={() => { resetSearch(); setSource(null) }}><X size={15} /></button></div> : null}
          <form className="recruit-talent-chat__composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
            <textarea ref={composerRef} rows={2} value={draft} disabled={busy !== null || loadingHistory} aria-label="描述招聘需求" placeholder={turns.length ? '补充招聘条件…' : '描述你想找的人，或粘贴一份 JD…'} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} />
            <div className="recruit-talent-chat__composer-footer">
              <div className="recruit-talent-chat__attach">
                <button type="button" className="recruit-talent-chat__icon-button" title="添加岗位或 JD" aria-label="添加岗位或 JD" aria-expanded={attachOpen} aria-controls="recruit-talent-attach-menu" disabled={busy !== null} onClick={() => setAttachOpen((open) => !open)}><Plus size={20} /></button>
                {attachOpen ? <div id="recruit-talent-attach-menu" className="recruit-talent-chat__attach-menu"><button type="button" onClick={() => fileInputRef.current?.click()}><FileUp size={16} />上传 JD 文件</button>{jobs.length > 0 ? <div className="recruit-talent-chat__attach-label">引用已有岗位</div> : null}{jobs.map((job) => <button type="button" key={job.job_id} onClick={() => chooseJob(job)}><BriefcaseBusiness size={16} /><span>{job.title}</span></button>)}</div> : null}
              </div>
              <span className="recruit-talent-chat__composer-context">{busy === 'upload' ? '正在解析 JD…' : source ? source.kind === 'job' ? '已引用岗位' : '已引用 JD 文件' : '人才库检索'}</span>
              <button type="submit" className="recruit-talent-chat__send" title="发送需求" aria-label="发送需求" disabled={busy !== null || loadingHistory || (!draft.trim() && (!source || Boolean(query)))}><Send size={17} /></button>
            </div>
          </form>
          <input ref={fileInputRef} className="recruit-talent-chat__file-input" type="file" aria-label="上传 JD 文件" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp" onChange={(event) => { void handleFile(event.target.files?.[0] ?? null); event.target.value = '' }} />
          <p className="recruit-talent-chat__disclaimer">结果仅供招聘参考，请核对原文证据后决策。</p>
        </div>
      </div>
    </RecruitPage>
  )
}