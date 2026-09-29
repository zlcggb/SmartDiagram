import { API_BASE, currentEnterpriseContext, enterpriseHeaders } from '@/shared/lib/config/enterpriseContext'
import type { RecruitEducationFact, RecruitScoreReport } from './types'

export interface ResumeBasics {
  name: string
  headline: string
  email: string
  phone: string
  location: string
  links: string
}

export interface ResumeSectionFields {
  education: { school: string; degree: string; major: string; period: string; details: string }
  experience: { company: string; title: string; period: string; details: string }
  projects: { name: string; role: string; period: string; details: string }
  skills: { name: string; items: string }
  awards: { title: string; period: string; details: string }
}

export type ResumeSectionKey = keyof ResumeSectionFields
export type ResumeItem<K extends ResumeSectionKey> = ResumeSectionFields[K] & { id: string }

export type ResumeDocument = {
  basics: ResumeBasics
  summary: string
} & { [K in ResumeSectionKey]: Array<ResumeItem<K>> }

export interface ResumeLabMessage {
  id: string
  role: 'user' | 'assistant' | 'score'
  content: string
  changes?: string[]
  can_undo?: boolean
  undone?: boolean
  score_id?: string
  /** Undo snapshot; only present for browser-stored drafts. */
  before?: ResumeDocument
  created_at: string
}

export interface ResumeLabScore {
  id: string
  label: string
  revision: number
  total_score: number
  max_score: number
  recommendation: string
  overall_summary: string
  strengths: string[]
  risks: string[]
  recommendations: string[]
  missing_keywords: string[]
  score_report?: RecruitScoreReport
  created_at: string
}

export interface ResumeDraft {
  id: string
  title: string
  candidate_id: string | null
  job_id: string | null
  job: { job_id: string; title: string; recruitment_type: string } | null
  document: ResumeDocument
  messages: ResumeLabMessage[]
  scores: ResumeLabScore[]
  revision: number
  storage?: ResumeLabStorage
  created_at: string
  updated_at: string
}

/** `server`: persisted per account in the DB. `browser`: guest drafts kept in localStorage only. */
export type ResumeLabStorage = 'server' | 'browser'

export interface ResumeDraftSummary {
  id: string
  title: string
  candidate_id: string | null
  job_id: string | null
  latest_score: number | null
  first_score: number | null
  score_count: number
  updated_at: string
}

export type ResumeLabStreamEvent =
  | { type: 'step'; key: string; status: 'running' | 'done' | 'error'; label: string }
  | { type: 'tool'; name: string; output: RecruitEducationFact[] }
  | { type: 'token'; text: string }
  | { type: 'status'; label: string }
  | { type: 'done'; draft: ResumeDraft }
  | { type: 'error'; message: string }

export const SECTION_META: Record<ResumeSectionKey, { label: string; fields: Array<keyof ResumeSectionFields[ResumeSectionKey]> }> = {
  education: { label: '教育经历', fields: ['school', 'degree', 'major', 'period', 'details'] as never },
  experience: { label: '工作 / 实习经历', fields: ['company', 'title', 'period', 'details'] as never },
  projects: { label: '项目经历', fields: ['name', 'role', 'period', 'details'] as never },
  skills: { label: '专业技能', fields: ['name', 'items'] as never },
  awards: { label: '荣誉奖项 / 证书', fields: ['title', 'period', 'details'] as never },
}

export const SECTION_ORDER: ResumeSectionKey[] = ['education', 'experience', 'projects', 'skills', 'awards']

const ERROR_LABELS: Record<string, string> = {
  resume_draft_not_found: '简历草稿不存在或无权访问。',
  resume_change_not_found: '这次修改已无法撤销。',
  resume_text_required: '简历内容太少，先补充一些内容再评分。',
  job_id_required: '需要先选择目标岗位。',
  message_required: '请输入内容。',
  resume_chat_failed: 'AI 暂时没有响应，请稍后重试。',
  resume_score_failed: '评分失败，请稍后重试。',
  candidate_not_found: '候选人不存在。',
  job_not_found: '岗位不存在。',
  resume_draft_required: '本地草稿丢失，请刷新后重试。',
  browser_storage_full: '浏览器存储空间不足，请删除几份旧草稿或登录后保存到云端。',
}

export function resumeLabErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  return ERROR_LABELS[message] || message || '操作失败'
}

export function newResumeItem<K extends ResumeSectionKey>(section: K): ResumeItem<K> {
  const id = Math.random().toString(36).slice(2, 12)
  const blank = Object.fromEntries(SECTION_META[section].fields.map((field) => [field, ''])) as ResumeSectionFields[K]
  return { ...blank, id }
}

