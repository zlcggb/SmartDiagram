import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  CloudOff,
  Gauge,
  LoaderCircle,
  MessageSquareMore,
  Plus,
  Send,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { RecruitDialog, RecruitPage } from '@/features/recruit/components/RecruitPrimitives'
import { AnalysisProgress } from '@/features/recruit/components/RecruitAnalysisStream'
import { RecruitScoreReport } from '@/features/recruit/components/RecruitScoreReport'
import { AiLoader, ScoreRing } from '@/features/recruit/components/RecruitUI'
import { applyStreamEvent, EMPTY_RUN, type AnalysisRun } from '@/features/recruit/lib/analysisStream'
import {
  changedBlocks,
  fetchResumeDraft,
  findResumeGaps,
  newResumeItem,
  resumeLabErrorMessage,
  saveResumeDraft,
  SECTION_META,
  SECTION_ORDER,
  streamResumeChat,
  streamResumeScore,
  undoResumeChange,
  type ResumeBasics,
  type ResumeDocument,
  type ResumeDraft,
  type ResumeGap,
  type ResumeLabMessage,
  type ResumeLabScore,
  type ResumeSectionKey,
} from '@/features/recruit/lib/resumeLab'
import type { RecruitCandidateStreamEvent } from '@/features/recruit/lib/types'

import '../resume-lab.css'

const TARGET_SCORE = 80
const SAVE_DELAY = 800

const QUICK_PROMPTS = [
  '对照岗位 JD，找出最影响评分的 3 个差距',
  '把项目经历改写成 STAR 结构，并尽量量化结果',
  '精简个人简介，突出与岗位最匹配的亮点',
  '检查错别字、时间线和格式是否一致',
]

const FIELD_PLACEHOLDERS: Record<string, string> = {
  school: '学校', degree: '学历', major: '专业', period: '2021.09 - 2025.06', details: '• 要点描述',
  company: '公司', title: '职位 / 名称', name: '名称', role: '担任角色', items: '技能，用顿号分隔',
}

const LAYOUT: Record<ResumeSectionKey, { primary: string; secondary: string[]; body?: string; inline?: boolean }> = {
  education: { primary: 'school', secondary: ['degree', 'major'], body: 'details' },
  experience: { primary: 'company', secondary: ['title'], body: 'details' },
  projects: { primary: 'name', secondary: ['role'], body: 'details' },
  skills: { primary: 'name', secondary: [], body: 'items', inline: true },
  awards: { primary: 'title', secondary: [], body: 'details' },
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
type Busy = 'chat' | 'score' | 'undo' | null
type GapAnswer = { text: string; skip: boolean }

function supplementMessage(gaps: ResumeGap[], answers: Record<string, GapAnswer>): string {
  const lines = gaps.flatMap((gap) => {
    const answer = answers[gap.key]
    if (answer?.skip) return [`【${gap.location}】${gap.prompt}：不适用`]
    const text = answer?.text.trim()
    return text ? [`【${gap.location}】${gap.prompt}：${text}`] : []
  })
  return `我补充了简历中待补充的信息，请据此完善对应内容：\n${lines.map((line, index) => `${index + 1}. ${line}`).join('\n')}`
}

function SupplementDialog({ gaps, answers, busy, onChange, onSubmit, onClose }: {
  gaps: ResumeGap[]
  answers: Record<string, GapAnswer>
  busy: Busy
  onChange: (key: string, answer: GapAnswer) => void
  onSubmit: () => void
  onClose: () => void
}) {
  const filled = gaps.filter((gap) => answers[gap.key]?.skip || answers[gap.key]?.text.trim()).length
  const groups = useMemo(() => {
    const map = new Map<string, ResumeGap[]>()
    for (const gap of gaps) map.set(gap.location, [...(map.get(gap.location) ?? []), gap])
    return [...map.entries()]
  }, [gaps])

  return (
    <RecruitDialog title="补充关键信息" description="简历里还有几处缺少事实依据。随手写下要点即可，AI 会整理成专业表述并替换占位。" onClose={onClose}>
      <div className="rl-gaps">
        {groups.map(([location, items]) => (
          <section key={location} className="rl-gaps__group">
            <h4>{location}</h4>
            {items.map((gap) => {
              const answer = answers[gap.key] ?? { text: '', skip: false }
              return (
                <div key={gap.key} className={`rl-gaps__item${answer.skip ? ' is-skip' : ''}`}>
                  <span>{gap.prompt}</span>
                  <textarea
                    rows={2}
                    aria-label={gap.prompt}
                    value={answer.text}
                    disabled={answer.skip}
                    autoFocus={gap.key === gaps[0].key}
                    placeholder="简单写下事实即可，口语也没关系"
                    onChange={(event) => onChange(gap.key, { ...answer, text: event.target.value })}
                  />
                  <button type="button" className="rl-gaps__skip" aria-pressed={answer.skip} onClick={() => onChange(gap.key, { ...answer, skip: !answer.skip })}>
                    {answer.skip ? '恢复填写' : '没有这项，删去占位'}
                  </button>
                </div>
              )
            })}
          </section>
        ))}
      </div>
      <footer className="rl-gaps__foot">
        <span>已填 {filled} / {gaps.length}，未填的会保留占位</span>
        <button type="button" className="recruit-button" onClick={onClose}>稍后再说</button>
        <button type="button" className="recruit-button recruit-button--primary" disabled={!filled || Boolean(busy)} onClick={onSubmit}>
          <Sparkles size={14} />提交并完善简历
        </button>
      </footer>
    </RecruitDialog>
  )
}

function Field({ value, onChange, placeholder, multiline, readOnly, className }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  multiline?: boolean
  readOnly: boolean
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }, [value])
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!multiline && event.key === 'Enter') event.preventDefault()
  }
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`rl-field${className ? ` ${className}` : ''}`}
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      spellCheck={false}
      onKeyDown={onKeyDown}
      onChange={(event) => onChange(multiline ? event.target.value : event.target.value.replace(/\n/g, ' '))}
    />
  )
}

