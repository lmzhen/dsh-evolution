// @tier pre-tag
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { retryMergeReport, withMergeRun } from '../../src/run-shell.ts'
import type { MergeReport } from '../../src/contracts.ts'

const report: MergeReport = { schemaVersion: 2, runId: 'run-1', kind: 'merge', command: 'approve', startedAt: 1, endedAt: 2, stopReason: 'completed', approval: { platformWrite: false, mergeApproval: true }, scope: { candidatePairs: 1, queueBefore: { verify: 0, pending: 0, fuse: 0, skipped: 0 } }, pairs: [], totals: { merged: 0, kept: 0, pending: 0, failed: 0 }, notes: [] }

it('report failure settles failed and does not run post-report finalize', async () => {
  const { home } = { home: await tempRoot('dsh-rg2a-report-') }
  const base = nodeEvolutionIo()
  let finalized = false
  const io = { ...base, writeText: async (path: string, text: string) => { if (path.includes('reports')) throw new Error('report disk full'); await base.writeText(path, text) }, remove: base.remove, rename: base.rename }
  const result = await withMergeRun({
    io, home, command: 'approve', approval: { platformWrite: false, mergeApproval: true }, now: () => 2,
    registry: { async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 1 } }, async stage() {}, async settle() {} },
    body: async () => ({ stopReason: 'completed', scope: report.scope, pairs: [], totals: report.totals, notes: [], finalize: async () => { finalized = true } }),
  })
  expect(result.ok).toBe(false)
  expect(finalized).toBe(false)
})

it('retryMergeReport is idempotent for the same report', async () => {
  const home = await tempRoot('dsh-rg2a-retry-')
  const io = nodeEvolutionIo()
  const first = await retryMergeReport(io, home, report)
  const second = await retryMergeReport(io, home, report)
  expect(second).toBe(first)
  expect(await readFile(first, 'utf8')).toContain('"runId": "run-1"')
  expect(first).toBe(join(home, 'reports', 'merge-run-1.json'))
})
