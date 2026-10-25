/** Batch 1b-2a schema4 state codec, readiness, and atomic row transaction. */
import { join } from 'node:path'
import { transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { isV4Row, applyV4Write, v3ToV4, type CommitUnitRef, type V4Event, type V4Row, type V4Write, type V4WriteResult } from './row-v4.ts'
import type { V3Row } from './row-v3.ts'
import { readPre1bManifest } from './pre-1b-backup.ts'

export interface MergeStateV4 {
  readonly schemaVersion: 4
  readonly rows: readonly V4Row[]
  readonly migration?: unknown
  readonly pre1b?: { readonly backupRef: string; readonly at: string }
}
export type V4BlockCode = 'merge-state-normalize-required' | 'merge-state-migration-required' | 'merge-state-v4-required' | 'merge-state-forward-only' | 'merge-state-needs-repair' | 'merge-state-backup-missing'
export type V4Readiness =
  | { readonly ok: true; readonly schema: 4; readonly state: MergeStateV4 }
  | { readonly ok: false; readonly code: V4BlockCode; readonly message: string }

export class V4BlockedError extends Error {
  readonly readiness: V4Readiness
  constructor(readiness: V4Readiness) {
    super(readiness.ok ? 'merge state v4 is ready' : readiness.code + ': ' + readiness.message)
    this.name = 'V4BlockedError'
    this.readiness = readiness
  }
}

export function schema4StatePath(home: string): string { return join(home, 'merge', 'merge-state.json') }
function blocked(code: V4BlockCode, message: string): V4Readiness { return { ok: false, code, message } }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' }
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }

function parse(raw: string): { readonly body: Record<string, unknown>; readonly rows: readonly V4Row[] } | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!object(value) || value.schemaVersion !== 4 || !Array.isArray(value.rows) || !value.rows.every(isV4Row)) return null
    return { body: value, rows: value.rows as readonly V4Row[] }
  } catch { return null }
}

async function inspect(io: EvolutionIoLike, home: string, body: Record<string, unknown>, rows: readonly V4Row[]): Promise<V4Readiness> {
  const pre1b = body.pre1b
  if (!object(pre1b) || !string(pre1b.backupRef)) return blocked('merge-state-needs-repair', 'schema4 state is missing pre1b backup reference')
  const manifest = await readPre1bManifest(io, home, pre1b.backupRef).catch(() => null)
  if (manifest === null) return blocked('merge-state-backup-missing', 'pre-1b backup manifest is unreadable: ' + pre1b.backupRef)
  return { ok: true, schema: 4, state: { schemaVersion: 4, rows, ...(body.migration === undefined ? {} : { migration: body.migration }), pre1b: { backupRef: pre1b.backupRef, at: typeof pre1b.at === 'string' ? pre1b.at : '' } } }
}

/** Pure read-only v4 readiness. Does not normalize, repair, or write. */
export async function readV4Readiness(io: EvolutionIoLike, home: string): Promise<V4Readiness> {
  let raw: string | null
  try { raw = await io.readText(schema4StatePath(home)) } catch { return blocked('merge-state-needs-repair', 'merge state is unreadable') }
  if (raw === null) return blocked('merge-state-v4-required', 'schema4 state is missing')
  let value: unknown
  try { value = JSON.parse(raw) } catch { return blocked('merge-state-needs-repair', 'merge state is not JSON') }
  if (!object(value)) return blocked('merge-state-needs-repair', 'merge state is not an object')
  if (typeof value.schemaVersion === 'number' && value.schemaVersion > 4) return blocked('merge-state-forward-only', 'state schema ' + String(value.schemaVersion) + ' is newer than this build')
  if (value.schemaVersion === 3) return blocked('merge-state-normalize-required', 'schema3 state requires v4 normalize')
  if (value.schemaVersion === 2 || value.schemaVersion === 1) return blocked('merge-state-migration-required', 'legacy state requires schema migration')
  if (value.schemaVersion !== 4) return blocked('merge-state-needs-repair', 'merge state has no supported schemaVersion')
  const parsed = parse(raw)
  if (parsed === null) return blocked('merge-state-needs-repair', 'schema4 state has an invalid row')
  return await inspect(io, home, parsed.body, parsed.rows)
}

