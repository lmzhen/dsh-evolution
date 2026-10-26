// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { readMergeReport, withMergeRun, type MergeRegistryPort } from '../src/index.ts'
import { readRunMeta } from '../src/domain/run-coordinator.ts'

function registry(): MergeRegistryPort & { calls: string[]; settled: unknown } {
  const calls: string[] = []
  let settled: unknown
  return {
    calls,
    get settled() { return settled },
    async begin(_kind, seed) { calls.push('begin:' + String(seed?.command)); return { id: 'run-1', signal: new AbortController().signal, startedAt: 100 } },
    async stage(id, stage) { calls.push('stage:' + stage) },
    async settle(id, outcome) { calls.push('settle:' + outcome.state); settled = outcome },
  }
}

it('writes the report before settling a successful run', async () => {
  const home = await tempRoot('dsh-merge-run-shell-')
  const io = nodeEvolutionIo()
  const reg = registry()
  const result = await withMergeRun({
    io, home, registry: reg, command: 'scan', approval: { platformWrite: true, mergeApproval: false },
    now: () => 200, total: 2,
    async body(ctx) {
      expect(ctx.runId).toBe('run-1')
      return {
        stopReason: 'completed', scope: { candidatePairs: 2, queueBefore: { verify: 0, pending: 0, fuse: 2, skipped: 0 } },
        pairs: [], totals: { merged: 0, kept: 0, pending: 0, failed: 0 }, notes: [],
      }
    },
  })
  expect(result.ok).toBe(true)
  expect(reg.calls).toEqual(['begin:scan', 'stage:screening', 'settle:succeeded'])
  const probe = await readMergeReport(io, home, 'run-1')
  expect(probe.kind).toBe('present')
  if (probe.kind === 'present') {
    expect(probe.value.processedPairs).toEqual(probe.value.pairs)
    expect(probe.value.remainingPairs).toBeUndefined()
  }
  expect((reg as unknown as { settled: { resultRef?: string; mergeStatus?: string } }).settled.resultRef).toContain('merge-run-1.json')
})

it('preserves pair natural lengths in the report', async () => {
  const home = await tempRoot('dsh-merge-run-shell-lengths-')
  const io = nodeEvolutionIo()
  const reg = registry()
  await withMergeRun({
    io, home, registry: reg, command: 'scan', approval: { platformWrite: false, mergeApproval: false },
    now: () => 200,
    async body() {
      return { stopReason: 'completed', scope: { candidatePairs: 1, queueBefore: { verify: 0, pending: 0, fuse: 0, skipped: 0 } }, pairs: [{ id: 'p1', pairKey: 'a\u0000b', a: 'a', b: 'b', queue: 'fuse', outcome: 'merged', archived: [], lengths: { bodyBytes: 10, fileBytes: 0, totalBytes: 10 } }], totals: { merged: 1, kept: 0, pending: 0, failed: 0 }, notes: [] }
    },
  })
  const probe = await readMergeReport(io, home, 'run-1')
  if (probe.kind !== 'present') throw new Error('report missing')
  expect(probe.value.pairs[0]?.lengths).toEqual({ bodyBytes: 10, fileBytes: 0, totalBytes: 10 })
})

it('records stagingRef and the claimed pair in run-meta', async () => {
  const home = await tempRoot('dsh-merge-run-shell-meta-')
  const io = nodeEvolutionIo()
  const reg = registry()
  await withMergeRun({
    io, home, registry: reg, command: 'approve', approval: { platformWrite: false, mergeApproval: true },
    now: () => 200, pairKey: 'a\u0000b', stagingRef: 'stage-1',
    async body() {
      return { stopReason: 'completed', scope: { candidatePairs: 1, queueBefore: { verify: 0, pending: 0, fuse: 1, skipped: 0 } }, pairs: [], totals: { merged: 0, kept: 0, pending: 0, failed: 0 }, notes: [] }
    },
  })
  const meta = await readRunMeta(io, home, 'run-1')
  expect(meta).toMatchObject({ stagingRef: 'stage-1', pairs: [{ pairKey: 'a\u0000b', state: 'pending' }] })
})

it('detached returns a run id before the body settles', async () => {
  const home = await tempRoot('dsh-merge-run-shell-detached-')
  const io = nodeEvolutionIo()
  const reg = registry()
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const result = await withMergeRun({
    io, home, registry: reg, command: 'scan', approval: { platformWrite: true, mergeApproval: false },
    now: () => 200, detached: true,
    async body() {
      await gate
      return {
        stopReason: 'completed', scope: { candidatePairs: 1, queueBefore: { verify: 0, pending: 0, fuse: 1, skipped: 0 } },
        pairs: [], totals: { merged: 0, kept: 0, pending: 0, failed: 0 }, notes: [],
      }
    },
  })
  expect(result).toMatchObject({ ok: true, accepted: true, runId: 'run-1' })
  expect(reg.calls).not.toContain('settle:succeeded')
  release()
  for (let i = 0; i < 2000 && !reg.calls.includes('settle:succeeded'); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(reg.calls).toContain('settle:succeeded')
})

it('waits for an aborted body before settling the timeout', async () => {
  const home = await tempRoot('dsh-merge-run-shell-timeout-')
  const io = nodeEvolutionIo()
  const reg = registry()
  let release = (): void => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let aborted = false
  const running = withMergeRun({
    io, home, registry: reg, command: 'scan', approval: { platformWrite: true, mergeApproval: false },
    now: () => 200, timeoutMinutes: 0.01, total: 1,
    async body(ctx) {
      if (ctx.signal.aborted) aborted = true
      else ctx.signal.addEventListener('abort', () => { aborted = true }, { once: true })
      await gate
      return {
        stopReason: 'cancelled', scope: { candidatePairs: 1, queueBefore: { verify: 0, pending: 0, fuse: 1, skipped: 0 } },
        pairs: [], totals: { merged: 0, kept: 0, pending: 0, failed: 0 }, notes: [],
      }
    },
  })
  for (let i = 0; i < 400 && !aborted; i += 1) await new Promise(resolve => setTimeout(resolve, 5))
  expect(aborted).toBe(true)
  expect(reg.calls).not.toContain('settle:cancelled')
  expect(reg.calls).not.toContain('settle:failed')
  release()
  const result = await running
  expect(result.ok).toBe(false)
  expect(reg.calls).toContain('settle:failed')
  const probe = await readMergeReport(io, home, 'run-1')
  expect(probe.kind).toBe('present')
  if (probe.kind === 'present') expect(probe.value.stopReason).toBe('timeout')
})

it('still writes a failed report when the body throws', async () => {
  const home = await tempRoot('dsh-merge-run-shell-fail-')
  const io = nodeEvolutionIo()
  const reg = registry()
  const result = await withMergeRun({
    io, home, registry: reg, command: 'pair', approval: { platformWrite: true, mergeApproval: true },
    now: () => 200,
    async body() { throw new Error('round boom') },
  })
  expect(result.ok).toBe(false)
  expect(reg.calls).toContain('settle:failed')
  const report = await readMergeReport(io, home, 'run-1')
  expect(report).toMatchObject({ kind: 'present', value: { stopReason: 'failed', notes: ['run body failed: round boom'] } })
})
