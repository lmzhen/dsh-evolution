import { readTextOrNull } from './read-probe.ts'
/** G3 Batch -1 state bootstrap: one readiness gate, backup/journal migration. */
import { createHash } from 'node:crypto'
import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { migrateV2ToV3, type QuarantinedRow, type V3State } from './migrate-v3.ts'
import { isV3Row, type V3Row } from './row-v3.ts'
import { stagingIndexPath, writeStagingIndex } from './staging-index.ts'

export function mergeStatePath(home: string): string { return join(home, 'merge', 'merge-state.json') }
export function v2BackupPath(home: string): string { return join(home, 'merge', 'merge-state.v2.bak.json') }
export function migrationJournalPath(home: string): string { return join(home, 'merge', 'merge-state.migration.json') }
export function migrationReportPath(home: string): string { return join(home, 'merge', 'merge-state.migration.report.json') }
export function quarantinePath(home: string): string { return join(home, 'merge', 'merge-state.quarantine.json') }

export type StateBlockCode = 'merge-state-migration-required' | 'merge-state-migration-blocked' | 'merge-state-needs-repair' | 'merge-state-forward-only'

export interface MigrationReport {
  readonly version: 1
  readonly ready: boolean
  readonly migrated: boolean
  readonly sourceSha256?: string
  readonly targetSha256?: string
  readonly rows?: number
  readonly quarantined?: number
  readonly backupReadOnly?: boolean
  readonly at: string
  readonly steps: readonly string[]
}

export type StateReadiness =
  | { readonly ok: true; readonly schema: 3; readonly migrated: boolean; readonly state: V3State; readonly quarantine: readonly QuarantinedRow[]; readonly report: MigrationReport | null }
  | { readonly ok: false; readonly code: StateBlockCode; readonly message: string }

export class StateBlockedError extends Error {
  readonly readiness: StateReadiness
  constructor(readiness: StateReadiness) {
    super(readiness.ok ? 'merge state is ready' : readiness.code + ': ' + readiness.message)
    this.name = 'StateBlockedError'
    this.readiness = readiness
  }
}

interface StagingEntry { readonly rowId: string; readonly pairKey: string; readonly ref: string; readonly expiresAt: number; readonly runId?: string; readonly createdAt: number }
interface MigrationMarker {
  readonly migratedFromV2: true
  readonly sourceSha256: string
  readonly targetSha256: string
  readonly staging: readonly StagingEntry[]
  readonly at: string
}

interface MigrationJournal {
  readonly version: 1
  readonly sourceSha256: string
  readonly targetSha256: string
  readonly rows: number
  readonly quarantine: readonly QuarantinedRow[]
  readonly staging: readonly StagingEntry[]
  readonly backupPath: string
  readonly at: string
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n'
const now = (): string => new Date().toISOString()

function blocked(code: StateBlockCode, message: string): StateReadiness { return { ok: false, code, message } }

function parseBody(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch { return null }
}

function readMarker(body: Record<string, unknown>): MigrationMarker | null {
  const value = body.migration
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return null
  const marker = value as Partial<MigrationMarker>
  if (marker.migratedFromV2 !== true || typeof marker.sourceSha256 !== 'string' || typeof marker.targetSha256 !== 'string' || !Array.isArray(marker.staging) || typeof marker.at !== 'string') return null
  return marker as MigrationMarker
}

function rowsSha(rows: readonly V3Row[]): string {
  return hash(json({ schemaVersion: 3, rows }))
}

async function missingIndex(io: EvolutionIoLike, home: string, staging: readonly StagingEntry[]): Promise<string | null> {
  for (const entry of staging) if (!(await io.exists(stagingIndexPath(home, entry.rowId)))) return entry.rowId
  return null
}

function v3State(body: Record<string, unknown>): V3State | null {
  const rows = body.rows
  if (!Array.isArray(rows) || !rows.every(isV3Row)) return null
  return { schemaVersion: 3, rows: rows as readonly V3Row[] }
}

async function readJournal(io: EvolutionIoLike, home: string): Promise<MigrationJournal | null> {
  const raw = await readTextOrNull(io, migrationJournalPath(home))
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as Partial<MigrationJournal>
    if (value.version !== 1 || typeof value.sourceSha256 !== 'string' || typeof value.targetSha256 !== 'string' || !Array.isArray(value.staging)) return null
    return value as MigrationJournal
  } catch { return null }
}

