// @tier pre-tag
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { ensureMergeStateReady, migrationJournalPath, migrationReportPath, readStateReadiness, v2BackupPath } from '../../src/domain/state-bootstrap.ts'
import { readStagingIndex, stagingIndexPath } from '../../src/domain/staging-index.ts'
import { dropRow, mergeStatePath, moveRow, mutateMergeState, upsertRow } from '../../src/state.ts'

const v2 = { schemaVersion: 2, rows: [
  { id: 'v', pairKey: 'a|b', a: 'a', b: 'b', state: 'verify', createdAt: 'c', updatedAt: 'u' },
  { id: 'p', pairKey: 'c|d', a: 'c', b: 'd', state: 'pending', target: { requested: 'c' }, decision: { shouldMerge: true, mode: 'merge-into-existing', target: 'c', sources: ['d'], rationale: 'r' }, stagingRef: 'run-1/pairs/c', stagingExpiresAt: 9, createdAt: 'c', updatedAt: 'u' },
] }
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

async function setup(): Promise<{ home: string; io: ReturnType<typeof nodeEvolutionIo> }> {
  const home = await tempRoot('dsh-rg1b-runtime-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify(v2))
  return { home, io }
}

it('migrates a v2 home on the first production write', async () => {
  const { home, io } = await setup()
  const raw = await readFile(mergeStatePath(home), 'utf8')
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
  const after = JSON.parse(await readFile(mergeStatePath(home), 'utf8')) as { schemaVersion: number; rows: unknown[]; migration?: { migratedFromV2?: boolean } }
  expect(after.schemaVersion).toBe(3)
  expect(after.migration?.migratedFromV2).toBe(true)
  expect(after.rows).toHaveLength(2)
  expect(await readFile(v2BackupPath(home), 'utf8')).toBe(raw)
  expect(JSON.parse(await readFile(migrationReportPath(home), 'utf8'))).toMatchObject({ ready: true })
})

it('is idempotent and does not rewrite an already-v3 home', async () => {
  const { home, io } = await setup()
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
  const first = hash(await readFile(mergeStatePath(home), 'utf8'))
  const second = await ensureMergeStateReady(io, home)
  expect(second).toMatchObject({ ok: true, migrated: false })
  expect(hash(await readFile(mergeStatePath(home), 'utf8'))).toBe(first)
})

it('serializes two concurrent boots', async () => {
  const { home, io } = await setup()
  const [a, b] = await Promise.all([ensureMergeStateReady(io, home), ensureMergeStateReady(io, home)])
  expect([a.ok, b.ok]).toEqual([true, true])
  const parsed = JSON.parse(await readFile(mergeStatePath(home), 'utf8')) as { schemaVersion: number; rows: unknown[] }
  expect(parsed.schemaVersion).toBe(3)
  expect(parsed.rows).toHaveLength(2)
  expect(await readFile(v2BackupPath(home), 'utf8')).toBe(JSON.stringify(v2))
})

it('keeps v2 and retries after a failed migration', async () => {
  const { home, io } = await setup()
  const raw = await readFile(mergeStatePath(home), 'utf8')
  await writeFile(v2BackupPath(home), 'different')
  const failed = await ensureMergeStateReady(io, home)
  expect(failed).toMatchObject({ ok: false, code: 'merge-state-migration-blocked' })
  expect(await readFile(mergeStatePath(home), 'utf8')).toBe(raw)
  await rm(v2BackupPath(home))
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
  expect(JSON.parse(await readFile(mergeStatePath(home), 'utf8')).schemaVersion).toBe(3)
})

it('completes a pending journal and tolerates a lost journal/report', async () => {
  const { home, io } = await setup()
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
  const target = await readFile(mergeStatePath(home), 'utf8')
  const journal = { version: 1, sourceSha256: hash(JSON.stringify(v2)), targetSha256: hash(target), rows: 2, quarantine: [], staging: [{ rowId: 'p', pairKey: 'c|d', ref: 'run-1/pairs/c', expiresAt: 9, createdAt: 1 }], backupPath: v2BackupPath(home), at: 'x' }
  await writeFile(migrationJournalPath(home), JSON.stringify(journal))
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
  expect(await readStagingIndex(io, home, 'p', 1)).toMatchObject({ rowId: 'p', ref: 'run-1/pairs/c', expiresAt: 9 })
  expect(await readFile(migrationJournalPath(home), 'utf8').catch(() => null)).toBeNull()
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
  await rm(migrationReportPath(home), { force: true })
  expect(await ensureMergeStateReady(io, home)).toMatchObject({ ok: false, code: 'merge-state-migration-blocked' })
})

it('rejects every legacy writer', async () => {
  const { home, io } = await setup()
  const row = { ...v2.rows[0], queue: 'verify' } as never
  await expect(mutateMergeState(io, home, () => 1, () => ({ rows: [], result: null }))).rejects.toThrow('legacy-writer-removed')
  await expect(upsertRow(io, home, () => 1, row)).rejects.toThrow('legacy-writer-removed')
  await expect(dropRow(io, home, () => 1, 'v')).rejects.toThrow('legacy-writer-removed')
  await expect(moveRow(io, home, () => 1, 'v', { queue: 'pending' })).rejects.toThrow('legacy-writer-removed')
})

it('requires the report while the migration marker still matches the rows', async () => {
  const { home, io } = await setup()
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
  await rm(migrationReportPath(home), { force: true })
  expect(await ensureMergeStateReady(io, home)).toMatchObject({ ok: false, code: 'merge-state-migration-blocked' })
})

it('repairs a missing staging index from the persistent marker', async () => {
  const { home, io } = await setup()
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
  await rm(stagingIndexPath(home, 'p'), { force: true })
  expect(await readStateReadiness(io, home)).toMatchObject({ ok: false, code: 'merge-state-migration-blocked' })
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
  expect(await readStagingIndex(io, home, 'p', 1)).toMatchObject({ rowId: 'p', ref: 'run-1/pairs/c', expiresAt: 9 })
})

it('drops the report requirement after rows have changed', async () => {
  const { home, io } = await setup()
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
  const changed = JSON.parse(await readFile(mergeStatePath(home), 'utf8')) as { rows: Array<{ updatedAt?: string }> }
  changed.rows[0] = { ...changed.rows[0], updatedAt: 'changed' }
  await writeFile(mergeStatePath(home), JSON.stringify(changed))
  await rm(migrationReportPath(home), { force: true })
  expect((await ensureMergeStateReady(io, home)).ok).toBe(true)
})
