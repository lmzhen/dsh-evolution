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
  await draft.finalize?.()
  const rows = (await loadMergeState(io, home)).state.rows
  expect(rows.map(row => row.state)).toEqual(['skipped'])
})

it('records the model identity on a pending decision', async () => { const home = await tempRoot('dsh-merge-scan-model-'); const io = nodeEvolutionIo(); await runScan({ io, home, now: () => 1000, signal: new AbortController().signal, approval: true, model: 'deepseek-flash', ports: ports() }); const rows = (await loadMergeState(io, home)).state.rows; expect(rows).toHaveLength(2); expect(rows[0]?.decision?.model).toBe('deepseek-flash') })

it('records a validation failure as failed, not skipped', async () => { const home = await tempRoot('dsh-merge-scan-validation-'); const io = nodeEvolutionIo(); const draft = await runScan({ io, home, now: () => 1000, signal: new AbortController().signal, approval: false, ports: ports({ async round2() { return { kind: 'failed', failure: { stage: 'validate', code: 'merge-validation', message: 'bad tree', retryable: false, retryFrom: 'none' } } } }) }); expect(draft.totals.failed).toBe(1); expect(draft.pairs[0]?.outcome).toBe('failed'); const rows = (await loadMergeState(io, home)).state.rows; expect(rows.some(row => row.a === 'a' && row.b === 'b' && row.state === 'skipped')).toBe(false) });

it('puts L0/L1 report-only rows into the report without executing them', async () => {
  const home = await tempRoot('dsh-merge-scan-report-only-')
  const io = nodeEvolutionIo()
  const draft = await runScan({
    io, home, now: () => 1000, signal: new AbortController().signal, approval: false,
    ports: ports({ async screening() { return Object.assign([...candidates], { candidatePairs: 2, reportOnly: [{ a: 'x', b: 'y', gate: { level: 'L0' as const } }] }) } }),
  })
  expect(draft.reportOnly?.map(pair => pair.pairKey)).toContain('x\u0000y')
  expect(draft.pairs.map(pair => pair.outcome)).toEqual(['merged', 'kept'])
})

it('records natural lengths from a merged pair', async () => {
  const home = await tempRoot('dsh-merge-scan-lengths-')
  const io = nodeEvolutionIo()
  const draft = await runScan({ io, home, now: () => 1000, signal: new AbortController().signal, approval: false, ports: ports({ async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'], lengths: { bodyBytes: 10, fileBytes: 0, totalBytes: 10 } } } }) })
  expect(draft.pairs.find(pair => pair.outcome === 'merged')?.lengths).toEqual({ bodyBytes: 10, fileBytes: 0, totalBytes: 10 })
})

it('reports every pair and emits no plan/dry-run artifact', async () => {
  const home = await tempRoot('dsh-merge-scan-no-plan-')
  const io = nodeEvolutionIo()
  const draft = await runScan({ io, home, now: () => 1000, signal: new AbortController().signal, approval: false, ports: ports() })
  expect(draft.pairs.map(pair => pair.pairKey)).toHaveLength(2)
  expect('plan' in draft).toBe(false)
})

it('stops with remaining when the time budget is already exhausted', async () => {
  const home = await tempRoot('dsh-merge-scan-timeout-')
  const io = nodeEvolutionIo()
  const draft = await runScan({
    io, home, now: () => 10_000_000, startedAt: 0, timeoutMinutes: 1,
    signal: new AbortController().signal, approval: false, ports: ports(),
  })
  expect(draft.stopReason).toBe('timeout')
  expect(draft.remaining).toHaveLength(2)
  expect(draft.totals).toEqual({ merged: 0, kept: 0, pending: 0, failed: 0 })
})

it('cancelled before start leaves every candidate in remaining', async () => {
  const home = await tempRoot('dsh-merge-scan-cancelled-')
  const io = nodeEvolutionIo()
  const controller = new AbortController()
  controller.abort()
  const draft = await runScan({ io, home, now: () => 1000, signal: controller.signal, approval: false, ports: ports() })
  expect(draft.stopReason).toBe('cancelled')
  expect(draft.remaining).toHaveLength(2)
})

it('cancels after round1 and leaves the current candidate in remaining', async () => {
  const home = await tempRoot('dsh-merge-scan-cancel-round1-')
  const io = nodeEvolutionIo()
  const controller = new AbortController()
  const draft = await runScan({
    io, home, now: () => 1000, signal: controller.signal, approval: false,
    ports: ports({
      async round1(candidate) { controller.abort(); return candidate.a === 'a' ? { kind: 'merge', decision: DECISION } : { kind: 'keep' } },
    }),
  })
  expect(draft.stopReason).toBe('cancelled')
  expect(draft.remaining).toHaveLength(2)
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
  const pending = rows.find(row => row.state === 'pending')
  expect(pending?.decision).toEqual(DECISION)
  expect(pending?.stagingRef).toBeUndefined()
})
