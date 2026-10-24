// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo, writeUnitJournal } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { recoverCommitJournals } from '../src/commit-recovery.ts'

it('reports a crashed unit journal as manual-required', async () => {
  const home = await tempRoot('dsh-unit-recovery-report-')
  const io = nodeEvolutionIo()
  await writeUnitJournal(io, home, { schemaVersion: 1, unitId: 'run-1:abc', runId: 'run-1', planDigest: 'd', target: 'alpha', sources: [], phase: 'target-pending', storageKey: 'k', snapshotSha256: 's', updatedAt: 1 })
  const reports = await recoverCommitJournals(io, home, 2)
  const report = reports.find(item => item.unitId === 'run-1:abc')
  expect(report).toMatchObject({ action: 'unit-manual-required', ok: false, phase: 'target-pending' })
})
