import { readTextOrNull, listOrEmpty } from './read-probe.ts'
/** 1b-1 shadow staging adoption. Production staging is still owned by the old staged writers. */
import { isAbsolute, join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { readPairLedger } from './pair-ledger.ts'
import { readStagingIndex, writeStagingIndex, type StagingEntry } from './staging-index.ts'
import { createStaging, readStaging, setStagingTarget, type CreateStagingInput, type CreateStagingResult } from '../staging.ts'

export type StageState = 'reserved' | 'present' | 'expired' | 'lost'
export interface StageEntry {
  readonly version: 1
  readonly rowId: string
  readonly pairKey: string
  readonly runId?: string
  readonly ref: string
  readonly root?: string
  readonly manifestPath?: string
  readonly state: StageState
  readonly createdAt: number
  readonly expiresAt: number
  readonly updatedAt: number
  readonly sourceDigest?: string
  readonly targetDigest?: string
  readonly manifestDigest?: string
  readonly sourceRevision?: string
  readonly targetRevision?: string
  readonly files?: readonly string[]
}
export interface ShadowAdoptResult {
  readonly entries: readonly StageEntry[]
  readonly anomalies: readonly string[]
  readonly shadowPath: string
  readonly wrote: boolean
}
interface MarkerStagingFact {
  readonly rowId: string
  readonly pairKey: string
  readonly ref: string
  readonly expiresAt: number
  readonly runId?: string
  readonly createdAt: number
}

function stagingTreePath(home: string, ref: string): string {
  return join(home, 'merge', 'runs', ref)
}
function markerStaging(migration: unknown): readonly MarkerStagingFact[] {
  if (migration === null || typeof migration !== 'object') return []
  const value = migration as Record<string, unknown>
  if (!Array.isArray(value.staging)) return []
  const facts: MarkerStagingFact[] = []
  for (const item of value.staging) {
    if (item === null || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (typeof entry.rowId !== 'string' || typeof entry.pairKey !== 'string' || typeof entry.ref !== 'string' || typeof entry.expiresAt !== 'number' || typeof entry.createdAt !== 'number') continue
    facts.push({ rowId: entry.rowId, pairKey: entry.pairKey, ref: entry.ref, expiresAt: entry.expiresAt, ...(typeof entry.runId === 'string' ? { runId: entry.runId } : {}), createdAt: entry.createdAt })
  }
  return facts
}

/** Production adoption for 1b-2b normalize; writes the existing staging-index, not shadow. */
export async function adoptLegacyProduction(io: EvolutionIoLike, home: string): Promise<ShadowAdoptResult> {
  const ledger = await readPairLedger(io, home)
  const entries = new Map<string, StageEntry>()
  const anomalies: string[] = []
  const now = Date.now()
  for (const fact of markerStaging(ledger.migration)) {
    const present = fact.ref !== '' && await io.exists(stagingTreePath(home, fact.ref))
    entries.set(fact.rowId, { version: 1, rowId: fact.rowId, pairKey: fact.pairKey, ...(fact.runId === undefined ? {} : { runId: fact.runId }), ref: fact.ref, state: present ? 'present' : 'lost', createdAt: fact.createdAt, expiresAt: fact.expiresAt, updatedAt: now })
  }
  for (const row of ledger.rows) {
    if (row.state === 'fuse' && !entries.has(row.id)) {
      if (row.staging.kind === 'present') entries.set(row.id, { version: 1, rowId: row.id, pairKey: row.pairKey, ...(row.runId === undefined ? {} : { runId: row.runId }), ref: row.staging.ref, state: 'present', createdAt: now, expiresAt: row.staging.expiresAt, updatedAt: now })
      else if (row.staging.kind === 'expired') entries.set(row.id, { version: 1, rowId: row.id, pairKey: row.pairKey, ...(row.runId === undefined ? {} : { runId: row.runId }), ref: row.staging.ref ?? '', state: 'expired', createdAt: now, expiresAt: row.staging.expiresAt, updatedAt: now })
      continue
    }
    if (row.state === 'pending') { if (await readStagingIndex(io, home, row.id, now) !== null) anomalies.push('pending-staging-index:' + row.id); continue }
    if (row.state === 'approved' && !entries.has(row.id)) {
      const old = await readStagingIndex(io, home, row.id, now)
      if (old !== null) entries.set(row.id, { version: 1, rowId: row.id, pairKey: row.pairKey, ...(row.runId === undefined ? {} : { runId: row.runId }), ref: old.ref, state: 'reserved', createdAt: old.createdAt, expiresAt: old.expiresAt, updatedAt: now })
    }
  }
  const adopted = [...entries.values()].sort((a, b) => a.rowId.localeCompare(b.rowId))
  let wrote = false
  for (const entry of adopted) {
    const current = await readStagingIndex(io, home, entry.rowId, 0)
    if (current !== null && current.ref === entry.ref && current.expiresAt === entry.expiresAt) continue
    await writeStagingIndex(io, home, { rowId: entry.rowId, pairKey: entry.pairKey, ref: entry.ref, expiresAt: entry.expiresAt, ...(entry.runId === undefined ? {} : { runId: entry.runId }), createdAt: entry.createdAt, state: entry.state })
    wrote = true
  }
  return { entries: adopted, anomalies, shadowPath: join(home, 'merge', 'staging-index'), wrote }
}

/** Production stage-tree facade. These wrappers keep the low-level tree module private to StageAggregate. */
export async function createStageTree(io: EvolutionIoLike, home: string, input: CreateStagingInput): Promise<CreateStagingResult> { return await createStaging(io, home, input) }
export async function readStageTree(io: EvolutionIoLike, home: string, runId: string): Promise<Awaited<ReturnType<typeof readStaging>>> { return await readStaging(io, home, runId) }
export async function setStageTreeTarget(io: EvolutionIoLike, home: string, stageKey: string, target: string, mode?: 'merge-into-existing' | 'create-umbrella' | 'keep'): Promise<boolean> { return await setStagingTarget(io, home, stageKey, target, mode) }
export async function writeStageIndex(io: EvolutionIoLike, home: string, entry: StagingEntry): Promise<void> { await writeStagingIndex(io, home, entry) }
export async function readStageIndex(io: EvolutionIoLike, home: string, rowId: string, now = Date.now()): Promise<StagingEntry | null> { return await readStagingIndex(io, home, rowId, now) }

export async function readStageEntry(io: EvolutionIoLike, home: string, rowId: string): Promise<StageEntry | null> {
  const raw = await readTextOrNull(io, join(home, 'merge', 'staging-index', encodeURIComponent(rowId) + '.json'))
  if (raw === null) return null
  try {
    const entry = JSON.parse(raw) as Partial<StageEntry>
    if (entry.rowId !== rowId || typeof entry.ref !== 'string' || typeof entry.expiresAt !== 'number') return null
    return entry as StageEntry
  } catch { return null }
}
export async function reserveStage(io: EvolutionIoLike, home: string, entry: StageEntry): Promise<void> {
  await writeStageIndex(io, home, { rowId: entry.rowId, pairKey: entry.pairKey, ref: entry.ref, expiresAt: entry.expiresAt, ...(entry.runId === undefined ? {} : { runId: entry.runId }), createdAt: entry.createdAt, state: 'reserved' })
}
export async function presentStage(io: EvolutionIoLike, home: string, entry: StageEntry): Promise<void> {
  await writeStageIndex(io, home, { rowId: entry.rowId, pairKey: entry.pairKey, ref: entry.ref, expiresAt: entry.expiresAt, ...(entry.runId === undefined ? {} : { runId: entry.runId }), createdAt: entry.createdAt, state: 'present' })
}
function safeRunTree(home: string, ref: string): string | null {
  const name = ref.trim()
  if (name === '' || name.includes('\\') || isAbsolute(name)) return null
  const parts = name.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) return null
  return join(home, 'merge', 'runs', ...parts)
}

export async function dropStage(io: EvolutionIoLike, home: string, rowId: string, ref?: string, onError?: (path: string, error: unknown) => void): Promise<void> {
  const index = join(home, 'merge', 'staging-index', encodeURIComponent(rowId) + '.json')
  await io.remove(index).catch(error => onError?.(index, error))
  if (ref !== undefined && ref !== '') {
    const tree = safeRunTree(home, ref)
    if (tree === null) {
      onError?.(join(home, 'merge', 'runs'), new Error('invalid staging ref: ' + JSON.stringify(ref)))
      return
    }
    await io.remove(tree).catch(error => onError?.(tree, error))
  }
}
export async function resetStageTree(io: EvolutionIoLike, home: string, ref: string): Promise<void> {
  const tree = safeRunTree(home, ref)
  if (tree === null) throw new Error('invalid staging ref: ' + JSON.stringify(ref))
  await io.remove(join(tree, 'merged'))
}

export interface StageCleanupFailure { readonly path: string; readonly message: string }
export interface StageCleanupResult { readonly removed: readonly string[]; readonly expired: readonly string[]; readonly kept: readonly string[]; readonly orphans: readonly string[]; readonly failures: readonly StageCleanupFailure[] }
/** Bounded cleanup: reserved/present TTL, pending/verify stale index removal, terminal/absent rows, orphan trees. */
export async function cleanupStage(io: EvolutionIoLike, home: string, now: number, rows: ReadonlyMap<string, { readonly state: string }>, limit = 100): Promise<StageCleanupResult> {
  const removed: string[] = []
  const expired: string[] = []
  const kept: string[] = []
  const orphans: string[] = []
  const failures: StageCleanupFailure[] = []
  const fail = (path: string, error: unknown): void => { failures.push({ path, message: error instanceof Error ? error.message : String(error) }) }
  const refs = new Set<string>()
  const indexRoot = join(home, 'merge', 'staging-index')
  const names = await io.exists(indexRoot) ? await listOrEmpty(io, indexRoot) : []
  // P1-7: refs must be collected from EVERY index before deleting run trees; the
  // limit only bounds how many orphan run dirs one sweep removes, never the ref set.
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const raw = await readTextOrNull(io, join(indexRoot, name))
    if (raw === null) continue
    let entry: Partial<StageEntry>
    try { entry = JSON.parse(raw) as Partial<StageEntry> } catch { continue }
    if (typeof entry.rowId !== 'string' || typeof entry.ref !== 'string' || typeof entry.expiresAt !== 'number') continue
    if (entry.ref !== '') refs.add(entry.ref)
    const row = rows.get(entry.rowId)
    const terminal = row === undefined || row.state === 'skipped'
    if (terminal || row?.state === 'pending' || row?.state === 'verify') { await dropStage(io, home, entry.rowId, entry.ref, fail); removed.push(entry.rowId); continue }
    if (entry.expiresAt <= now) {
      if (entry.state === 'present') {
        // The index is the durable record both the read face and the resume path consult:
        // stamp it expired instead of leaving a present entry that reads as live elsewhere.
        try {
          await writeStagingIndex(io, home, { rowId: entry.rowId, pairKey: typeof entry.pairKey === 'string' ? entry.pairKey : '', ref: entry.ref, expiresAt: entry.expiresAt, createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : now, state: 'expired' })
        } catch (error) { /* the read face still derives expired; visibility is still required */ fail(join(indexRoot, name), error) }
        expired.push(entry.rowId)
        continue
      }
      await dropStage(io, home, entry.rowId, entry.ref, fail); removed.push(entry.rowId); continue
    }
    kept.push(entry.rowId)
  }
  const runRoot = join(home, 'merge', 'runs')
  const runNames = await io.exists(runRoot) ? await listOrEmpty(io, runRoot) : []
  for (const run of runNames.slice(0, limit)) {
    const prefix = run + '/'
    if ([...refs].some(ref => ref === run || ref.startsWith(prefix))) continue
    const tree = safeRunTree(home, run)
    if (tree === null) { fail(join(runRoot, run), new Error('invalid run dir name: ' + JSON.stringify(run))); continue }
    await io.remove(tree).catch(error => fail(tree, error))
    orphans.push(run)
  }
  return { removed, expired, kept, orphans, failures }
}

/** Read all production v2 stage entries. */
export async function readAllStages(io: EvolutionIoLike, home: string): Promise<readonly StageEntry[]> {
  const root = join(home, 'merge', 'staging-index')
  const names = await io.exists(root) ? await listOrEmpty(io, root) : []
  const entries: StageEntry[] = []
  for (const name of names) {
    const raw = await readTextOrNull(io, join(root, name))
    if (raw === null) continue
    try {
      const entry = JSON.parse(raw) as Partial<StageEntry>
      if (typeof entry.rowId !== 'string' || typeof entry.ref !== 'string' || typeof entry.expiresAt !== 'number') continue
      entries.push(entry as StageEntry)
    } catch { /* skip malformed index */ }
  }
  return entries.sort((a, b) => a.rowId.localeCompare(b.rowId))
}