export interface V4RowTx {
  rows(): readonly V4Row[]
  createVerify(row: Extract<V4Row, { state: 'verify' }>): V4WriteResult
  createSkipped(row: Extract<V4Row, { state: 'skipped' }>): V4WriteResult
  transition(id: string, event: V4Event, expectedVersion: number): V4WriteResult
  remove(id: string, terminal: 'committed' | 'superseded' | 'restored', unit: CommitUnitRef | undefined, expectedVersion: number): V4WriteResult
}

/** Atomic readiness + V4 row write under one state-file lock. No production caller in 1b-2a. */
export async function transactMergeState<T>(io: EvolutionIoLike, home: string, fn: (tx: V4RowTx) => T | Promise<T>): Promise<T> {
  let result: T | undefined
  await transactIo(io, schema4StatePath(home), async current => {
    if (current === null) throw new V4BlockedError(blocked('merge-state-v4-required', 'schema4 state is missing'))
    let value: unknown
    try { value = JSON.parse(current) } catch { throw new V4BlockedError(blocked('merge-state-needs-repair', 'merge state is not JSON')) }
    if (!object(value)) throw new V4BlockedError(blocked('merge-state-needs-repair', 'merge state is not an object'))
    if (typeof value.schemaVersion === 'number' && value.schemaVersion > 4) throw new V4BlockedError(blocked('merge-state-forward-only', 'state schema ' + String(value.schemaVersion) + ' is newer than this build'))
    if (value.schemaVersion === 3) throw new V4BlockedError(blocked('merge-state-normalize-required', 'schema3 state requires v4 normalize'))
    if (value.schemaVersion !== 4) throw new V4BlockedError(blocked('merge-state-needs-repair', 'merge state is not schema4'))
    const parsed = parse(current)
    if (parsed === null) throw new V4BlockedError(blocked('merge-state-needs-repair', 'schema4 state has an invalid row'))
    const ready = await inspect(io, home, parsed.body, parsed.rows)
    if (!ready.ok) throw new V4BlockedError(ready)
    let rows = parsed.rows
    const apply = (write: V4Write): V4WriteResult => {
      const next = applyV4Write(rows, write, new Date().toISOString())
      if (next.ok) rows = next.rows
      return next
    }
    const tx: V4RowTx = {
      rows: () => rows,
      createVerify: row => apply({ kind: 'createVerify', row }),
      createSkipped: row => apply({ kind: 'createSkipped', row }),
      transition: (id, event, expectedVersion) => apply({ kind: 'transition', id, event, expectedVersion }),
      remove: (id, terminal, unit, expectedVersion) => apply({ kind: 'remove', id, terminal, ...(unit === undefined ? {} : { unit }), expectedVersion }),
    }
    result = await fn(tx)
    return JSON.stringify({ ...parsed.body, schemaVersion: 4, rows }, null, 2) + '\n'
  })
  if (result === undefined) throw new V4BlockedError(blocked('merge-state-needs-repair', 'v4 transaction did not produce a result'))
  return result
}

/** Pure v3-to-v4 projection for fixtures; 1b-2b wires it to the production normalize. */
export function normalizeV3State(
  state: { readonly schemaVersion: 3; readonly rows: readonly V3Row[]; readonly migration?: unknown },
  pre1b: { readonly backupRef: string; readonly at: string },
): MergeStateV4 {
  return { schemaVersion: 4, rows: state.rows.map(v3ToV4), ...(state.migration === undefined ? {} : { migration: state.migration }), pre1b }
}

export function parseV4State(raw: string): MergeStateV4 | null {
  const parsed = parse(raw)
  if (parsed === null) return null
  return { schemaVersion: 4, rows: parsed.rows, ...(parsed.body.migration === undefined ? {} : { migration: parsed.body.migration }), ...(object(parsed.body.pre1b) && string(parsed.body.pre1b.backupRef) ? { pre1b: { backupRef: parsed.body.pre1b.backupRef, at: typeof parsed.body.pre1b.at === 'string' ? parsed.body.pre1b.at : '' } } : {}) }
}