async function readReport(io: EvolutionIoLike, home: string): Promise<MigrationReport | null> {
  const raw = await readTextOrNull(io, migrationReportPath(home))
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as MigrationReport
    return value.version === 1 ? value : null
  } catch { return null }
}

async function writeReport(io: EvolutionIoLike, home: string, report: MigrationReport): Promise<void> {
  await transactIo(io, migrationReportPath(home), () => json(report))
}

async function completeJournal(io: EvolutionIoLike, home: string, journal: MigrationJournal, current: string): Promise<StateReadiness> {
  if (hash(current) !== journal.targetSha256) return blocked('merge-state-needs-repair', 'migration journal does not match the v3 state')
  for (const entry of journal.staging) await writeStagingIndex(io, home, entry)
  const report: MigrationReport = { version: 1, ready: true, migrated: false, sourceSha256: journal.sourceSha256, targetSha256: journal.targetSha256, rows: journal.rows, quarantined: journal.quarantine.length, at: now(), steps: ['journal:index', 'journal:ready'] }
  await writeReport(io, home, report)
  await io.remove(migrationJournalPath(home)).catch(() => {})
  const body = parseBody(current)
  const state = body === null ? null : v3State(body)
  return state === null ? blocked('merge-state-needs-repair', 'v3 state is invalid') : { ok: true, schema: 3, migrated: false, state, quarantine: journal.quarantine, report }
}

/** Read-only readiness probe. Never migrates, never writes. */
export async function readStateReadiness(io: EvolutionIoLike, home: string): Promise<StateReadiness> {
  let raw: string | null
  try { raw = await io.readText(mergeStatePath(home)) } catch { return blocked('merge-state-needs-repair', 'state file is unreadable') }
  if (raw === null) return { ok: true, schema: 3, migrated: false, state: { schemaVersion: 3, rows: [] }, quarantine: [], report: await readReport(io, home) }
  const body = parseBody(raw)
  if (body === null) return blocked('merge-state-needs-repair', 'state file is not a JSON object')
  const version = body.schemaVersion
  if (typeof version === 'number' && version > 3) return blocked('merge-state-forward-only', 'state schema ' + String(version) + ' is newer than this build')
  if (version === 3) {
    const state = v3State(body)
    if (state === null) return blocked('merge-state-needs-repair', 'v3 state has an invalid row')
    const journal = await readJournal(io, home)
    const report = await readReport(io, home)
    const marker = readMarker(body)
    if (body.migration !== undefined && marker === null) return blocked('merge-state-needs-repair', 'migration marker is invalid')
    if (journal !== null) return blocked('merge-state-migration-blocked', 'migration journal is pending')
    if (report !== null && report.ready !== true) return blocked('merge-state-migration-blocked', 'migration report is not ready')
    if (marker !== null && rowsSha(state.rows) === marker.targetSha256) {
      if (report === null) return blocked('merge-state-migration-blocked', 'migration report is missing')
      const missing = await missingIndex(io, home, marker.staging)
      if (missing !== null) return blocked('merge-state-migration-blocked', 'staging index is missing: ' + missing)
    }
    return { ok: true, schema: 3, migrated: false, state, quarantine: [], report }
  }
  return blocked('merge-state-migration-required', 'v2 state requires v3 migration')
}

/** Compatibility name for the v3 gate; 1b-2b switches the lifecycle to v4. */
export const ensureV3Ready = ensureMergeStateReady

