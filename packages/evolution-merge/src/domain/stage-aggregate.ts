import { readTextOrNull, listOrEmpty } from './read-probe.ts'
/** 1b-1 shadow staging adoption. Production staging is still owned by the old staged writers. */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { readPairLedger } from './pair-ledger.ts'
import { readStagingIndex, writeStagingIndex, type StagingEntry } from './staging-index.ts'
import { createStaging, dropStaging, ensureStaging, readStaging, setStagingTarget, type CreateStagingInput, type CreateStagingResult } from '../staging.ts'

/**
 * Old production staging writers (grep baseline at Batch 1b-1). Their production
 * path is merge/staging-index + runs/<runId>/pairs/<hash>. adoptLegacy must never
 * call any of these; it only writes merge/.shadow/staging-index.
 */
export const LEGACY_STAGING_WRITER_FILES = [
  'src/scan-ports.ts',
  'src/scan-run.ts',
  'src/staging.ts',
  'src/new-child-authoring.ts',
  'src/domain/staging-index.ts',
  'src/state.ts',
  'src/domain/state-bootstrap.ts',
] as const

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
export interface StageAggregateRead {
  readonly entries: readonly StageEntry[]
  readonly shadowPath: string
}

interface MarkerStagingFact {
  readonly rowId: string
  readonly pairKey: string
  readonly ref: string
  readonly expiresAt: number
  readonly runId?: string
  readonly createdAt: number
}

export function shadowStagingIndexPath(home: string, rowId: string): string {
  return join(home, 'merge', '.shadow', 'staging-index', encodeURIComponent(rowId) + '.json')
}
export function shadowStagingRoot(home: string): string {
  return join(home, 'merge', '.shadow', 'staging-index')
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

/** Read-only adoption into the shadow index; never writes production staging-index. */
export async function adoptLegacy(io: EvolutionIoLike, home: string): Promise<ShadowAdoptResult> {
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
    if (row.state === 'pending') {
      if (await readStagingIndex(io, home, row.id, now) !== null) anomalies.push('pending-staging-index:' + row.id)
      continue
    }
    if (row.state === 'approved' && !entries.has(row.id)) {
      const old = await readStagingIndex(io, home, row.id, now)
      if (old !== null) entries.set(row.id, { version: 1, rowId: row.id, pairKey: row.pairKey, ...(row.runId === undefined ? {} : { runId: row.runId }), ref: old.ref, state: 'reserved', createdAt: old.createdAt, expiresAt: old.expiresAt, updatedAt: now })
    }
  }
  const adopted = [...entries.values()].sort((a, b) => a.rowId.localeCompare(b.rowId))
  let wrote = false
  for (const entry of adopted) {
    const path = shadowStagingIndexPath(home, entry.rowId)
    const text = JSON.stringify(entry, null, 2) + '\n'
    const current = await readTextOrNull(io, path)
    if (current !== null) {
      try {
        const previous = JSON.parse(current) as Partial<StageEntry>
        if (previous.rowId === entry.rowId && previous.state === entry.state && previous.ref === entry.ref && previous.expiresAt === entry.expiresAt) continue
      } catch { /* malformed shadow entry is replaced below */ }
    }
    if (io.transact !== undefined) await io.transact(path, () => text)
    else await io.writeText(path, text)
    wrote = true
  }
  return { entries: adopted, anomalies, shadowPath: shadowStagingRoot(home), wrote }
}

export async function readShadowStageAggregate(io: EvolutionIoLike, home: string, rowId?: string): Promise<StageAggregateRead> {
  if (rowId !== undefined) {
    const raw = await readTextOrNull(io, shadowStagingIndexPath(home, rowId))
    if (raw === null) return { entries: [], shadowPath: shadowStagingRoot(home) }
    try { return { entries: [JSON.parse(raw) as StageEntry], shadowPath: shadowStagingRoot(home) } } catch { return { entries: [], shadowPath: shadowStagingRoot(home) } }
  }
  const listed = await io.exists(shadowStagingRoot(home)) ? await io.list(shadowStagingRoot(home)) : []
  const entries: StageEntry[] = []
  for (const name of listed) {
    const raw = await readTextOrNull(io, join(shadowStagingRoot(home), name))
    if (raw === null) continue
    try { entries.push(JSON.parse(raw) as StageEntry) } catch { /* ignore malformed shadow */ }
  }
  entries.sort((a, b) => a.rowId.localeCompare(b.rowId))
  return { entries, shadowPath: shadowStagingRoot(home) }
}

/** 1b-2b execution order; kept here so 1b-2a tests can pin the contract. */
export const STAGE_WRITE_ORDER = ['index:reserved', 'tree', 'index:present'] as const
export type StageAdmission = { readonly ok: true } | { readonly ok: false; readonly message: string }
export function admitStage(rowState: string): StageAdmission {
  return rowState === 'approved' || rowState === 'fuse' ? { ok: true } : { ok: false, message: 'stage requires approved or fuse: ' + rowState }
}
export type ApprovedReservedPlan =
  | { readonly kind: 'transition-fuse'; readonly rowId: string; readonly ref: string; readonly expiresAt: number }
  | { readonly kind: 'write-present'; readonly rowId: string; readonly ref: string }
  | { readonly kind: 'drop-orphan'; readonly rowId: string }
  | { readonly kind: 'none' }
