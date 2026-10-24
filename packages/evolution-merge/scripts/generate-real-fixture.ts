import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { pairKey, rowIdOf, upsertRow, type MergeRow } from '../src/index.ts'
import { writeJournal } from '../src/domain/commit-journal-store.ts'
const home = 'D:/dsh/tmp-g1-real-home'
const out = 'D:/dsh/harness-0.2.1/packages/evolution/evolution-merge/tests/fixtures/0.30.15/generated'
rmSync(home, { recursive: true, force: true })
rmSync(out, { recursive: true, force: true })
mkdirSync(home, { recursive: true })
const io = nodeEvolutionIo()
const at = Date.parse('2026-10-23T00:00:00.000Z')
const make = (a: string, b: string, state: MergeRow['state'], extra: Partial<MergeRow> = {}): MergeRow => {
  const key = pairKey(a, b)
  return { id: rowIdOf(key), pairKey: key, a, b, state, queue: state === 'pending' ? 'pending' : state === 'skipped' ? 'skipped' : state === 'fuse' || state === 'approved' ? 'fuse' : 'verify', createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(), ...extra }
}
const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'gamma-skill', sources: ['gamma-skill', 'delta-skill'], rationale: 'same' }
const rows = [make('alpha-skill','beta-skill','verify'), make('gamma-skill','delta-skill','pending',{decision}), make('epsilon-skill','zeta-skill','approved',{decision}), make('eta-skill','theta-skill','fuse',{decision,stagingRef:'run-1/pairs/abc'}), make('iota-skill','kappa-skill','skipped',{reason:'agent keep', origin:'agent'})]
for (const row of rows) await upsertRow(io, home, () => at, row)
await writeJournal(io, home, { runId: 'run-1', target: 'gamma-skill', create: false, sources: ['gamma-skill','delta-skill'], phase: 'prepared', updatedAt: new Date(at).toISOString() } as never)
mkdirSync(join(home, 'merge', 'receipts', 'run-1'), { recursive: true })
mkdirSync(join(home, 'merge', 'journals'), { recursive: true })
mkdirSync(join(home, 'merge', 'runs', 'run-1', 'pairs', 'abc'), { recursive: true })
writeFileSync(join(home, 'runs.json'), JSON.stringify({ schemaVersion: 1, runs: [{ id: 'run-1', kind: 'merge', command: 'scan', state: 'succeeded', startedAt: at, endedAt: at }] }, null, 2))
cpSync(join(home, 'merge'), join(out, 'merge'), { recursive: true })
cpSync(join(home, 'runs.json'), join(out, 'runs.json'))
console.log('GENERATED', out)