// @tier pre-tag
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { loadOrMigrateStateV3, v2BackupPath } from '../../src/domain/state-v3.ts'
import { loadMergeState, mergeStatePath } from '../../src/state.ts'

const fixture = fileURLToPath(new URL('../fixtures/0.30.15/generated/merge/merge-state.json', import.meta.url))
const hash = (bytes: string): string => createHash('sha256').update(bytes).digest('hex')

it('applies the real 0.30.15 fixture once and verifies identity', async () => {
  const home = await tempRoot('dsh-rg1b-apply-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const v2 = await readFile(fixture, 'utf8')
  await writeFile(mergeStatePath(home), v2)
  const before = JSON.parse(v2) as { rows: { id: string; state: string }[] }
  const first = await loadOrMigrateStateV3(io, home)
  expect(first).toMatchObject({ ok: true, migrated: true })
  if (!first.ok) return
  expect(first.state.rows.map(row => [row.id, row.state])).toEqual(before.rows.map(row => [row.id, row.state]))
  expect(await readFile(v2BackupPath(home), 'utf8')).toBe(v2)
  expect((await stat(v2BackupPath(home))).mode & 0o200).toBe(0)
  const v3 = await readFile(mergeStatePath(home), 'utf8')
  expect(JSON.parse(v3).schemaVersion).toBe(3)
  const second = await loadOrMigrateStateV3(io, home)
  expect(second).toMatchObject({ ok: true, migrated: false })
  expect(hash(await readFile(mergeStatePath(home), 'utf8'))).toBe(hash(v3))
  const loaded = await loadMergeState(io, home)
  expect(loaded.ok).toBe(true)
  expect(loaded.state.rows).toHaveLength(before.rows.length)
})

it('refuses corrupt v2 and a future v4 state', async () => {
  const home = await tempRoot('dsh-rg1b-corrupt-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const corrupt = fileURLToPath(new URL('../fixtures/0.30.15/corrupt/truncated-state.json', import.meta.url))
  const bytes = await readFile(corrupt, 'utf8')
  await writeFile(mergeStatePath(home), bytes)
  expect(await loadOrMigrateStateV3(io, home)).toMatchObject({ ok: false, code: 'state-migration-blocked' })
  expect(await readFile(mergeStatePath(home), 'utf8')).toBe(bytes)
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 4, rows: [] }))
  const future = await loadMergeState(io, home)
  expect(future.ok).toBe(false)
  expect(future.note).toBe('merge-state-forward-only')
})