/** Keys of blocks that differ between two documents, used to flash AI edits in the preview. */
export function changedBlocks(before: ResumeDocument, after: ResumeDocument): Set<string> {
  const changed = new Set<string>()
  if (JSON.stringify(before.basics) !== JSON.stringify(after.basics)) changed.add('basics')
  if (before.summary !== after.summary) changed.add('summary')
  for (const section of SECTION_ORDER) {
    const previous = new Map(before[section].map((item) => [item.id, JSON.stringify(item)]))
    for (const item of after[section]) {
      if (previous.get(item.id) !== JSON.stringify(item)) changed.add(`${section}:${item.id}`)
    }
  }
  return changed
}

export interface ResumeGap {
  key: string
  location: string
  prompt: string
}

const GAP_PATTERN = /【待补充[:：]\s*([^】]+?)\s*】/g
const SECTION_TITLE_FIELD: Record<ResumeSectionKey, string> = {
  education: 'school', experience: 'company', projects: 'name', skills: 'name', awards: 'title',
}

/** Collects 【待补充：xxx】 placeholders the AI left in the resume, labelled by where they appear. */
export function findResumeGaps(document: ResumeDocument): ResumeGap[] {
  const gaps: ResumeGap[] = []
  const seen = new Set<string>()
  const scan = (location: string, text: string) => {
    for (const match of text.matchAll(GAP_PATTERN)) {
      const key = `${location}｜${match[1]}`
      if (seen.has(key)) continue
      seen.add(key)
      gaps.push({ key, location, prompt: match[1] })
    }
  }
  scan('基本信息', Object.values(document.basics).join('\n'))
  scan('个人简介', document.summary)
  for (const section of SECTION_ORDER) {
    for (const item of document[section] as Array<Record<string, string>>) {
      const title = item[SECTION_TITLE_FIELD[section]]?.replace(GAP_PATTERN, '').trim()
      const location = title ? `${SECTION_META[section].label} · ${title}` : SECTION_META[section].label
      scan(location, Object.entries(item).filter(([field]) => field !== 'id').map(([, value]) => value).join('\n'))
    }
  }
  return gaps
}

async function parseJson<T>(response: Response): Promise<T> {
  if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T
  let message = '请求失败'
  try {
    const body = await response.json() as { detail?: unknown }
    if (typeof body.detail === 'string') message = body.detail
  } catch {
    // keep generic message
  }
  throw new Error(message)
}

const base = `${API_BASE}/api/recruit/resume-drafts`

function identityKey(): string {
  const context = currentEnterpriseContext()
  if (context.kind === 'user') return `user:${context.userId}`
  return `guest:${'guestId' in context && context.guestId ? context.guestId : 'anonymous'}`
}

const storageModes = new Map<string, Promise<ResumeLabStorage>>()

/** Where drafts live for the current identity; decided by the server (RESUME_LAB_GUEST_PERSIST). */
export function resumeLabStorage(): Promise<ResumeLabStorage> {
  const key = identityKey()
  let mode = storageModes.get(key)
  if (!mode) {
    mode = fetch(`${base}/config`, { headers: enterpriseHeaders(false) })
      .then((response) => parseJson<{ storage: ResumeLabStorage }>(response))
      .then((payload): ResumeLabStorage => payload.storage === 'browser' ? 'browser' : 'server')
    mode.catch(() => storageModes.delete(key))
    storageModes.set(key, mode)
  }
  return mode
}

const LOCAL_PREFIX = 'smartdiagram.resume-lab.v1:'

function readLocal(): Record<string, ResumeDraft> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_PREFIX + identityKey()) || '{}') as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, ResumeDraft> : {}
  } catch {
    return {}
  }
}

function writeLocal(drafts: Record<string, ResumeDraft>) {
  try {
    localStorage.setItem(LOCAL_PREFIX + identityKey(), JSON.stringify(drafts))
  } catch {
    throw new Error('browser_storage_full')
  }
}

function putLocal(draft: ResumeDraft): ResumeDraft {
  const drafts = readLocal()
  const stored: ResumeDraft = { ...draft, storage: 'browser' }
  writeLocal({ ...drafts, [draft.id]: stored })
  return stored
}

function getLocal(draftId: string): ResumeDraft {
  const draft = readLocal()[draftId]
  if (!draft) throw new Error('resume_draft_not_found')
  return draft
}

function summarize(draft: ResumeDraft): ResumeDraftSummary {
  return {
    id: draft.id,
    title: draft.title,
    candidate_id: draft.candidate_id,
    job_id: draft.job_id,
    latest_score: draft.scores.at(-1)?.total_score ?? null,
    first_score: draft.scores[0]?.total_score ?? null,
    score_count: draft.scores.length,
    updated_at: draft.updated_at,
  }
}

export async function fetchResumeDrafts(): Promise<ResumeDraftSummary[]> {
  if (await resumeLabStorage() === 'browser') {
    return Object.values(readLocal()).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(summarize)
  }
  const payload = await parseJson<{ drafts: ResumeDraftSummary[] }>(await fetch(base, { headers: enterpriseHeaders(false) }))
  return payload.drafts
}

