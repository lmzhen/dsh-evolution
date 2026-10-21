// @tier pre-tag
import { expect, it } from 'vitest'
import { canRetry, transition, type MergeEvent, type MergeRow, type MergeFailure } from '../src/index.ts'

const AT = '2026-10-20T00:00:00.000Z'
const failure: MergeFailure = { stage: 'author', code: 'E', message: 'boom', retryable: true, retryFrom: 'agent2' }

function candidate(): MergeRow {
  const result = transition(undefined, { type: 'candidate', a: 'b-skill', b: 'a-skill', at: AT })
  if (!result.ok || result.row === null) throw new Error('candidate failed')
  return result.row
}

function apply(row: MergeRow, event: MergeEvent): MergeRow | null {
  const result = transition(row, event)
  if (!result.ok) throw new Error(result.message)
  return result.row
}

it('creates a verify row with a symmetric id', () => {
  const row = candidate()
  expect(row).toMatchObject({ state: 'verify', queue: 'retry', a: 'b-skill', b: 'a-skill', createdAt: AT })
  expect(row.pairKey).toBe('a-skill\u0000b-skill')
  expect(row.id).toMatch(/^mr_/)
  expect(apply(row, { type: 'candidate', a: 'a-skill', b: 'b-skill', at: AT })).toBe(row)
})

it('routes round1 keep/merge and approval to the right state', () => {
  const row = candidate()
  expect(apply(row, { type: 'round1-keep', at: AT })).toMatchObject({ state: 'skipped', queue: 'skipped', origin: 'agent' })
  expect(apply(row, { type: 'round1-merge', approval: 'on', at: AT })).toMatchObject({ state: 'pending', queue: 'pending' })
  expect(apply(row, { type: 'round1-merge', approval: 'off', at: AT })).toMatchObject({ state: 'fuse', queue: 'retry' })
  const failed = apply(row, { type: 'round1-fail', failure, at: AT })
  expect(failed).toMatchObject({ state: 'verify', queue: 'retry', failure, attempts: 1 })
})

it('approves, rejects, fails round2 and drops a committed row', () => {
  const pending = apply(candidate(), { type: 'round1-merge', approval: 'on', at: AT })
  const approved = apply(pending, { type: 'approve', runId: 'run-1', at: AT })
  expect(approved).toMatchObject({ state: 'fuse', queue: 'retry', runId: 'run-1' })
  expect(apply(pending, { type: 'reject', at: AT })).toMatchObject({ state: 'skipped', origin: 'human' })
  const failed = apply(approved, { type: 'round2-fail', failure, at: AT })
  expect(failed).toMatchObject({ state: 'fuse', attempts: 1, failure })
  expect(apply(failed, { type: 'round2-success', at: AT })).toBeNull()
})

it('restores a skipped row and refuses an invalid transition', () => {
  const skipped = apply(candidate(), { type: 'round1-keep', at: AT })
  expect(apply(skipped, { type: 'restore', at: AT })).toMatchObject({ state: 'verify', queue: 'retry' })
  const refused = transition(skipped, { type: 'approve', at: AT })
  expect(refused).toMatchObject({ ok: false, code: 'invalid-transition' })
  expect(transition(undefined, { type: 'approve', at: AT })).toMatchObject({ ok: false, code: 'invalid-transition' })
})
it('stops retrying after the attempt cap', () => {
  const row: MergeRow = { id: 'mr_x', pairKey: 'a\u0000b', a: 'a', b: 'b', state: 'verify', queue: 'retry', attempts: 2, createdAt: 'x', updatedAt: 'x' }
  const result = transition(row, { type: 'round1-fail', failure: { stage: 'decide', code: 'invalid', message: 'bad', retryable: true, retryFrom: 'agent1' }, at: 'y' })
  expect(result.ok).toBe(true)
  if (result.ok && result.row) expect(canRetry(result.row)).toBe(false)
})
