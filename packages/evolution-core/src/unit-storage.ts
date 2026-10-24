/** G2 unit storage: opaque unitId -> Windows-safe storage key. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { EvolutionIoLike } from './io.ts'

export const UNIT_STORAGE_SCHEMA_VERSION = 1

export interface UnitSnapshot {
  readonly schemaVersion: typeof UNIT_STORAGE_SCHEMA_VERSION
  readonly unitId: string
  readonly planDigest: string
  readonly runId: string
  readonly target: string
  readonly targetExists: boolean
  readonly targetBefore: string | null
  readonly targetAfter?: string
  readonly supportBefore: readonly { path: string; content: string | null }[]
  readonly supportAfter: readonly { path: string; content: string }[]
  readonly sourceBefore: readonly { name: string; body: string }[]
  readonly origin: string
  readonly summary: string
  readonly createdAt: number
}

export interface UnitEvidenceRecord {
  readonly schemaVersion: typeof UNIT_STORAGE_SCHEMA_VERSION
  readonly unitId: string
  readonly runId: string
  readonly planDigest: string
  readonly state: 'target-only' | 'sources-partial' | 'complete'
  readonly target: { before: string | null; after: string; supportDigest: string; created: boolean }
  readonly sources: readonly { name: string; before: string; after: string | null; archived: boolean; absorbedInto: string }[]
  readonly mutations: number
  readonly at: number
}

export interface UnitIndexEntry {
  readonly unitId: string
  readonly storageKey: string
  readonly runId: string
  readonly planDigest: string
  readonly state: UnitEvidenceRecord['state']
  readonly receiptPath?: string
  readonly updatedAt: number
}

/** Stable, filesystem-safe key; unitId stays opaque (may contain ':' or '/'). */
export function unitStorageKey(unitId: string): string {
  return createHash('sha256').update(unitId).digest('hex')
}

export function unitSnapshotsDir(home: string): string {
  return join(home, 'merge', 'unit-snapshots')
}

export function unitSnapshotPath(home: string, unitId: string): string {
  return join(unitSnapshotsDir(home), unitStorageKey(unitId) + '.json')
}

export function unitEvidencePath(home: string, unitId: string): string {
  return join(home, 'merge', 'units', unitStorageKey(unitId), 'evidence.json')
}

export function unitIndexPath(home: string): string {
  return join(home, 'merge', 'unit-index.json')
}

export async function writeUnitSnapshot(io: EvolutionIoLike, home: string, snapshot: UnitSnapshot): Promise<string> {
  const path = unitSnapshotPath(home, snapshot.unitId)
  const content = JSON.stringify(snapshot, null, 2) + '\n'
  if (io.transact !== undefined) await io.transact(path, () => content)
  else await io.writeText(path, content)
  return path
}

export async function readUnitSnapshot(io: EvolutionIoLike, home: string, unitId: string): Promise<UnitSnapshot | null> {
  const raw = await io.readText(unitSnapshotPath(home, unitId))
  if (raw === null) return null
  try { return JSON.parse(raw) as UnitSnapshot } catch { return null }
}

export async function writeUnitEvidence(io: EvolutionIoLike, home: string, evidence: UnitEvidenceRecord): Promise<string> {
  const path = unitEvidencePath(home, evidence.unitId)
  const content = JSON.stringify(evidence, null, 2) + '\n'
  if (io.transact !== undefined) await io.transact(path, () => content)
  else await io.writeText(path, content)
  await upsertUnitIndex(io, home, {
    unitId: evidence.unitId,
    storageKey: unitStorageKey(evidence.unitId),
    runId: evidence.runId,
    planDigest: evidence.planDigest,
    state: evidence.state,
    updatedAt: evidence.at,
  })
  return path
}

export async function readUnitEvidence(io: EvolutionIoLike, home: string, unitId: string): Promise<UnitEvidenceRecord | null> {
  const raw = await io.readText(unitEvidencePath(home, unitId))
  if (raw === null) return null
  try { return JSON.parse(raw) as UnitEvidenceRecord } catch { return null }
}

export async function readUnitIndex(io: EvolutionIoLike, home: string): Promise<UnitIndexEntry[]> {
  const raw = await io.readText(unitIndexPath(home))
  if (raw === null) return []
  try { const parsed = JSON.parse(raw) as { entries?: UnitIndexEntry[] }; return Array.isArray(parsed.entries) ? parsed.entries : [] } catch { return [] }
}

export async function upsertUnitIndex(io: EvolutionIoLike, home: string, entry: UnitIndexEntry): Promise<void> {
  const path = unitIndexPath(home)
  const content = (current: string | null): string => {
    let entries: UnitIndexEntry[] = []
    if (current !== null) { try { entries = (JSON.parse(current) as { entries?: UnitIndexEntry[] }).entries ?? [] } catch { entries = [] } }
    const next = entries.filter(item => item.unitId !== entry.unitId).concat(entry)
    return JSON.stringify({ schemaVersion: UNIT_STORAGE_SCHEMA_VERSION, entries: next }, null, 2) + '\n'
  }
  if (io.transact !== undefined) await io.transact(path, content)
  else await io.writeText(path, content(await io.readText(path)))
}

export interface UnitReceiptRecord {
  readonly schemaVersion: typeof UNIT_STORAGE_SCHEMA_VERSION
  readonly unitId: string
  readonly runId: string
  readonly planDigest: string
  readonly target: string
  readonly archived: readonly string[]
  readonly at: number
}

export function unitReceiptPath(home: string, unitId: string): string {
  return join(home, 'merge', 'unit-receipts', unitStorageKey(unitId) + '.json')
}

export async function writeUnitReceipt(io: EvolutionIoLike, home: string, receipt: UnitReceiptRecord): Promise<string> {
  const path = unitReceiptPath(home, receipt.unitId)
  const text = JSON.stringify(receipt, null, 2) + '\n'
  if (io.transact !== undefined) await io.transact(path, () => text)
  else await io.writeText(path, text)
  return path
}

export async function readUnitReceipt(io: EvolutionIoLike, home: string, unitId: string): Promise<UnitReceiptRecord | null> {
  const raw = await io.readText(unitReceiptPath(home, unitId))
  if (raw === null) return null
  try { return JSON.parse(raw) as UnitReceiptRecord } catch { return null }
}
