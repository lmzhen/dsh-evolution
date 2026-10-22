// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { formatMergeError } from '../src/domain/errors.ts'

it('parameter errors are two lines max', () => {
  const text = formatMergeError({ kind: 'parameter', code: 'bad-pair', message: 'pair needs two skill names' })
  assert.equal(text.split('\n').length, 1)
  assert.match(text, /bad-pair/)
})

it('runtime errors carry stage and run id without raw body', () => {
  const text = formatMergeError({ kind: 'target', code: 'target-taken', message: 'target changed sk-abcdefghijklmnop', stage: 'commit', runId: 'run-1' })
  assert.equal(text.split('\n').length, 3)
  assert.match(text, /stage=commit/)
  assert.match(text, /run=run-1/)
  assert.doesNotMatch(text, /SKILL\.md/)
  assert.doesNotMatch(text, /sk-abcdefghijklmnop/)
  assert.match(text, /\[redacted\]/)
})

it('runtime errors have detail and next line', () => {
  const text = formatMergeError({ kind: 'runtime', code: 'source-gone', message: 'source disappeared', detail: 'alpha-skill was archived' })
  assert.equal(text.split('\n').length, 3)
  assert.match(text, /source-gone/)
  assert.match(text, /next:/)
})
