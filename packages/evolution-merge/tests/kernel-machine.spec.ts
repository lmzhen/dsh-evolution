// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { ALL_STATES, checkPair, closedReasonFor, FAILURE_CODES, failureOf, transition, type PairEvent, type PairSnapshot, type PairState } from '../src/kernel/index.ts'

function snap(state: PairState = 'candidate', version = 1): PairSnapshot {
  return { id: 'r1', pairKey: 'a\u0000b', a: 'a', b: 'b', state, version, createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z', attempts: 0 }
}
function apply(snapshot: PairSnapshot, event: PairEvent): PairSnapshot {
  const moved = transition(snapshot, event, snapshot.version)
  expect(moved.ok).toBe(true)
  if (!moved.ok) throw new Error(moved.message)
  expect(checkPair(moved.snapshot)).toEqual([])
  return moved.snapshot
}
const at = '2026-10-26T00:00:01.000Z'
const receipt = { unitId: 'u1', evidenceSha256: 'e1' }

describe('merge kernel state machine', () => {
  it('keeps a KEEP decision in closed, never as a failure', () => {
    let row = apply(snap(), { type: 'screen', at })
    row = apply(row, { type: 'decide', at, decision: 'keep', approval: 'off' })
    expect(row.state).toBe('closed')
    expect(row.closedReason).toBe('keep')
    expect(row.failure).toBeUndefined()
  })

  it('runs the approval-on happy path to committed and undone', () => {
    let row = apply(snap(), { type: 'screen', at })
    row = apply(row, { type: 'decide', at, decision: 'merge', approval: 'on', target: 'merged', runId: 'run1' })
    expect(row.state).toBe('pending')
    row = apply(row, { type: 'approve', at })
    row = apply(row, { type: 'author-start', at })
    row = apply(row, { type: 'staged', at, stageRef: 'stage1' })
    row = apply(row, { type: 'commit-start', at, unitId: 'u1' })
    row = apply(row, { type: 'commit-succeeded', at, receipt })
    expect(row.state).toBe('committed')
    row = apply(row, { type: 'undo', at })
    expect(row.state).toBe('undone')
  })

  it('bypasses pending when approval is off', () => {
    let row = apply(snap(), { type: 'screen', at })
    row = apply(row, { type: 'decide', at, decision: 'merge', approval: 'off', target: 'merged' })
    expect(row.state).toBe('approved')
  })

  it('routes a commit failure to failed, never closed', () => {
    let row = apply(snap(), { type: 'screen', at })
    row = apply(row, { type: 'decide', at, decision: 'merge', approval: 'off', target: 'merged' })
    row = apply(row, { type: 'author-start', at })
    row = apply(row, { type: 'staged', at, stageRef: 'stage1' })
    row = apply(row, { type: 'commit-start', at, unitId: 'u1' })
    row = apply(row, { type: 'commit-failed', at, failure: failureOf('commit-failed') })
    expect(row.state).toBe('failed')
    expect(row.closedReason).toBeUndefined()
    const retried = apply(row, { type: 'retry', at })
    expect(retried.state).toBe('candidate')
    expect(retried.failure).toBeUndefined()
  })

  it('uses unknown between a lost commit and recovery', () => {
    let row = apply(snap(), { type: 'screen', at })
    row = apply(row, { type: 'decide', at, decision: 'merge', approval: 'off', target: 'merged' })
    row = apply(row, { type: 'author-start', at })
    row = apply(row, { type: 'staged', at, stageRef: 'stage1' })
    row = apply(row, { type: 'commit-start', at, unitId: 'u1' })
    row = apply(row, { type: 'commit-unknown', at, reason: 'timeout' })
    expect(row.state).toBe('unknown')
    const recovered = apply(row, { type: 'recover', at, outcome: 'committed', receipt })
    expect(recovered.state).toBe('committed')
  })

  it('closes over-limit explicitly and rejects keep/reject through close', () => {
    let row = apply(snap(), { type: 'screen', at })
    row = apply(row, { type: 'decide', at, decision: 'merge', approval: 'off', target: 'merged' })
    row = apply(row, { type: 'author-start', at })
    row = apply(row, { type: 'close', at, reason: 'over-limit' })
    expect(row.state).toBe('closed')
    expect(row.closedReason).toBe('over-limit')
    const illegal = transition(snap(), { type: 'close', at, reason: 'keep' }, 1)
    expect(illegal.ok).toBe(false)
  })

  it('expires pending and staged, but not committed', () => {
    const pending = { ...snap('pending'), decision: { target: 'x', sources: ['a', 'b'] as const }, target: 'x', approval: 'on' as const }
    expect(apply(pending, { type: 'expire', at, reason: 'pending-ttl' }).state).toBe('expired')
    const staged = { ...snap('staged'), decision: { target: 'x', sources: ['a', 'b'] as const }, target: 'x', stageRef: 's' }
    expect(apply(staged, { type: 'expire', at, reason: 'staging-ttl' }).state).toBe('expired')
    expect(transition({ ...staged, state: 'committed', receipt, unitId: 'u1' }, { type: 'expire', at, reason: 'staging-ttl' }, 1).ok).toBe(false)
  })

  it('rejects version conflicts and illegal terminal transitions', () => {
    expect(transition(snap(), { type: 'screen', at }, 2).ok).toBe(false)
    const closed = { ...snap('closed'), closedReason: 'keep' as const }
    expect(transition(closed, { type: 'approve', at }, 1).ok).toBe(false)
    const failed = { ...snap('failed'), failure: failureOf('runtime') }
    expect(transition(failed, { type: 'reject', at }, 1).ok).toBe(false)
    const committing = { ...snap('committing'), unitId: 'u1', decision: { target: 'x', sources: ['a', 'b'] as const }, target: 'x' }
    expect(transition(committing, { type: 'cancel', at }, 1).ok).toBe(false)
    expect(transition(committing, { type: 'fail', at, failure: failureOf('timeout') }, 1).ok).toBe(false)
  })

  it('never maps a failure code to a closed reason', () => {
    for (const code of FAILURE_CODES) expect(closedReasonFor(code)).toBeUndefined()
    expect(closedReasonFor('merge-over-limit')).toBe('over-limit')
  })

  it('checks the structural invariants', () => {
    expect(checkPair({ ...snap('closed'), closedReason: 'keep' })).toEqual([])
    expect(checkPair({ ...snap('closed'), closedReason: 'keep', failure: failureOf('runtime') }).length).toBeGreaterThan(0)
    expect(checkPair(snap('failed')).length).toBeGreaterThan(0)
    expect(checkPair(snap('committed')).length).toBeGreaterThan(0)
    expect(checkPair(snap('pending')).length).toBeGreaterThan(0)
    expect(checkPair({ ...snap('committed'), receipt, unitId: 'u1' })).toEqual([])
  })
})

function validSnap(state: PairState): PairSnapshot {
  const row = snap(state)
  if (state === 'pending' || state === 'approved') return { ...row, decision: { target: 'x', sources: ['a', 'b'] as const }, target: 'x', approval: state === 'pending' ? 'on' : 'off' }
  if (state === 'staged') return { ...row, decision: { target: 'x', sources: ['a', 'b'] as const }, target: 'x', stageRef: 's' }
  if (state === 'committing') return { ...row, decision: { target: 'x', sources: ['a', 'b'] as const }, target: 'x', unitId: 'u1' }
  if (state === 'committed') return { ...row, decision: { target: 'x', sources: ['a', 'b'] as const }, target: 'x', unitId: 'u1', receipt }
  if (state === 'closed') return { ...row, closedReason: 'keep' }
  if (state === 'failed') return { ...row, failure: failureOf('runtime') }
  return row
}

function eventFor(type: PairEvent['type']): PairEvent {
  switch (type) {
    case 'screen': return { type, at }
    case 'decide': return { type, at, decision: 'merge', approval: 'off', target: 'x' }
    case 'approve': return { type, at }
    case 'reject': return { type, at }
    case 'author-start': return { type, at }
    case 'staged': return { type, at, stageRef: 's' }
    case 'commit-start': return { type, at, unitId: 'u1' }
    case 'commit-succeeded': return { type, at, receipt }
    case 'commit-failed': return { type, at, failure: failureOf('commit-failed') }
    case 'commit-unknown': return { type, at, reason: 'timeout' }
    case 'recover': return { type, at, outcome: 'committed', receipt }
    case 'close': return { type, at, reason: 'over-limit' }
    case 'expire': return { type, at, reason: 'pending-ttl' }
    case 'cancel': return { type, at }
    case 'fail': return { type, at, failure: failureOf('runtime') }
    case 'retry': return { type, at }
    case 'undo': return { type, at }
    case 'supersede': return { type, at }
  }
}

describe('merge kernel transition totality', () => {
  it('never throws and always returns a typed result for every state/event pair', () => {
    let legal = 0
    for (const state of ALL_STATES) {
      for (const eventType of ['screen','decide','approve','reject','author-start','staged','commit-start','commit-succeeded','commit-failed','commit-unknown','recover','close','expire','cancel','fail','retry','undo','supersede'] as const) {
        const result = transition(validSnap(state), eventFor(eventType), 1)
        expect(typeof result.ok).toBe('boolean')
        if (result.ok) {
          legal += 1
          expect(checkPair(result.snapshot)).toEqual([])
        }
      }
    }
    expect(legal).toBeGreaterThan(0)
  })
})
