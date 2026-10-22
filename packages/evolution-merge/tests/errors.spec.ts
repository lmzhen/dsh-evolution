// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { formatMergeError } from '../src/domain/errors.ts'

it('parameter errors are two lines max', () => {
  const text = formatMergeError({ kind: 'parameter', code: 'bad-pair', message: 'pair needs two skill names' })
  assert.equal(text.split('\n').length, 1)
  assert.match(text, /bad-pair/)
})

it('runtime errors have detail and next line', () => {
  const text = formatMergeError({ kind: 'runtime', code: 'source-gone', message: 'source disappeared', detail: 'alpha-skill was archived' })
  assert.equal(text.split('\n').length, 3)
  assert.match(text, /source-gone/)
  assert.match(text, /next:/)
})
