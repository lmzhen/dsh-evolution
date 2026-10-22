// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { fitToolText } from '../src/presentation-budget.ts'

it('keeps small text untouched and caps large text at 8000', () => {
  assert.equal(fitToolText('ok'), 'ok')
  const big = 'a'.repeat(20000)
  const fitted = fitToolText(big)
  assert.ok(fitted.length <= 8000)
  assert.match(fitted, /truncated/)
  assert.ok(fitted.startsWith('a'))
  assert.ok(fitted.endsWith('a'))
})
