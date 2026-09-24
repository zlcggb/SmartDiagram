import assert from 'node:assert/strict'
import test from 'node:test'

import { getInterviewOpportunity } from './screening'

test('high score produces an interview recommendation', () => {
  const result = getInterviewOpportunity({ total_score: 91, recommendation: '进入面试' })

  assert.equal(result.level, 'high')
  assert.equal(result.shouldInterview, true)
  assert.match(result.label, /面试/)
})

test('mid score asks for manual review before interview', () => {
  const result = getInterviewOpportunity({ total_score: 74, recommendation: '人工复核' })

  assert.equal(result.level, 'review')
  assert.equal(result.shouldInterview, true)
})

test('lower score is retained in the talent pool without interview priority', () => {
  const result = getInterviewOpportunity({ total_score: 63, recommendation: '进入人才库' })

  assert.equal(result.level, 'pool')
  assert.equal(result.shouldInterview, false)
})
