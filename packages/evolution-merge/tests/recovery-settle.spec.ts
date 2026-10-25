// @tier pre-tag
// E2 (NFR-05 / GAP-P0-03): startup loads the run index first, then recovery settles a
// committed unit through the controlled orphan upgrade — a committed run can never stay
// failed(orphan), and a genuinely live/terminal run is never rewritten.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { newRunRegistry, nodeEvolutionIo, type UnitEvidenceRecord, type UnitJournal, type UnitTransaction } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { recoverCommitUnits } from '../src/recovery-coordinator.ts'
import { projectRecoveredUnit } from '../src/recovery-projection.ts'
import { readRunMeta } from '../src/domain/run-coordinator.ts'

const evidence: UnitEvidenceRecord = { schemaVersion: 1, unitId: 'u-1', runId: 'run-1', planDigest: 'd', state: 'complete', target: { before: 'old', after: 'new', supportDigest: '', created: false }, sources: [{ name: 'b', before: 'b', after: null, archived: true, absorbedInto: 'new' }], mutations: 1, at: 1 }
const journal: UnitJournal = { schemaVersion: 1, unitId: 'u-1', runId: 'run-1', planDigest: 'd', target: 'new', sources: ['b'], phase: 'committed', storageKey: 'k', snapshotSha256: 's', updatedAt: 1 }

function fakeUnit(): UnitTransaction {
  return {
    async prepare() { throw new Error('not used') }, async commit() { throw new Error('not used') }, async verify() { return evidence },
    async rollback() { return { ok: false as const, code: 'unit-committed' as const, message: 'no' } },
    async finalize() { return { ok: true as const, evidence } },
    async rollForward() { return { ok: true as const, evidence } },
    async cancel() { return { ok: false, phase: 'none' } },
  }
}

async function homeWithRun(row: Record<string, unknown>): Promise<string> {
  const home = await tempRoot('dsh-recovery-settle-')
  await mkdir(join(home, 'merge', 'unit-journals'), { recursive: true })
  await writeFile(join(home, 'merge', 'unit-journals', 'u.json'), JSON.stringify(journal))
  await writeFile(join(home, 'runs.json'), JSON.stringify({ schemaVersion: 2, runs: [row] }))
  return home
}

it('load() materializes the orphan verdict, then recovery upgrades it to succeeded', async () => {
  const home = await homeWithRun({ id: 'run-1', kind: 'merge', state: 'running', startedAt: 1, pid: 999_999 })
  const io = nodeEvolutionIo()
  const registry = newRunRegistry({ io, home, now: () => 5 })
  expect((await registry.load()).ok).toBe(true)
  expect(registry.find('run-1')?.state).toBe('failed')

  const reports = await recoverCommitUnits({ io, home, unit: fakeUnit(), now: () => 6, runs: registry })
  expect(reports[0]).toMatchObject({ action: 'finalize', ok: true })
  expect(registry.find('run-1')).toMatchObject({ state: 'succeeded' })
  const disk = JSON.parse(await readFile(join(home, 'runs.json'), 'utf8')) as { runs: { id: string; state: string }[] }
  expect(disk.runs.find(row => row.id === 'run-1')?.state).toBe('succeeded')
  expect((await readRunMeta(io, home, 'run-1'))?.phase).toBe('settled')
})

it('a run owned by a live process is never upgraded', async () => {
  const home = await homeWithRun({ id: 'run-1', kind: 'merge', state: 'running', startedAt: 1, pid: process.pid })
  const io = nodeEvolutionIo()
  const registry = newRunRegistry({ io, home, now: () => 5 })
  expect((await registry.load()).ok).toBe(true)
  expect(registry.find('run-1')?.state).toBe('running')
  expect(await registry.settleRecovered('run-1', { state: 'succeeded' })).toBe(false)
  expect(registry.find('run-1')?.state).toBe('running')
})

it('a genuine terminal verdict is terminal-once', async () => {
  const home = await homeWithRun({ id: 'run-1', kind: 'merge', state: 'failed', failure: 'merge failed', startedAt: 1, endedAt: 2, pid: 999_999 })
  const io = nodeEvolutionIo()
  const registry = newRunRegistry({ io, home, now: () => 5 })
  expect((await registry.load()).ok).toBe(true)
  expect(await registry.settleRecovered('run-1', { state: 'succeeded' })).toBe(false)
  expect(registry.find('run-1')).toMatchObject({ state: 'failed', failure: 'merge failed' })
})

it('the projection settles through settleRecovered, not the owner-only settle', async () => {
  const home = await tempRoot('dsh-recovery-projection-')
  const io = nodeEvolutionIo()
  const calls: string[] = []
  const result = await projectRecoveredUnit({
    io, home, runId: 'run-1', unitId: 'u-1', evidence, now: () => 5,
    runs: {
      async settle() { calls.push('settle') },
      async settleRecovered(id, outcome) { calls.push('settleRecovered:' + id + ':' + outcome.state); return true },
    },
  })
  expect(result).toMatchObject({ ok: true, action: 'projected' })
  expect(calls).toEqual(['settleRecovered:run-1:succeeded'])
})
