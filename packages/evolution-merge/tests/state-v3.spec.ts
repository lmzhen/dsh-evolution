// @tier pre-tag
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { loadOrMigrateStateV3, v2BackupPath } from '../src/domain/state-v3.ts'
import { loadMergeState, mergeStatePath, mutateMergeState, upsertRow } from '../src/state.ts'
import { mergeDoctor } from '../src/doctor.ts'
import { readStagingIndex } from '../src/domain/staging-index.ts'

const v2 = { schemaVersion: 2, rows: [
  { id: 'v', pairKey: 'a|b', a: 'a', b: 'b', state: 'verify', createdAt: 'c', updatedAt: 'u' },
  { id: 'p', pairKey: 'a|b', a: 'a', b: 'b', state: 'pending', target: { requested: 'a' }, decision: { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['b'], rationale: 'r' }, createdAt: 'c', updatedAt: 'u' },
] }

it('backs up v2 and writes schema 3 once', async () => {
  const home = await tempRoot('dsh-g3-state-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify(v2))
  const first = await loadOrMigrateStateV3(io, home)
  expect(first).toMatchObject({ ok: true, migrated: true })
  if (!first.ok) return
  expect(first.state.schemaVersion).toBe(3)
  expect(JSON.parse(await readFile(mergeStatePath(home), 'utf8')).schemaVersion).toBe(3)
  expect(JSON.parse(await readFile(v2BackupPath(home), 'utf8'))).toEqual(v2)
  expect((await stat(v2BackupPath(home))).mode & 0o200).toBe(0)
  const second = await loadOrMigrateStateV3(io, home)
  expect(second).toMatchObject({ ok: true, migrated: false })
})

it('maps the five-state v2 fixture to v3 with zero identity diff', async () => {
  const home = await tempRoot('dsh-g3-five-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }
  const five = { schemaVersion: 2, rows: [
    { id: 'v', pairKey: 'a|b', a: 'a', b: 'b', state: 'verify', createdAt: 'c', updatedAt: 'u' },
    { id: 'p', pairKey: 'a|b', a: 'a', b: 'b', state: 'pending', target: { requested: 'a' }, decision, createdAt: 'c', updatedAt: 'u' },
    { id: 'ap', pairKey: 'a|b', a: 'a', b: 'b', state: 'approved', target: { requested: 'a' }, decision, runId: 'r', createdAt: 'c', updatedAt: 'u' },
    { id: 'f', pairKey: 'a|b', a: 'a', b: 'b', state: 'fuse', target: { requested: 'a' }, decision, stagingRef: 's', stagingExpiresAt: 9, createdAt: 'c', updatedAt: 'u' },
    { id: 's', pairKey: 'a|b', a: 'a', b: 'b', state: 'skipped', reason: 'kept', createdAt: 'c', updatedAt: 'u' },
  ] }
  await writeFile(mergeStatePath(home), JSON.stringify(five))
  const loaded = await loadMergeState(io, home)
  expect(loaded.state.rows.map(row => row.id)).toEqual(['v', 'p', 'ap', 'f', 's'])
  await mutateMergeState(io, home, () => 1, rows => ({ rows, result: null }))
  const raw = JSON.parse(await readFile(mergeStatePath(home), 'utf8')) as { schemaVersion: number; rows: { id: string; pairKey: string; state: string }[] }
  expect(raw.schemaVersion).toBe(3)
  expect(raw.rows.map(row => [row.id, row.pairKey, row.state])).toEqual([['v', 'a|b', 'verify'], ['p', 'a|b', 'pending'], ['ap', 'a|b', 'approved'], ['f', 'a|b', 'fuse'], ['s', 'a|b', 'skipped']])
})

it('loads v2 and writes schema 3 through the main ledger', async () => {
  const home = await tempRoot('dsh-g3-cutover-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify(v2))
  const loaded = await loadMergeState(io, home)
  expect(loaded.ok).toBe(true)
  expect(loaded.state.rows).toHaveLength(2)
  await upsertRow(io, home, () => 1, { ...loaded.state.rows[0]!, state: 'skipped', reason: 'x' })
  const raw = JSON.parse(await readFile(mergeStatePath(home), 'utf8'))
  expect(raw.schemaVersion).toBe(3)
  expect(raw.rows.every((row: { version?: unknown }) => typeof row.version === 'number')).toBe(true)
})

it('migrates v2 stagingRef into the durable staging index', async () => {
  const home = await tempRoot('dsh-g3-staging-migrate-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const v2 = { schemaVersion: 2, rows: [{ id: 'p', pairKey: 'a|b', a: 'a', b: 'b', state: 'pending', target: { requested: 'a' }, decision: { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['b'], rationale: 'r' }, stagingRef: 'run-1/pairs/a', stagingExpiresAt: 9, createdAt: 'c', updatedAt: 'u' }] }
  await writeFile(mergeStatePath(home), JSON.stringify(v2))
  expect((await loadOrMigrateStateV3(io, home)).ok).toBe(true)
  expect(await readStagingIndex(io, home, 'p', 1)).toMatchObject({ rowId: 'p', ref: 'run-1/pairs/a', expiresAt: 9 })
})

it('doctor reports the state schema and pending v3 migration', async () => {
  const home = await tempRoot('dsh-g3-doctor-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 2, rows: [] }))
  const v2 = await mergeDoctor(io, home)
  expect(v2.find(item => item.key === 'merge-state-v3')).toMatchObject({ status: 'warn' })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [] }))
  const v3 = await mergeDoctor(io, home)
  expect(v3.find(item => item.key === 'merge-state-v3')).toMatchObject({ status: 'ok' })
})

it('refuses an invalid v3 row and leaves the file untouched', async () => {
  const home = await tempRoot('dsh-g3-state-invalid-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [{ id: 'x' }] }))
  expect(await loadOrMigrateStateV3(io, home)).toMatchObject({ ok: false, code: 'state-migration-blocked' })
})

it('refuses corrupt v2 and differing backup without touching v2', async () => {
  const home = await tempRoot('dsh-g3-state-bad-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), 'not json')
  expect(await loadOrMigrateStateV3(io, home)).toMatchObject({ ok: false, code: 'state-migration-blocked' })
  expect(await readFile(mergeStatePath(home), 'utf8')).toBe('not json')
  await writeFile(mergeStatePath(home), JSON.stringify(v2))
  await writeFile(v2BackupPath(home), 'different')
  expect(await loadOrMigrateStateV3(io, home)).toMatchObject({ ok: false, code: 'state-migration-blocked' })
  expect(await readFile(mergeStatePath(home), 'utf8')).toBe(JSON.stringify(v2))
})