export function planApprovedReserved(rowState: string, entry: StageEntry | null): ApprovedReservedPlan {
  if (entry === null) return rowState === 'approved' || rowState === 'fuse' ? { kind: 'drop-orphan', rowId: '' } : { kind: 'none' }
  if (rowState === 'approved' && entry.state === 'reserved') return { kind: 'transition-fuse', rowId: entry.rowId, ref: entry.ref, expiresAt: entry.expiresAt }
  if (rowState === 'approved' && entry.state === 'present') return { kind: 'transition-fuse', rowId: entry.rowId, ref: entry.ref, expiresAt: entry.expiresAt }
  if (rowState === 'fuse' && entry.state === 'reserved') return { kind: 'write-present', rowId: entry.rowId, ref: entry.ref }
  return { kind: 'none' }
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
export async function ensureStageTree(io: EvolutionIoLike, home: string, input: CreateStagingInput): Promise<CreateStagingResult> { return await ensureStaging(io, home, input) }
export async function createStageTree(io: EvolutionIoLike, home: string, input: CreateStagingInput): Promise<CreateStagingResult> { return await createStaging(io, home, input) }
export async function readStageTree(io: EvolutionIoLike, home: string, runId: string): Promise<Awaited<ReturnType<typeof readStaging>>> { return await readStaging(io, home, runId) }
export async function setStageTreeTarget(io: EvolutionIoLike, home: string, stageKey: string, target: string, mode?: 'merge-into-existing' | 'create-umbrella' | 'keep'): Promise<boolean> { return await setStagingTarget(io, home, stageKey, target, mode) }
export async function dropStageTree(io: EvolutionIoLike, home: string, stageKey: string): Promise<void> { await dropStaging(io, home, stageKey) }
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
export async function dropStage(io: EvolutionIoLike, home: string, rowId: string, ref?: string): Promise<void> {
  await io.remove(join(home, 'merge', 'staging-index', encodeURIComponent(rowId) + '.json')).catch(() => {})
  if (ref !== undefined && ref !== '') await io.remove(join(home, 'merge', 'runs', ref)).catch(() => {})
}
export interface StageCleanupResult { readonly removed: readonly string[]; readonly expired: readonly string[]; readonly kept: readonly string[]; readonly orphans: readonly string[] }
/** Bounded cleanup: reserved/present TTL, pending/verify stale index removal, terminal/absent rows, orphan trees. */
export async function cleanupStage(io: EvolutionIoLike, home: string, now: number, rows: ReadonlyMap<string, { readonly state: string }>, limit = 100): Promise<StageCleanupResult> {
  const removed: string[] = []
  const expired: string[] = []
  const kept: string[] = []
  const orphans: string[] = []
  const refs = new Set<string>()
  const indexRoot = join(home, 'merge', 'staging-index')
  const names = await io.exists(indexRoot) ? await listOrEmpty(io, indexRoot) : []
  for (const name of names.slice(0, limit)) {
    if (!name.endsWith('.json')) continue
    const raw = await readTextOrNull(io, join(indexRoot, name))
    if (raw === null) continue
    let entry: Partial<StageEntry>
    try { entry = JSON.parse(raw) as Partial<StageEntry> } catch { continue }
    if (typeof entry.rowId !== 'string' || typeof entry.ref !== 'string' || typeof entry.expiresAt !== 'number') continue
    if (entry.ref !== '') refs.add(entry.ref)
    const row = rows.get(entry.rowId)
    const terminal = row === undefined || row.state === 'skipped'
    if (terminal || row?.state === 'pending' || row?.state === 'verify') { await dropStage(io, home, entry.rowId, entry.ref); removed.push(entry.rowId); continue }
    if (entry.expiresAt <= now) {
      if (entry.state === 'present') {
        // The index is the durable record both the read face and the resume path consult:
        // stamp it expired instead of leaving a present entry that reads as live elsewhere.
        try {
          await writeStagingIndex(io, home, { rowId: entry.rowId, pairKey: typeof entry.pairKey === 'string' ? entry.pairKey : '', ref: entry.ref, expiresAt: entry.expiresAt, createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : now, state: 'expired' })
        } catch { /* the read face still derives expired */ }
        expired.push(entry.rowId)
        continue
      }
      await dropStage(io, home, entry.rowId, entry.ref); removed.push(entry.rowId); continue
    }
    kept.push(entry.rowId)
  }
  const runRoot = join(home, 'merge', 'runs')
  const runNames = await io.exists(runRoot) ? await listOrEmpty(io, runRoot) : []
  for (const run of runNames.slice(0, limit)) {
    const prefix = run + '/'
    if ([...refs].some(ref => ref === run || ref.startsWith(prefix))) continue
    await io.remove(join(runRoot, run)).catch(() => {})
    orphans.push(run)
  }
  return { removed, expired, kept, orphans }
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
