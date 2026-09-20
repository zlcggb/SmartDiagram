import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ScoreBadge } from './RecruitPrimitives'

test('ScoreBadge renders fallback score', () => {
  const html = renderToStaticMarkup(<ScoreBadge score={null} />)
  assert.match(html, /— 分/)
})

test('ScoreBadge renders strong-match tone content', () => {
  const html = renderToStaticMarkup(<ScoreBadge score={92} />)
  assert.match(html, /92 分/)
})
