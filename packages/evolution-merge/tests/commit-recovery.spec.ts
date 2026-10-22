// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { recoverCommitJournals } from '../src/commit-recovery.ts'
import { snapshotPath, skillBodyPath } from '../src/commit-snapshot.ts'
import { durableReceiptPath } from '../src/commit-receipt.ts'

it('restores the target from the pre-commit snapshot after a crash', async () => {
  const home = await tempRoot('dsh-merge-recovery-')
  const io = nodeEvolutionIo()
  const runId = 'run-1'
  const snapshot = { runId, target: 'umbrella', create: false, sources: ['a', 'b'], targetBody: 'old body', sourceBodies: [{ name: 'a', body: 'a body' }], at: '2026-10-22T00:00:00.000Z' }
  await io.writeText(snapshotPath(home, runId), JSON.stringify(snapshot))
  const root = join(home, 'skills')
  await io.writeText(skillBodyPath(root, 'umbrella'), 'new body')
  await io.writeText(join(home, 'merge', 'journals', runId + '.json'), JSON.stringify({ runId, target: 'umbrella', create: false, sources: ['a', 'b'], phase: 'target-written', updatedAt: 'x' }))
  const reports = await recoverCommitJournals(io, home, 1, root)
  assert.equal(reports.length, 1)
  assert.equal(reports[0]?.action, 'restored-target')
  assert.equal(await io.readText(skillBodyPath(root, 'umbrella')), 'old body')
  const recovery = JSON.parse(await io.readText(join(home, 'merge', 'recovery.json')) ?? '[]') as { ok: boolean }[]
  assert.equal(recovery[0]?.ok, true)
})

it('trusts a commit receipt over a stale journal', async () => {
  const home = await tempRoot('dsh-merge-recovery-receipt-')
  const io = nodeEvolutionIo()
  const runId = 'run-1'
  const root = join(home, 'skills')
  const snapshot = { runId, target: 'umbrella', create: true, sources: ['a'], targetBody: null, sourceBodies: [{ name: 'a', body: 'old' }], at: 'x' }
  await io.writeText(snapshotPath(home, runId), JSON.stringify(snapshot))
  await io.writeText(skillBodyPath(root, 'umbrella'), 'committed body')
  await io.writeText(durableReceiptPath(home, runId, runId), JSON.stringify({ runId, unitId: 'u1', target: 'umbrella', create: true, sources: ['a'], archived: ['a'], at: 1 }))
  await io.writeText(join(home, 'merge', 'journals', runId + '.json'), JSON.stringify({ runId, target: 'umbrella', create: true, sources: ['a'], phase: 'sources-archived', updatedAt: 'x' }))
  const reports = await recoverCommitJournals(io, home, 1, root)
  assert.equal(reports[0]?.action, 'receipt-committed')
  assert.equal(await io.readText(skillBodyPath(root, 'umbrella')), 'committed body')
  const journal = JSON.parse(await io.readText(join(home, 'merge', 'journals', runId + '.json')) ?? '{}') as { phase: string }
  assert.equal(journal.phase, 'committed')
})

it('skips a journal whose run is still active', async () => {
  const home = await tempRoot('dsh-merge-recovery-active-')
  const io = nodeEvolutionIo()
  const runId = 'run-1'
  const root = join(home, 'skills')
  await io.writeText(join(home, 'merge', 'journals', runId + '.json'), JSON.stringify({ runId, target: 'umbrella', create: false, sources: ['a'], phase: 'sources-archived', updatedAt: 'x' }))
  const reports = await recoverCommitJournals(io, home, 1, root, undefined, () => true)
  assert.equal(reports[0]?.action, 'skipped-active-run')
  const journal = JSON.parse(await io.readText(join(home, 'merge', 'journals', runId + '.json')) ?? '{}') as { phase: string }
  assert.equal(journal.phase, 'sources-archived')
})
