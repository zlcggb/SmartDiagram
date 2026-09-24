import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ScoreBadge } from './RecruitPrimitives'

test('ScoreBadge renders fallback score', () => {
  const html = renderToStaticMarkup(<ScoreBadge score={null} />)
  assert.match(html.replace(/<[^>]+>/g, ''), /— \/ 100分/)
})

test('ScoreBadge renders strong-match tone content', () => {
  const html = renderToStaticMarkup(<ScoreBadge score={92} />)
  assert.match(html.replace(/<[^>]+>/g, ''), /92 \/ 100分/)
})

test('ScoreBadge renders the supplied maximum score', () => {
  const html = renderToStaticMarkup(<ScoreBadge score={7} maxScore={20} />)
  assert.match(html.replace(/<[^>]+>/g, ''), /7 \/ 20分/)
})
