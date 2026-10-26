// @tier pre-tag
// E2 (FR-RUN-04): awaiting-approval is a fact about a completed scan/pair that left
// pending rows — never a mode flag, and never a screen for a failed/cancelled run.
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { readRunMeta } from '../src/domain/run-coordinator.ts'
import { withMergeRun, type MergeRegistryPort, type MergeRunReportDraft } from '../src/index.ts'

function registry(): MergeRegistryPort {
  return {
    async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 100 } },
    async stage() {},
    async settle() {},
  }
}

async function run(
  command: 'scan' | 'pair' | 'approve' | 'resume',
  approval: boolean,
  draft: Partial<MergeRunReportDraft> & { readonly stopReason: MergeRunReportDraft['stopReason'] },
): Promise<{ home: string; io: ReturnType<typeof nodeEvolutionIo> }> {
  const home = await tempRoot('dsh-awaiting-')
  const io = nodeEvolutionIo()
  await withMergeRun({
    io, home, registry: registry(), command, approval: { platformWrite: false, mergeApproval: approval },
    now: () => 200, ...(command === 'pair' ? { pairKey: 'a\u0000b' } : {}),
    async body() {
      return {
        scope: { candidatePairs: 1, queueBefore: { verify: 0, pending: 0, fuse: 0, skipped: 0 } },
        pairs: [], totals: { merged: 0, kept: 0, pending: 0, failed: 0 }, notes: [], ...draft,
      }
    },
  })
  return { home, io }
}

it('times out an in-flight run and settles it as failed', async () => {
  const home = await tempRoot('dsh-timeout-')
  const io = nodeEvolutionIo()
  let aborted = false
  const result = await withMergeRun({
    io, home, registry: registry(), command: 'scan', approval: { platformWrite: false, mergeApproval: false },
    now: () => 200, timeoutMinutes: 0.001,
    async body(ctx) {
      return await new Promise((_, reject) => {
        ctx.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })
      })
    },
  })
  expect(result.ok).toBe(false)
  expect(aborted).toBe(true)
  expect(await readRunMeta(io, home, 'run-1')).toMatchObject({ phase: 'settled', stopReason: 'timeout' })
})

it('a completed approval-on scan with pending rows is awaiting approval', async () => {
  const { home, io } = await run('scan', true, { stopReason: 'completed', totals: { merged: 0, kept: 0, pending: 2, failed: 0 } })
  const meta = await readRunMeta(io, home, 'run-1')
  expect(meta).toMatchObject({ phase: 'awaiting-approval', approval: 'pending', stopReason: 'completed' })
})

it('a completed approval-on pair with pending rows is awaiting approval', async () => {
  const { home, io } = await run('pair', true, { stopReason: 'completed', totals: { merged: 0, kept: 0, pending: 1, failed: 0 } })
  expect(await readRunMeta(io, home, 'run-1')).toMatchObject({ phase: 'awaiting-approval', approval: 'pending', pairKey: 'a\u0000b' })
})

it('a completed scan with no pending rows settled, even with approval on', async () => {
  const { home, io } = await run('scan', true, { stopReason: 'completed', totals: { merged: 1, kept: 0, pending: 0, failed: 0 } })
  expect(await readRunMeta(io, home, 'run-1')).toMatchObject({ phase: 'settled', approval: 'approved' })
})

it('failed and cancelled runs never read as awaiting approval', async () => {
  for (const stopReason of ['failed', 'cancelled', 'timeout'] as const) {
    const { home, io } = await run('scan', true, { stopReason, totals: { merged: 0, kept: 0, pending: 1, failed: 1 } })
    const meta = await readRunMeta(io, home, 'run-1')
    expect(meta?.phase, stopReason).toBe('settled')
    expect(meta?.approval, stopReason).toBe('approved')
  }
})

it('approve/resume never overwrite the run answer with awaiting-approval', async () => {
  for (const command of ['approve', 'resume'] as const) {
    const { home, io } = await run(command, true, { stopReason: 'completed', totals: { merged: 1, kept: 0, pending: 1, failed: 0 } })
    expect(await readRunMeta(io, home, 'run-1')).toMatchObject({ phase: 'settled', approval: 'approved' })
  }
})