/** One readiness/migration gate; used by startup and every write entry. */
export async function ensureMergeStateReady(io: EvolutionIoLike, home: string): Promise<StateReadiness> {
  let outcome: StateReadiness | undefined
  let migrated = false
  try {
    await transactIo(io, mergeStatePath(home), async (current) => {
      if (current === null) {
        outcome = { ok: true, schema: 3, migrated: false, state: { schemaVersion: 3, rows: [] }, quarantine: [], report: await readReport(io, home) }
        return null
      }
      const body = parseBody(current)
      if (body === null) { outcome = blocked('merge-state-needs-repair', 'state file is not a JSON object'); return current }
      const version = body.schemaVersion
      if (typeof version === 'number' && version > 3) { outcome = blocked('merge-state-forward-only', 'state schema ' + String(version) + ' is newer than this build'); return current }
      if (version === 3) {
        const state = v3State(body)
        if (state === null) { outcome = blocked('merge-state-needs-repair', 'v3 state has an invalid row'); return current }
        const journal = await readJournal(io, home)
        if (journal !== null) { outcome = await completeJournal(io, home, journal, current); return current }
        const report = await readReport(io, home)
        const marker = readMarker(body)
        if (body.migration !== undefined && marker === null) { outcome = blocked('merge-state-needs-repair', 'migration marker is invalid'); return current }
        if (report !== null && report.ready !== true) { outcome = blocked('merge-state-migration-blocked', 'migration report is not ready'); return current }
        if (marker !== null && rowsSha(state.rows) === marker.targetSha256) {
          if (report === null) { outcome = blocked('merge-state-migration-blocked', 'migration report is missing'); return current }
          for (const entry of marker.staging) if (!(await io.exists(stagingIndexPath(home, entry.rowId)))) await writeStagingIndex(io, home, entry)
        }
        outcome = { ok: true, schema: 3, migrated: false, state, quarantine: [], report }
        return current
      }
      const mapped = migrateV2ToV3(body)
      if (!mapped.ok) { outcome = blocked('merge-state-migration-blocked', mapped.message); return current }
      const sourceSha256 = hash(current)
      const backup = v2BackupPath(home)
      const existingBackup = await readTextOrNull(io, backup)
      if (existingBackup !== null && existingBackup !== current) { outcome = blocked('merge-state-migration-blocked', 'v2 backup exists with different bytes'); return current }
      if (existingBackup === null) await transactIo(io, backup, () => current)
      try { await chmod(backup, 0o444) } catch { outcome = blocked('merge-state-migration-blocked', 'v2 backup is not read-only'); return current }
      const staging: StagingEntry[] = []
      for (const row of body.rows as Array<Record<string, unknown>>) {
        if (typeof row.id !== 'string' || typeof row.pairKey !== 'string' || typeof row.stagingRef !== 'string') continue
        if (row.state !== 'pending' && row.state !== 'approved') continue
        staging.push({
          rowId: row.id, pairKey: row.pairKey, ref: row.stagingRef,
          expiresAt: typeof row.stagingExpiresAt === 'number' ? row.stagingExpiresAt : Date.now() + 7 * 86_400_000,
          ...(typeof row.runId === 'string' ? { runId: row.runId } : {}),
          createdAt: typeof row.updatedAt === 'string' && !Number.isNaN(Date.parse(row.updatedAt)) ? Date.parse(row.updatedAt) : Date.now(),
        })
      }
      const marker: MigrationMarker = { migratedFromV2: true, sourceSha256, targetSha256: rowsSha(mapped.state.rows), staging, at: now() }
      const targetText = json({ ...mapped.state, migration: marker })
      const targetSha256 = hash(targetText)
      const journal: MigrationJournal = { version: 1, sourceSha256, targetSha256, rows: mapped.state.rows.length, quarantine: mapped.quarantine, staging, backupPath: backup, at: now() }
      await transactIo(io, migrationJournalPath(home), () => json(journal))
      for (const entry of staging) await writeStagingIndex(io, home, entry)
      if (mapped.quarantine.length > 0) await transactIo(io, quarantinePath(home), () => json(mapped.quarantine))
      const prepared: MigrationReport = { version: 1, ready: false, migrated: true, sourceSha256, targetSha256, rows: mapped.state.rows.length, quarantined: mapped.quarantine.length, backupReadOnly: true, at: now(), steps: ['backup', 'journal', 'staging-index', 'quarantine', 'v3-write'] }
      await writeReport(io, home, prepared)
      migrated = true
      outcome = { ok: true, schema: 3, migrated: true, state: mapped.state, quarantine: mapped.quarantine, report: prepared }
      return targetText
    })
  } catch (error) {
    return blocked('merge-state-migration-blocked', 'state migration failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  if (outcome === undefined) return blocked('merge-state-migration-blocked', 'state migration did not produce a result')
  if (migrated && outcome.ok) {
    try {
      const report = { ...outcome.report, ready: true, at: now(), steps: ['backup', 'journal', 'staging-index', 'quarantine', 'v3-write', 'ready'] } as MigrationReport
      await writeReport(io, home, report)
      await io.remove(migrationJournalPath(home)).catch(() => {})
      outcome = { ...outcome, report }
    } catch {
      // The v3 state is committed; leave the journal/report for the next ensure.
    }
  }
  return outcome
}