export async function createResumeDraft(input: { candidate_id?: string; job_id?: string; resume_text?: string; force_new?: boolean }): Promise<ResumeDraft> {
  const browser = await resumeLabStorage() === 'browser'
  if (browser && input.candidate_id && !input.force_new) {
    const existing = Object.values(readLocal())
      .filter((draft) => draft.candidate_id === input.candidate_id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    if (existing) return existing
  }
  const draft = await parseJson<ResumeDraft>(await fetch(base, { method: 'POST', headers: enterpriseHeaders(), body: JSON.stringify(input) }))
  return draft.storage === 'browser' ? putLocal(draft) : draft
}

export async function fetchResumeDraft(draftId: string): Promise<ResumeDraft> {
  if (await resumeLabStorage() === 'browser') return getLocal(draftId)
  return parseJson(await fetch(`${base}/${encodeURIComponent(draftId)}`, { headers: enterpriseHeaders(false) }))
}

export async function saveResumeDraft(draftId: string, input: { document?: ResumeDocument; title?: string }): Promise<{ revision: number; updated_at: string }> {
  if (await resumeLabStorage() === 'browser') {
    const draft = getLocal(draftId)
    const next = putLocal({
      ...draft,
      ...(input.document ? { document: input.document, revision: draft.revision + 1 } : {}),
      ...(input.title ? { title: input.title.slice(0, 120) } : {}),
      updated_at: new Date().toISOString(),
    })
    return { revision: next.revision, updated_at: next.updated_at }
  }
  return parseJson(await fetch(`${base}/${encodeURIComponent(draftId)}`, { method: 'PATCH', headers: enterpriseHeaders(), body: JSON.stringify(input) }))
}

export async function deleteResumeDraft(draftId: string): Promise<void> {
  if (await resumeLabStorage() === 'browser') {
    const drafts = readLocal()
    delete drafts[draftId]
    writeLocal(drafts)
    return
  }
  await parseJson(await fetch(`${base}/${encodeURIComponent(draftId)}`, { method: 'DELETE', headers: enterpriseHeaders(false) }))
}

export async function undoResumeChange(draftId: string, messageId: string): Promise<ResumeDraft> {
  if (await resumeLabStorage() === 'browser') {
    const draft = getLocal(draftId)
    const target = draft.messages.find((message) => message.id === messageId && message.before)
    if (!target?.before) throw new Error('resume_change_not_found')
    const snapshot = target.before
    return putLocal({
      ...draft,
      document: snapshot,
      messages: draft.messages.map((message) => {
        if (message !== target) return message
        return { ...message, before: undefined, undone: true, can_undo: false }
      }),
      revision: draft.revision + 1,
      updated_at: new Date().toISOString(),
    })
  }
  return parseJson(await fetch(`${base}/${encodeURIComponent(draftId)}/undo`, {
    method: 'POST', headers: enterpriseHeaders(), body: JSON.stringify({ message_id: messageId }),
  }))
}

async function streamDraftAction(
  draftId: string, action: 'chat' | 'score', body: Record<string, unknown>,
  onEvent: (event: ResumeLabStreamEvent) => void, signal?: AbortSignal,
): Promise<ResumeDraft> {
  const browser = await resumeLabStorage() === 'browser'
  const payload = browser ? { ...body, draft: getLocal(draftId) } : body
  const draft = await readStream(await fetch(`${base}/${encodeURIComponent(draftId)}/${action}/stream`, {
    method: 'POST', headers: enterpriseHeaders(), body: JSON.stringify(payload), signal,
  }), onEvent)
  return browser ? putLocal(draft) : draft
}

export function streamResumeChat(draftId: string, message: string, onEvent: (event: ResumeLabStreamEvent) => void, signal?: AbortSignal): Promise<ResumeDraft> {
  return streamDraftAction(draftId, 'chat', { message }, onEvent, signal)
}

export function streamResumeScore(draftId: string, onEvent: (event: ResumeLabStreamEvent) => void, signal?: AbortSignal): Promise<ResumeDraft> {
  return streamDraftAction(draftId, 'score', {}, onEvent, signal)
}

async function readStream(response: Response, onEvent: (event: ResumeLabStreamEvent) => void): Promise<ResumeDraft> {
  if (!response.ok || !response.body) await parseJson(response)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let draft: ResumeDraft | null = null
  let failure = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const frames = buffer.split('\n\n')
    buffer = done ? '' : frames.pop() ?? ''
    for (const frame of frames) {
      const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data) continue
      const event = JSON.parse(data) as ResumeLabStreamEvent
      if (event.type === 'done') draft = event.draft
      if (event.type === 'error') failure = event.message
      onEvent(event)
    }
    if (done) break
  }
  if (draft) return draft
  throw new Error(failure || '连接中断，请重试')
}
