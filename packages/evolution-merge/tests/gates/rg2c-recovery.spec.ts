// @tier pre-tag
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, type UnitEvidenceRecord, type UnitJournal, type UnitTransaction } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { recoverCommitUnits } from '../../src/recovery-coordinator.ts'

const evidence: UnitEvidenceRecord = { schemaVersion: 1, unitId: 'u-1', runId: 'run-1', planDigest: 'd', state: 'complete', target: { before: 'old', after: 'new', supportDigest: '', created: false }, sources: [{ name: 'b', before: 'b', after: null, archived: true, absorbedInto: 'new' }], mutations: 1, at: 1 }
function journal(phase: UnitJournal['phase']): UnitJournal { return { schemaVersion: 1, unitId: 'u-1', runId: 'run-1', planDigest: 'd', target: 'new', sources: ['b'], phase, storageKey: 'k', snapshotSha256: 's', updatedAt: 1 } }
async function homeFor(phase: UnitJournal['phase']): Promise<string> {
  const home = await tempRoot('dsh-rg2c-recovery-')
  await mkdir(join(home, 'merge', 'unit-journals'), { recursive: true })
  await writeFile(join(home, 'merge', 'unit-journals', 'u.json'), JSON.stringify(journal(phase)))
  return home
}
function fake(calls: string[]): UnitTransaction {
  const ok = async (name: string) => { calls.push(name); return { ok: true as const, evidence } }
  return {
    async prepare() { throw new Error('not used') }, async commit() { throw new Error('not used') }, async verify() { return evidence },
    async rollback() { calls.push('rollback'); return { ok: true as const, evidence } },
    async finalize() { return await ok('finalize') },
    async rollForward() { return await ok('rollForward') },
    async cancel() { return { ok: false, phase: 'none' } },
  }
}
it('routes A/B/C/D and never rolls back a committed unit', async () => {
  const cases: [UnitJournal['phase'], string][] = [['prepared', 'A'], ['target-written', 'B'], ['support-pending', 'B'], ['source-archiving', 'B'], ['unit-written', 'C'], ['committed', 'D']]
  for (const [phase, branch] of cases) {
    const home = await homeFor(phase)
    const calls: string[] = []
    const reports = await recoverCommitUnits({ io: nodeEvolutionIo(), home, unit: fake(calls), now: () => 2 })
    expect(reports[0]?.branch, phase).toBe(branch)
    expect(calls.includes('rollback'), phase).toBe(phase === 'prepared')
    if (phase === 'committed') expect(calls).not.toContain('rollback')
  }
})

it('fault-injects recovery projection points and retries without rollback', async () => {
  for (const phase of ['merge-receipt', 'report', 'pair-index', 'run-meta', 'settle']) {
    const home = await homeFor('committed')
    const calls: string[] = []
    let fired = false
    const first = await recoverCommitUnits({ io: nodeEvolutionIo(), home, unit: fake(calls), now: () => 2, onProjectionPhase: async current => { if (current === phase && !fired) { fired = true; throw new Error('kill-' + phase) } } })
    expect(first[0]?.ok, phase).toBe(false)
    expect(calls).not.toContain('rollback')
    const retry = await recoverCommitUnits({ io: nodeEvolutionIo(), home, unit: fake(calls), now: () => 3 })
    expect(retry[0]?.ok, phase).toBe(true)
    expect(calls).not.toContain('rollback')
  }
})