function ResumePaper({ document, readOnly, flash, onChange }: {
  document: ResumeDocument
  readOnly: boolean
  flash: Set<string>
  onChange: (next: ResumeDocument) => void
}) {
  const setBasics = (field: keyof ResumeBasics, value: string) => onChange({ ...document, basics: { ...document.basics, [field]: value } })
  const setItem = (section: ResumeSectionKey, id: string, field: string, value: string) => onChange({
    ...document,
    [section]: (document[section] as Array<{ id: string }>).map((item) => item.id === id ? { ...item, [field]: value } : item),
  })
  const addItem = (section: ResumeSectionKey) => onChange({ ...document, [section]: [...document[section], newResumeItem(section)] })
  const removeItem = (section: ResumeSectionKey, id: string) => onChange({
    ...document,
    [section]: (document[section] as Array<{ id: string }>).filter((item) => item.id !== id),
  })
  const flashClass = (key: string) => flash.has(key) ? ' is-flash' : ''

  return (
    <article className={`rl-paper${readOnly ? ' is-locked' : ''}`} aria-label="简历预览">
      <header className={`rl-paper__head${flashClass('basics')}`}>
        <Field className="rl-field--name" value={document.basics.name} placeholder="姓名" readOnly={readOnly} onChange={(value) => setBasics('name', value)} />
        <Field className="rl-field--headline" value={document.basics.headline} placeholder="求职意向 / 一句话定位" readOnly={readOnly} onChange={(value) => setBasics('headline', value)} />
        <div className="rl-paper__contact">
          {(['phone', 'email', 'location', 'links'] as const).map((field) => (
            <Field
              key={field}
              value={document.basics[field]}
              placeholder={{ phone: '电话', email: '邮箱', location: '城市', links: '作品 / GitHub 链接' }[field]}
              readOnly={readOnly}
              onChange={(value) => setBasics(field, value)}
            />
          ))}
        </div>
      </header>

      <section className={`rl-paper__section${flashClass('summary')}`}>
        <h3>个人简介</h3>
        <Field multiline value={document.summary} placeholder="用 2-3 句话概括你的核心优势与求职方向" readOnly={readOnly} onChange={(value) => onChange({ ...document, summary: value })} />
      </section>

      {SECTION_ORDER.map((section) => {
        const layout = LAYOUT[section]
        const items = document[section] as Array<Record<string, string> & { id: string }>
        return (
          <section key={section} className={`rl-paper__section rl-paper__section--${section}`}>
            <h3>
              {SECTION_META[section].label}
              {!readOnly ? <button type="button" className="rl-paper__add" onClick={() => addItem(section)} aria-label={`添加${SECTION_META[section].label}`}><Plus size={13} />添加</button> : null}
            </h3>
            {items.length ? items.map((item) => (
              <div key={item.id} className={`rl-item${layout.inline ? ' rl-item--inline' : ''}${flashClass(`${section}:${item.id}`)}`}>
                {!readOnly ? <button type="button" className="rl-item__remove" title="删除这一条" aria-label="删除这一条" onClick={() => removeItem(section, item.id)}><X size={12} /></button> : null}
                <div className="rl-item__row">
                  <Field className="rl-field--strong" value={item[layout.primary]} placeholder={FIELD_PLACEHOLDERS[layout.primary]} readOnly={readOnly} onChange={(value) => setItem(section, item.id, layout.primary, value)} />
                  {'period' in item ? <Field className="rl-field--period" value={item.period} placeholder={FIELD_PLACEHOLDERS.period} readOnly={readOnly} onChange={(value) => setItem(section, item.id, 'period', value)} /> : null}
                  {layout.inline && layout.body ? <Field multiline className="rl-field--body" value={item[layout.body]} placeholder={FIELD_PLACEHOLDERS[layout.body]} readOnly={readOnly} onChange={(value) => setItem(section, item.id, layout.body!, value)} /> : null}
                </div>
                {layout.secondary.length ? (
                  <div className="rl-item__meta">
                    {layout.secondary.map((field) => (
                      <Field key={field} value={item[field]} placeholder={FIELD_PLACEHOLDERS[field]} readOnly={readOnly} onChange={(value) => setItem(section, item.id, field, value)} />
                    ))}
                  </div>
                ) : null}
                {!layout.inline && layout.body ? (
                  <Field multiline className="rl-field--body" value={item[layout.body]} placeholder={FIELD_PLACEHOLDERS[layout.body]} readOnly={readOnly} onChange={(value) => setItem(section, item.id, layout.body!, value)} />
                ) : null}
              </div>
            )) : <p className="rl-paper__empty">暂无内容{!readOnly ? '，点击右上角「添加」' : ''}</p>}
          </section>
        )
      })}
    </article>
  )
}

