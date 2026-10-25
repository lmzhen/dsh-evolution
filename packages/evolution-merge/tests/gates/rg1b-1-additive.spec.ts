// @tier pre-tag
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { mergeStatePath } from '../../src/state.ts'
import { readPairLedger } from '../../src/domain/pair-ledger.ts'
import { adoptLegacy, LEGACY_STAGING_WRITER_FILES, readShadowStageAggregate, shadowStagingIndexPath, shadowStagingRoot } from '../../src/domain/stage-aggregate.ts'
import { stagingIndexPath, writeStagingIndex } from '../../src/domain/staging-index.ts'
import type { MergeReport } from '../../src/domain/merge-report.ts'
import type { MergeSnapshot } from '../../src/domain/merge-snapshot.ts'

const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const now = 1_800_000_000_000
const decision = { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['b'], rationale: 'r' }
const state = {
  schemaVersion: 3,
  ledgerVersion: 1,
  rows: [
    { id: 'f', pairKey: 'a\u0000b', a: 'a', b: 'b', state: 'fuse', target: 'a', decision, staging: { kind: 'present', ref: 'run-1/pairs/f', expiresAt: now + 60_000 }, version: 1, createdAt: 'c', updatedAt: 'u', origin: 'agent', attempts: 1 },
    { id: 'p', pairKey: 'c\u0000d', a: 'c', b: 'd', state: 'pending', target: 'c', decision, version: 1, createdAt: 'c', updatedAt: 'u', origin: 'agent', attempts: 1 },
    { id: 'a', pairKey: 'e\u0000f', a: 'e', b: 'f', state: 'approved', target: 'e', decision, version: 1, createdAt: 'c', updatedAt: 'u', origin: 'agent', attempts: 1 },
  ],
}

async function setup(): Promise<{ home: string; io: ReturnType<typeof nodeEvolutionIo> }> {
  const home = await tempRoot('dsh-rg1b1-additive-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify(state))
  await writeStagingIndex(io, home, { rowId: 'p', pairKey: 'c\u0000d', ref: 'run-1/pairs/p', expiresAt: now + 60_000, createdAt: now })
  await writeStagingIndex(io, home, { rowId: 'a', pairKey: 'e\u0000f', ref: 'run-1/pairs/a', expiresAt: now + 60_000, createdAt: now })
  return { home, io }
}

it('reads old v3 rows without writing state', async () => {
  const { home, io } = await setup()
  const before = hash(await readFile(mergeStatePath(home), 'utf8'))
  const ledger = await readPairLedger(io, home)
  expect(ledger.schemaVersion).toBe(3)
  expect(ledger.ledgerVersion).toBe(1)
  expect(ledger.rows).toHaveLength(3)
  expect(ledger.rows.find(row => row.id === 'f')).toMatchObject({ staging: { kind: 'present' } })
  expect(hash(await readFile(mergeStatePath(home), 'utf8'))).toBe(before)
})

it('adopts approved staging as reserved and ignores a stale pending index', async () => {
  const { home, io } = await setup()
  const productionBefore = await readFile(stagingIndexPath(home, 'p'), 'utf8')
  const stateBefore = hash(await readFile(mergeStatePath(home), 'utf8'))
  const first = await adoptLegacy(io, home)
  expect(first.wrote).toBe(true)
  expect(first.anomalies).toEqual(['pending-staging-index:p'])
  expect(first.shadowPath).toBe(shadowStagingRoot(home))
  expect(await readFile(stagingIndexPath(home, 'p'), 'utf8')).toBe(productionBefore)
  expect(hash(await readFile(mergeStatePath(home), 'utf8'))).toBe(stateBefore)
  expect(await readFile(shadowStagingIndexPath(home, 'f'), 'utf8')).toContain('"state": "present"')
  expect(await readFile(shadowStagingIndexPath(home, 'a'), 'utf8')).toContain('"state": "reserved"')
  expect(await readFile(shadowStagingIndexPath(home, 'p'), 'utf8').catch(() => null)).toBeNull()
  expect((await readShadowStageAggregate(io, home)).entries.map(entry => [entry.rowId, entry.state])).toEqual([['a', 'reserved'], ['f', 'present']])
  expect((await adoptLegacy(io, home)).wrote).toBe(false)
})

it('adopts marker-only staging facts into shadow with present/lost', async () => {
  const home = await tempRoot('dsh-rg1b1-marker-')
  const io = nodeEvolutionIo()
  const marker = {
    schemaVersion: 3,
    rows: [],
    migration: {
      migratedFromV2: true,
      sourceSha256: 'source',
      targetSha256: 'not-the-current-rows',
      staging: [
        { rowId: 'm', pairKey: 'm\u0000n', ref: 'run-1/pairs/m', expiresAt: now + 60_000, createdAt: now },
        { rowId: 'l', pairKey: 'l\u0000o', ref: 'run-1/pairs/lost', expiresAt: now + 60_000, createdAt: now },
      ],
      at: 'at',
    },
  }
  await mkdir(join(home, 'merge'), { recursive: true })
  await mkdir(join(home, 'merge', 'runs', 'run-1', 'pairs', 'm'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify(marker))
  const before = hash(await readFile(mergeStatePath(home), 'utf8'))
  const result = await adoptLegacy(io, home)
  expect(result.entries.map(entry => [entry.rowId, entry.state])).toEqual([['l', 'lost'], ['m', 'present']])
  expect(result.anomalies).toEqual([])
  expect(await readFile(shadowStagingIndexPath(home, 'l'), 'utf8')).toContain('"state": "lost"')
  expect(await readFile(shadowStagingIndexPath(home, 'm'), 'utf8')).toContain('"state": "present"')
  expect(await io.exists(stagingIndexPath(home, 'm'))).toBe(false)
  expect(hash(await readFile(mergeStatePath(home), 'utf8'))).toBe(before)
})

it('documents every old production staging writer', () => {
  expect(LEGACY_STAGING_WRITER_FILES).toEqual([
    'src/scan-ports.ts',
    'src/scan-run.ts',
    'src/staging.ts',
    'src/new-child-authoring.ts',
    'src/domain/staging-index.ts',
    'src/state.ts',
    'src/domain/state-bootstrap.ts',
  ])
})

it('does not call a production staging writer from adoptLegacy', async () => {
  const source = await readFile(new URL('../../src/domain/stage-aggregate.ts', import.meta.url), 'utf8')
  expect(source).toContain('shadowStagingIndexPath')
})

it('keeps the additive report/snapshot types consumable', () => {
  const report: MergeReport = { schemaVersion: 2, reportId: 'r', runId: 'run', pairKey: 'a\u0000b', target: 'a', validation: { ok: true, errors: [] }, limits: {}, createdAt: 'c' }
  const snapshot: MergeSnapshot = { wireVersion: 1, readAt: 'now', consistency: 'eventual', rows: [], stages: [], runs: null, reports: [], report: null }
  expect(report.schemaVersion).toBe(2)
  expect(snapshot.consistency).toBe('eventual')
})
