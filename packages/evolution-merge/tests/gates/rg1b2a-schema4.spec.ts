// @tier pre-tag
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { mergeStatePath } from '../../src/state.ts'
import { normalizeV3State, readV4Readiness, transactMergeState, V4BlockedError } from '../../src/domain/schema4.ts'
import { ensureV3Ready } from '../../src/domain/state-bootstrap.ts'
import { normalizePairLedger } from '../../src/domain/pair-ledger.ts'
import { loadMergeState } from '../../src/state.ts'
import { stagingIndexPath } from '../../src/domain/staging-index.ts'
import { makeV4Home, v3Row } from '../support/schema4-home.ts'
import { parseLedger } from '../../src/domain/ledger.ts'

it('reports schema3 as normalize-required without writing', async () => {
  const home = await tempRoot('dsh-rg1b2a-v3-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [] }))
  const before = await readFile(mergeStatePath(home), 'utf8')
  const ready = await readV4Readiness(io, home)
  expect(ready).toMatchObject({ ok: false, code: 'merge-state-normalize-required' })
  await expect(transactMergeState(io, home, tx => tx.rows().length)).rejects.toBeInstanceOf(V4BlockedError)
  expect(await readFile(mergeStatePath(home), 'utf8')).toBe(before)
})

it('reports schema4 without a pre1b manifest as needs-repair', async () => {
  const home = await tempRoot('dsh-rg1b2a-nomanifest-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 4, rows: [] }))
  expect(await readV4Readiness(io, home)).toMatchObject({ ok: false, code: 'merge-state-needs-repair' })
})

it('accepts schema4 with manifest and writes rows through transactMergeState', async () => {
  const { home, io } = await makeV4Home([])
  expect(await readV4Readiness(io, home)).toMatchObject({ ok: true, schema: 4 })
  const created = await transactMergeState(io, home, tx => tx.createVerify({
    id: 'r1', pairKey: 'a\u0000b', a: 'a', b: 'b', state: 'verify', verifySubState: 'unverified',
    version: 0, createdAt: 'c', updatedAt: 'u', origin: 'agent', attempts: 0,
  }))
  expect(created.ok).toBe(true)
  const moved = await transactMergeState(io, home, tx => tx.transition('r1', { type: 'verify-passed', decision: { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['b'], rationale: 'r' }, target: 'a' }, 0))
  expect(moved.ok).toBe(true)
  const parsed = JSON.parse(await readFile(mergeStatePath(home), 'utf8')) as { schemaVersion: number; rows: unknown[]; pre1b?: unknown }
  expect(parsed.schemaVersion).toBe(4)
  expect(parsed.rows).toHaveLength(1)
  expect(parsed.pre1b).toBeDefined()
})

it('does not repair a marker index on the v4 path', async () => {
  const { home, io, backupId } = await makeV4Home([])
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 4, pre1b: { backupRef: backupId, at: 'x' }, migration: { migratedFromV2: true, sourceSha256: 's', targetSha256: 't', staging: [{ rowId: 'r1', pairKey: 'a', ref: 'run/pairs/r1', expiresAt: 1, createdAt: 1 }], at: 'x' }, rows: [] }))
  const before = await readFile(mergeStatePath(home), 'utf8')
  await transactMergeState(io, home, tx => tx.rows().length)
  const after = JSON.parse(await readFile(mergeStatePath(home), 'utf8')) as { schemaVersion: number; rows: unknown[] }
  expect(after).toMatchObject({ schemaVersion: 4, rows: [] })
  expect(await stat(stagingIndexPath(home, 'r1')).catch(() => null)).toBeNull()
})

it('reports schema5 as forward-only', async () => {
  const home = await tempRoot('dsh-rg1b2a-v5-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 5, rows: [] }))
  expect(await readV4Readiness(io, home)).toMatchObject({ ok: false, code: 'merge-state-forward-only' })
})

it('remove requires commit evidence and removes terminal rows', async () => {
  const { home, io } = await makeV4Home([v3Row({ state: 'approved', target: 'a', decision: { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['b'], rationale: 'r' } } as never)])
  const removed = await transactMergeState(io, home, tx => tx.remove('r1', 'committed', { unitId: 'u1', evidenceSha256: 'e1' }, 1))
  expect(removed.ok).toBe(true)
  const parsed = JSON.parse(await readFile(mergeStatePath(home), 'utf8')) as { rows: unknown[] }
  expect(parsed.rows).toHaveLength(0)
})

it('projects v3 rows to v4 purely without touching disk', () => {
  const v4 = normalizeV3State({ schemaVersion: 3, rows: [v3Row()] }, { backupRef: 'b', at: 'now' })
  expect(v4.schemaVersion).toBe(4)
  expect(v4.rows).toHaveLength(1)
  expect(v4.rows[0]).toMatchObject({ id: 'r1', state: 'verify' })
  expect('staging' in v4.rows[0]!).toBe(false)
  expect(parseLedger(JSON.stringify(v4))).toMatchObject({ ok: false, note: 'merge-state-forward-only' })
})

it('keeps the v3 readiness alias working while v4 readiness is separate', async () => {
  const home = await tempRoot('dsh-rg1b2a-v3alias-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [] }))
  expect(await ensureV3Ready(io, home)).toMatchObject({ ok: true })
  expect(await readV4Readiness(io, home)).toMatchObject({ ok: false, code: 'merge-state-normalize-required' })
})

it('normalizes v3 to v4 with backup and keeps the read adapter', async () => {
  const home = await tempRoot('dsh-rg1b2a-normalize-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const row = v3Row()
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [row] }))
  const result = await normalizePairLedger(io, home)
  expect(result).toMatchObject({ ok: true, migrated: true })
  const ready = await readV4Readiness(io, home)
  expect(ready).toMatchObject({ ok: true, schema: 4 })
  const loaded = await loadMergeState(io, home)
  expect(loaded.ok).toBe(true)
  expect(loaded.state.rows).toHaveLength(1)
  expect(loaded.state.rows[0]?.id).toBe('r1')
})