function ScorePanel({ scores, busy, onScore, onApply }: {
  scores: ResumeLabScore[]
  busy: Busy
  onScore: () => void
  onApply: (score: ResumeLabScore) => void
}) {
  const [open, setOpen] = useState(false)
  const latest = scores[scores.length - 1]
  const previous = scores[scores.length - 2]
  const delta = latest && previous ? latest.total_score - previous.total_score : null
  const reached = latest ? latest.total_score >= TARGET_SCORE : false

  return (
    <section className={`rl-score${open ? ' is-open' : ''}`} aria-label="评分">
      <div className="rl-score__bar">
        <ScoreRing score={latest?.total_score} max={latest?.max_score || 100} size={50} stroke={5} />
        <div className="rl-score__meta">
          <strong>
            {latest ? `${latest.label} · ${latest.recommendation || '已评分'}` : '尚未评分'}
            {delta ? <b className={delta > 0 ? 'is-up' : 'is-down'}>{delta > 0 ? `+${delta}` : delta}</b> : null}
          </strong>
          <span>{reached ? `已达到 ${TARGET_SCORE} 分目标，可准备投递` : `目标 ${TARGET_SCORE} 分${latest ? `，还差 ${Math.max(0, TARGET_SCORE - latest.total_score)} 分` : ''}`}</span>
        </div>
        {scores.length > 1 ? (
          <div className="rl-score__trend" aria-label="评分趋势">
            <i className="rl-score__goal" style={{ bottom: `${TARGET_SCORE}%` }} />
            {scores.map((score) => (
              <span key={score.id} title={`${score.label}：${score.total_score} 分`} style={{ height: `${Math.max(6, (score.total_score / (score.max_score || 100)) * 100)}%` }} />
            ))}
          </div>
        ) : null}
        <div className="rl-score__actions">
          {latest ? (
            <button type="button" className="recruit-button" onClick={() => setOpen(!open)} aria-expanded={open}>
              报告<ChevronDown size={14} className={open ? 'rl-rotate' : ''} />
            </button>
          ) : null}
          <button type="button" className="recruit-button recruit-button--primary" disabled={Boolean(busy)} onClick={onScore}>
            {busy === 'score' ? <LoaderCircle size={14} className="animate-spin" /> : <Gauge size={14} />}
            {latest ? '重新评分' : '一键评分'}
          </button>
        </div>
      </div>
      {open && latest ? (
        <div className="rl-score__detail">
          {latest.overall_summary ? <p className="rl-score__summary">{latest.overall_summary}</p> : null}
          {latest.missing_keywords.length ? (
            <div className="rl-score__keywords"><em>缺失关键词</em>{latest.missing_keywords.map((word) => <span key={word}>{word}</span>)}</div>
          ) : null}
          {latest.recommendations.length ? (
            <div className="rl-score__advice">
              <em>改进建议</em>
              <ul>{latest.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
              <button type="button" className="recruit-button recruit-button--primary" disabled={Boolean(busy)} onClick={() => onApply(latest)}>
                <Sparkles size={14} />让 AI 按建议修改
              </button>
            </div>
          ) : null}
          <RecruitScoreReport report={latest.score_report} totalScore={latest.total_score} maxScore={latest.max_score} showTotal={false} />
        </div>
      ) : null}
    </section>
  )
}

function ChatMessage({ message, busy, onUndo }: { message: ResumeLabMessage; busy: Busy; onUndo: (id: string) => void }) {
  if (message.role === 'score') {
    return <div className="rl-msg rl-msg--score"><Gauge size={13} /><span>{message.content}</span></div>
  }
  return (
    <div className={`rl-msg rl-msg--${message.role}`}>
      <div className="rl-msg__bubble">{message.content}</div>
      {message.changes?.length ? (
        <div className={`rl-msg__changes${message.undone ? ' is-undone' : ''}`}>
          <em>{message.undone ? '已撤销的修改' : '已修改简历'}</em>
          <ul>{message.changes.map((change) => <li key={change}><Check size={12} />{change}</li>)}</ul>
          {message.can_undo && !message.undone ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => onUndo(message.id)}><Undo2 size={12} />撤销</button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function RecruitResumeLabEditorPage() {
  const { draftId = '' } = useParams()
  const [draft, setDraft] = useState<ResumeDraft | null>(null)
  const [document, setDocument] = useState<ResumeDocument | null>(null)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [busy, setBusy] = useState<Busy>(null)
  const [input, setInput] = useState('')
  const [pendingUser, setPendingUser] = useState('')
  const [streamText, setStreamText] = useState('')
  const [streamStatus, setStreamStatus] = useState('')
  const [run, setRun] = useState<AnalysisRun | null>(null)
  const [flash, setFlash] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [gapsOpen, setGapsOpen] = useState(false)
  const [gapAnswers, setGapAnswers] = useState<Record<string, GapAnswer>>({})

  const docRef = useRef<ResumeDocument | null>(null)
  const promptedGaps = useRef(new Set<string>())
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const abortRef = useRef<AbortController | null>(null)
  const flashTimer = useRef<number | undefined>(undefined)
  const listRef = useRef<HTMLDivElement>(null)

  const applyDraft = useCallback((next: ResumeDraft) => {
    setDraft(next)
    setDocument(next.document)
    docRef.current = next.document
    setTitle(next.title)
  }, [])

  useEffect(() => {
    fetchResumeDraft(draftId).then(applyDraft).catch((reason) => setError(resumeLabErrorMessage(reason)))
  }, [draftId, applyDraft])

  const flush = useCallback(() => {
    window.clearTimeout(timerRef.current)
    saveChain.current = saveChain.current.then(async () => {
      if (!dirtyRef.current || !docRef.current) return
      dirtyRef.current = false
      setSaveState('saving')
      try {
        await saveResumeDraft(draftId, { document: docRef.current })
        setSaveState(dirtyRef.current ? 'dirty' : 'saved')
      } catch {
        dirtyRef.current = true
        setSaveState('error')
      }
    })
    return saveChain.current
  }, [draftId])

  useEffect(() => () => {
    abortRef.current?.abort()
    void flush()
  }, [flush])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [draft?.messages.length, streamText, pendingUser, run])

  const gaps = useMemo(() => document ? findResumeGaps(document) : [], [document])

  useEffect(() => {
    // Only server-side versions trigger the popup, so typing inside a placeholder never re-opens it.
    if (!draft || busy) return
    const fresh = findResumeGaps(draft.document).filter((gap) => !promptedGaps.current.has(gap.key))
    if (!fresh.length) return
    fresh.forEach((gap) => promptedGaps.current.add(gap.key))
    setGapsOpen(true)
  }, [draft, busy])

  const edit = (next: ResumeDocument) => {
    setDocument(next)
    docRef.current = next
    dirtyRef.current = true
    setSaveState('dirty')
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { void flush() }, SAVE_DELAY)
  }

  const highlight = (before: ResumeDocument | null, after: ResumeDocument) => {
    if (!before) return
    setFlash(changedBlocks(before, after))
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(new Set()), 4500)
  }

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    setBusy('chat')
    setError('')
    setInput('')
    setPendingUser(message)
    setStreamText('')
    setStreamStatus('')
    await flush()
    const before = docRef.current
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const next = await streamResumeChat(draftId, message, (event) => {
        if (event.type === 'token') setStreamText((current) => current + event.text)
        if (event.type === 'status') setStreamStatus(event.label)
      }, controller.signal)
      applyDraft(next)
      highlight(before, next.document)
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(resumeLabErrorMessage(reason))
        setInput(message)
      }
    } finally {
      setBusy(null)
      setPendingUser('')
      setStreamText('')
      setStreamStatus('')
    }
  }

  const score = async () => {
    if (busy) return
    setBusy('score')
    setError('')
    setRun({ ...EMPTY_RUN, steps: [{ key: 'prepare', label: '读取简历与岗位要求', status: 'done' }] })
    await flush()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const next = await streamResumeScore(draftId, (event) => {
        if (event.type === 'step' || event.type === 'tool' || event.type === 'token') {
          setRun((current) => applyStreamEvent(current, event as RecruitCandidateStreamEvent))
        }
      }, controller.signal)
      applyDraft(next)
    } catch (reason) {
      if (!controller.signal.aborted) setError(resumeLabErrorMessage(reason))
    } finally {
      setBusy(null)
      setRun(null)
    }
  }

  const undo = async (messageId: string) => {
    if (busy) return
    setBusy('undo')
    setError('')
    await flush()
    const before = docRef.current
    try {
      const next = await undoResumeChange(draftId, messageId)
      applyDraft(next)
      highlight(before, next.document)
    } catch (reason) {
      setError(resumeLabErrorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const applyAdvice = (entry: ResumeLabScore) => {
    const advice = entry.recommendations.map((item, index) => `${index + 1}. ${item}`).join('\n')
    const keywords = entry.missing_keywords.length ? `\n缺失关键词：${entry.missing_keywords.join('、')}（只补充真实具备的）` : ''
    void send(`请根据${entry.label}评分的改进建议逐条修改简历：\n${advice}${keywords}`)
  }

  const submitGaps = () => {
    const message = supplementMessage(gaps, gapAnswers)
    setGapsOpen(false)
    setGapAnswers({})
    void send(message)
  }

  const saveTitle = async () => {
    const next = title.trim()
    if (!draft || !next || next === draft.title) { setTitle(draft?.title ?? ''); return }
    try {
      await saveResumeDraft(draftId, { title: next })
      setDraft({ ...draft, title: next })
    } catch (reason) {
      setError(resumeLabErrorMessage(reason))
    }
  }

  const scores = draft?.scores
  const quickPrompts = useMemo(() => {
    const latest = scores?.[scores.length - 1]
    return latest?.recommendations.length ? ['按最新评分的改进建议逐条修改', ...QUICK_PROMPTS.slice(1)] : QUICK_PROMPTS
  }, [scores])

  if (!draft || !document) {
    return (
      <RecruitPage title="简历优化" description="" hideHeader className="recruit-page--talent-chat rl-page">
        <div className="rl-loading">{error ? <p className="recruit-error">{error}</p> : <AiLoader label="正在打开简历…" />}</div>
      </RecruitPage>
    )
  }

  const saveLabel = { saved: '已保存', dirty: '编辑中…', saving: '保存中…', error: '保存失败，稍后重试' }[saveState]

  return (
    <RecruitPage title="简历优化" description="" hideHeader className="recruit-page--talent-chat rl-page">
      <div className="rl-editor">
        <header className="rl-topbar">
          <Link to="/recruit/resume-lab" className="rl-topbar__back" aria-label="返回简历列表"><ArrowLeft size={16} /></Link>
          <input
            className="rl-topbar__title"
            value={title}
            aria-label="草稿名称"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          />
          {draft.job ? <span className="rl-topbar__job">目标岗位 · {draft.job.title}</span> : <span className="rl-topbar__job is-warn">未关联岗位，无法评分</span>}
          {gaps.length ? (
            <button type="button" className="rl-topbar__gaps" disabled={Boolean(busy)} onClick={() => setGapsOpen(true)}>
              <MessageSquareMore size={13} />{gaps.length} 处待补充
            </button>
          ) : null}
          <span className={`rl-topbar__save is-${saveState}`}>
            {saveState === 'error' ? <CloudOff size={13} /> : saveState === 'saved' ? <Check size={13} /> : <LoaderCircle size={13} className="animate-spin" />}
            {saveLabel}
          </span>
        </header>

        {error ? <p className="recruit-error rl-error">{error}<button type="button" onClick={() => setError('')} aria-label="关闭"><X size={13} /></button></p> : null}

        <div className="rl-body">
          <aside className="rl-chat" aria-label="AI 简历助手">
            <div className="rl-chat__list" ref={listRef}>
              {draft.messages.map((message) => <ChatMessage key={message.id} message={message} busy={busy} onUndo={(id) => void undo(id)} />)}
              {pendingUser ? <div className="rl-msg rl-msg--user"><div className="rl-msg__bubble">{pendingUser}</div></div> : null}
              {busy === 'chat' ? (
                <div className="rl-msg rl-msg--assistant">
                  <div className="rl-msg__bubble">
                    {streamText || null}
                    {streamStatus || !streamText ? <AiLoader label={streamStatus || 'AI 正在思考…'} /> : <i className="rl-caret" aria-hidden="true" />}
                  </div>
                </div>
              ) : null}
              {busy === 'score' && run ? <div className="rl-msg rl-msg--assistant rl-msg--progress"><AnalysisProgress run={run} /></div> : null}
            </div>
            <div className="rl-chat__foot">
              {!busy ? (
                <div className="rl-chips">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => {
                        const latest = draft.scores[draft.scores.length - 1]
                        if (prompt.startsWith('按最新评分') && latest) applyAdvice(latest)
                        else void send(prompt)
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}
              <form className="rl-composer" onSubmit={(event) => { event.preventDefault(); void send(input) }}>
                <textarea
                  value={input}
                  rows={2}
                  placeholder="告诉 AI 怎么改，例如：把第二段实习经历写得更有数据感"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      void send(input)
                    }
                  }}
                />
                <button type="submit" disabled={!input.trim() || Boolean(busy)} aria-label="发送">
                  {busy === 'chat' ? <LoaderCircle size={15} className="animate-spin" /> : input.trim() ? <ArrowUp size={15} /> : <Send size={15} />}
                </button>
              </form>
            </div>
          </aside>

          <main className="rl-preview">
            {draft.job ? <ScorePanel scores={draft.scores} busy={busy} onScore={() => void score()} onApply={applyAdvice} /> : null}
            <div className="rl-preview__scroll">
              {busy === 'chat' || busy === 'undo' ? <div className="rl-lock-hint"><LoaderCircle size={13} className="animate-spin" />AI 修改中，暂时锁定编辑</div> : null}
              <ResumePaper document={document} readOnly={busy === 'chat' || busy === 'undo'} flash={flash} onChange={edit} />
            </div>
          </main>
        </div>
      </div>
      {gapsOpen && gaps.length ? (
        <SupplementDialog
          gaps={gaps}
          answers={gapAnswers}
          busy={busy}
          onChange={(key, answer) => setGapAnswers((current) => ({ ...current, [key]: answer }))}
          onSubmit={submitGaps}
          onClose={() => setGapsOpen(false)}
        />
      ) : null}
    </RecruitPage>
  )
}
