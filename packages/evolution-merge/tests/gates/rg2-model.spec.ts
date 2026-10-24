// @tier pre-tag
import { expect, it } from 'vitest'
import { isV3Row, transitionV3, type V3Event, type V3Row } from '../../src/domain/row-v3.ts'

const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }
const failure = { stage: 'commit' as const, code: 'x', message: 'x', retryable: true, retryFrom: 'agent2' as const }
const events: V3Event[] = [
  { type: 'verify-passed', decision, target: 'a' }, { type: 'approved', runId: 'u' }, { type: 'staged', ref: 's', expiresAt: 1 },
  { type: 'committed', unitId: 'u' }, { type: 'skipped', reason: 'r' }, { type: 'expired', kind: 'target-taken' },
  { type: 'failed', failure }, { type: 'superseded' }, { type: 'restored' }, { type: 'auto-approved', decision, target: 'a' },
]
const start = (): V3Row => ({ id: 'r', pairKey: 'a|b', a: 'a', b: 'b', version: 0, createdAt: 'c', updatedAt: 'u', origin: 'agent', state: 'verify', verifySubState: 'candidate', attempts: 0 })
let seed = 0x5eed
const random = (max: number): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max }
const oracle: Record<string, readonly string[]> = {
  verify: ['verify-passed', 'skipped', 'superseded', 'auto-approved', 'failed'],
  pending: ['approved', 'staged', 'skipped', 'expired', 'failed', 'superseded', 'auto-approved'],
  approved: ['staged', 'committed', 'skipped', 'failed', 'superseded'],
  fuse: ['staged', 'committed', 'skipped', 'failed', 'superseded'],
  skipped: ['restored', 'superseded'],
}

it('10k random event sequences never produce an invalid row', () => {
  let transitions = 0
  for (let run = 0; run < 20; run += 1) {
    let row: V3Row | null = start()
    const trace: string[] = []
    for (let step = 0; step < 500; step += 1) {
      if (row === null) row = start()
      const event = events[random(events.length)]!
      transitions += 1
      trace.push(row.state + ':' + event.type)
      const result = transitionV3(row, event, row.version, 'now')
      expect(result.ok, trace.join(',')).toBe(oracle[row.state]!.includes(event.type))
      if (result.ok) {
        if (result.row !== null) { expect(isV3Row(result.row), trace.join(',')).toBe(true); expect(result.row.version).toBe(row.version + 1) }
        row = result.row
      } else {
        expect(result.code, trace.join(',')).toBe('illegal-transition')
        expect(oracle[row.state]).not.toContain(event.type)
        expect(isV3Row(row)).toBe(true)
      }
    }
    expect(row === null || isV3Row(row)).toBe(true)
  }
  expect(transitions).toBeGreaterThanOrEqual(10000)
})
