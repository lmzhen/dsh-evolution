// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { loadMergeState, runScan, type MergeCandidate, type MergeDecision, type ScanPorts } from '../src/index.ts'

const DECISION: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['a', 'b'], rationale: 'same', confidence: 0.9 }
const candidates: MergeCandidate[] = [{ a: 'a', b: 'b' }, { a: 'c', b: 'd' }]

function ports(overrides: Partial<ScanPorts> = {}): ScanPorts {
  return {
    async screening() { return candidates },
    async round1(candidate) {
      return candidate.a === 'a' ? { kind: 'merge', decision: DECISION } : { kind: 'keep' }
    },
    async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } },
    ...overrides,
  }
}

it('runs merge then keep, dropping the committed row and keeping the skipped row', async () => {
  const home = await tempRoot('dsh-merge-scan-')
  const io = nodeEvolutionIo()
  const draft = await runScan({ io, home, now: () => 1000, signal: new AbortController().signal, approval: false, ports: ports() })
  expect(draft.stopReason).toBe('completed')
  expect(draft.totals).toEqual({ merged: 1, kept: 1, pending: 0, failed: 0 })
  expect(draft.pairs.map(pair => pair.outcome)).toEqual(['merged', 'kept'])
  const rows = (await loadMergeState(io, home)).state.rows
  expect(rows.map(row => row.state)).toEqual(['skipped'])
})

it('approval on stops at pending without calling round2', async () => {
  const home = await tempRoot('dsh-merge-scan-approval-')
  const io = nodeEvolutionIo()
  let round2 = 0
  const draft = await runScan({
    io, home, now: () => 1000, signal: new AbortController().signal, approval: true,
    ports: ports({ async round2() { round2 += 1; return { kind: 'failed' } } }),
  })
  expect(draft.totals).toMatchObject({ pending: 1, kept: 1 })
  expect(round2).toBe(0)
  const rows = (await loadMergeState(io, home)).state.rows
  expect(rows.some(row => row.state === 'pending')).toBe(true)
})
