// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { sourceRevisionOf, targetRevisionOf } from '../src/revision.ts'

it('changes the pair revision when a support file changes', () => {
  const base = { name: 'a', description: 'a', body: 'body', managed: true }
  const other = { name: 'b', description: 'b', body: 'body', managed: true }
  const first = sourceRevisionOf([{ ...base, files: [{ path: 'references/x.md', content: 'one' }] }, other], 'a', 'b')
  const second = sourceRevisionOf([{ ...base, files: [{ path: 'references/x.md', content: 'two' }] }, other], 'a', 'b')
  assert.notEqual(first, second)
  assert.equal(targetRevisionOf([base], 'a'), targetRevisionOf([base], 'a'))
  assert.equal(targetRevisionOf([base], 'missing'), undefined)
})
