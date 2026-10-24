// @tier pre-tag
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { loadOrMigrateStateV3 } from '../../src/domain/state-v3.ts'
import { mergeStatePath } from '../../src/state.ts'

const fixture = fileURLToPath(new URL('../fixtures/0.30.15/generated/merge/merge-state.json', import.meta.url))

it('reconciles v2 identity fields against the v3 result', async () => {
  const home = await tempRoot('dsh-rg1b-reconcile-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const raw = await readFile(fixture, 'utf8')
  await writeFile(mergeStatePath(home), raw)
  const v2 = JSON.parse(raw) as { rows: Array<Record<string, unknown>> }
  const result = await loadOrMigrateStateV3(io, home)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const v3 = result.state.rows
  expect(v3).toHaveLength(v2.rows.length)
  const projection = (rows: readonly Record<string, unknown>[]) => rows.map(row => {
    const decision = row.decision as { shouldMerge?: boolean; mode?: string; target?: string; sources?: readonly string[] } | undefined
    const staging = row.staging as { kind?: string; ref?: string; expiresAt?: number } | undefined
    return {
      id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, state: row.state,
      queue: row.state === 'pending' || row.state === 'approved' ? 'pending' : row.state,
      decision, target: typeof row.target === 'string' ? row.target : (row.target as { requested?: string } | undefined)?.requested ?? decision?.target,
      sourceRevision: row.sourceRevision, targetRevision: row.targetRevision, runId: row.runId,
      staging: staging !== undefined
        ? { kind: staging.kind, ref: staging.ref, expiresAt: staging.expiresAt }
        : row.stagingRef !== undefined
          ? row.stagingExpiresAt !== undefined ? { kind: 'present', ref: row.stagingRef, expiresAt: row.stagingExpiresAt } : { kind: 'expired', ref: row.stagingRef, expiresAt: 0 }
          : { kind: 'absent', ref: undefined, expiresAt: undefined },
    }
  })
  const identitySame = JSON.stringify(projection(v3 as unknown as Record<string, unknown>[])) === JSON.stringify(projection(v2.rows))
  const counts = (states: readonly string[]) => Object.fromEntries(['verify', 'pending', 'approved', 'fuse', 'skipped'].map(state => [state, states.filter(value => value === state).length]))
  const expectedCounts = { verify: 1, pending: 1, approved: 1, fuse: 1, skipped: 1 }
  expect(identitySame).toBe(true)
  expect(counts(v3.map(row => row.state))).toEqual(expectedCounts)

  const receiptDir = fileURLToPath(new URL('../fixtures/0.30.15/receipts', import.meta.url))
  const journalDir = fileURLToPath(new URL('../fixtures/0.30.15/journals', import.meta.url))
  const receiptFiles = (await readdir(receiptDir)).filter(name => name.endsWith('.json')).sort()
  const journalFiles = (await readdir(journalDir)).filter(name => name.endsWith('.json')).sort()
  const receipts = await Promise.all(receiptFiles.map(name => readFile(join(receiptDir, name), 'utf8')))
  const journals = await Promise.all(journalFiles.map(name => readFile(join(journalDir, name), 'utf8')))
  const unitIds = receipts.map(bytes => (JSON.parse(bytes) as { unitId?: string }).unitId).filter(Boolean)
  const archived = receipts.flatMap(bytes => (JSON.parse(bytes) as { archived?: string[] }).archived ?? [])
  const phases = journals.map(bytes => (JSON.parse(bytes) as { phase?: string }).phase).filter(Boolean)
  const artifactHash = createHash('sha256').update(receipts.join('')).update(journals.join('')).digest('hex')
  expect(unitIds).toHaveLength(4)
  expect(archived.length).toBeGreaterThan(0)
  expect(phases).toContain('committed')
  const receiptObjects = receipts.map(bytes => JSON.parse(bytes) as { runId?: string; unitId?: string; archived?: string[] })
  const journalObjects = journals.map(bytes => JSON.parse(bytes) as { runId?: string; phase?: string })
  const receiptByRun = new Map(receiptObjects.filter(item => item.runId !== undefined).map(item => [item.runId!, item]))
  const journalByRun = new Map(journalObjects.filter(item => item.runId !== undefined).map(item => [item.runId!, item]))
  const links = (rows: readonly Record<string, unknown>[]) => rows.map(row => {
    const runId = row.runId as string | undefined
    const receipt = runId === undefined ? undefined : receiptByRun.get(runId)
    const journal = runId === undefined ? undefined : journalByRun.get(runId)
    return { id: row.id, runId: runId ?? null, unitId: receipt?.unitId ?? null, archived: receipt?.archived ?? [], phase: journal?.phase ?? null }
  })
  const v2Links = links(v2.rows)
  const v3Links = links(v3 as unknown as Record<string, unknown>[])
  const linkSame = JSON.stringify(v2Links) === JSON.stringify(v3Links)
  const same = identitySame && linkSame && JSON.stringify(counts(v3.map(row => row.state))) === JSON.stringify(expectedCounts)
  expect(linkSame).toBe(true)
  expect(same).toBe(true)
  await writeFile(join(home, 'reconciliation.json'), JSON.stringify({ same, identitySame, linkSame, rows: v3.length, states: counts(v3.map(row => row.state)), links: v3Links, unitIds: unitIds.length, receipts: receiptFiles.length, journals: journalFiles.length, phases: [...new Set(phases)], archived: archived.length, artifactHash }, null, 2) + '\n')
})
