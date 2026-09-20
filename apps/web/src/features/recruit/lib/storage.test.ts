import test from 'node:test'
import assert from 'node:assert/strict'

import { createRecruitStorage, parseRecruitRecords, type StorageLike } from './storage'
import type { RecruitCandidateRecord } from './types'

function memoryStorage(seed: Record<string, string> = {}): StorageLike {
  const state = new Map(Object.entries(seed))
  return {
    getItem(key) {
      return state.get(key) ?? null
    },
    setItem(key, value) {
      state.set(key, value)
    }
  }
}

function record(overrides: Partial<RecruitCandidateRecord> = {}): RecruitCandidateRecord {
  return {
    id: overrides.id ?? 'candidate-1',
    candidateName: overrides.candidateName ?? 'Ada',
    channel: overrides.channel ?? 'Boss',
    jdTitle: overrides.jdTitle ?? 'AI 应用产品工程师',
    jdText: overrides.jdText ?? '负责 AI demo 交付',
    resumeDraft: overrides.resumeDraft ?? 'React + AI agent + CRM',
    createdAt: overrides.createdAt ?? '2026-09-20T10:00:00.000Z',
    screening: overrides.screening ?? {
      candidate_name: 'Ada',
      channel: 'Boss',
      total_score: 88,
      max_score: 100,
      recommendation: '进入面试',
      overall_summary: 'summary',
      job_summary: 'job summary',
      matched_signals: ['AI'],
      strengths: ['AI 应用'],
      risks: ['风险'],
      interview_questions: ['问题'],
      dimension_scores: [],
      evidence_excerpt: 'resume excerpt',
      source_name: '',
      evaluation_mode: 'ai',
      resume_filename: '',
      parsed_blocks: 0
    },
    interviews: overrides.interviews ?? []
  }
}

test('parseRecruitRecords ignores invalid payloads', () => {
  assert.deepEqual(parseRecruitRecords(null), [])
  assert.deepEqual(parseRecruitRecords('oops'), [])
  assert.deepEqual(parseRecruitRecords('{"id":"bad"}'), [])
})

test('storage keeps newest records first', () => {
  const storage = createRecruitStorage(memoryStorage())
  const older = record({ id: 'older', createdAt: '2026-09-20T09:00:00.000Z' })
  const newer = record({ id: 'newer', createdAt: '2026-09-20T11:00:00.000Z' })
  storage.save(older)
  const records = storage.save(newer)
  assert.deepEqual(records.map((item) => item.id), ['newer', 'older'])
})

test('appendInterview prepends a new interview record', () => {
  const storage = createRecruitStorage(memoryStorage())
  storage.save(record())
  const records = storage.appendInterview('candidate-1', {
    id: 'interview-1',
    stage: '初试',
    interviewer: 'Mia',
    decision: '进入复试',
    score: 90,
    notes: '沟通清晰',
    createdAt: '2026-09-20T12:00:00.000Z'
  })
  assert.equal(records[0]?.interviews.length, 1)
  assert.equal(records[0]?.interviews[0]?.decision, '进入复试')
})
