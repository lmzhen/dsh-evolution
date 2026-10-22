// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { recoverCommitJournals } from '../src/commit-recovery.ts'
import { snapshotPath, skillBodyPath } from '../src/commit-snapshot.ts'

it('restores the target from the pre-commit snapshot after a crash', async () => {
  const home = await tempRoot('dsh-merge-recovery-')
  const io = nodeEvolutionIo()
  const runId = 'run-1'
  const snapshot = { runId, target: 'umbrella', create: false, sources: ['a', 'b'], targetBody: 'old body', sourceBodies: [{ name: 'a', body: 'a body' }], at: '2026-10-22T00:00:00.000Z' }
  await io.writeText(snapshotPath(home, runId), JSON.stringify(snapshot))
  await io.writeText(skillBodyPath(home, 'umbrella'), 'new body')
  await io.writeText(join(home, 'merge', 'journals', runId + '.json'), JSON.stringify({ runId, target: 'umbrella', create: false, sources: ['a', 'b'], phase: 'target-written', updatedAt: 'x' }))
  const reports = await recoverCommitJournals(io, home, 1)
  assert.equal(reports.length, 1)
  assert.equal(reports[0]?.action, 'restored-target')
  assert.equal(await io.readText(skillBodyPath(home, 'umbrella')), 'old body')
  const recovery = JSON.parse(await io.readText(join(home, 'merge', 'recovery.json')) ?? '[]') as { ok: boolean }[]
  assert.equal(recovery[0]?.ok, true)
})
