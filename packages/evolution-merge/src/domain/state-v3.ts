/** G3 schema-3 state IO: backup v2, map, atomic v3 write. */
import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { migrateV2ToV3, type QuarantinedRow, type V3State } from './migrate-v3.ts'
import { isV3Row } from './row-v3.ts'
import { writeStagingIndex } from './staging-index.ts'

export function v2BackupPath(home: string): string { return join(home, 'merge', 'merge-state.v2.bak.json') }
export type StateMigration =
  | { readonly ok: true; readonly migrated: boolean; readonly state: V3State; readonly quarantine: readonly QuarantinedRow[] }
  | { readonly ok: false; readonly code: 'state-migration-blocked'; readonly message: string }

function blocked(message: string): StateMigration { return { ok: false, code: 'state-migration-blocked', message } }
async function readOnly(path: string): Promise<void> { try { await chmod(path, 0o444) } catch { /* io seam without chmod; v2 bytes still preserved */ } }

export async function loadOrMigrateStateV3(io: EvolutionIoLike, home: string): Promise<StateMigration> {
  const path = join(home, 'merge', 'merge-state.json')
  const raw = await io.readText(path)
  if (raw === null) return { ok: true, migrated: false, state: { schemaVersion: 3, rows: [] }, quarantine: [] }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return blocked('v2 state is not JSON') }
  if (parsed !== null && typeof parsed === 'object' && (parsed as { schemaVersion?: unknown }).schemaVersion === 3) {
    const rows = (parsed as { rows?: unknown }).rows
    if (!Array.isArray(rows) || !rows.every(isV3Row)) return blocked('v3 state has an invalid row')
    return { ok: true, migrated: false, state: { schemaVersion: 3, rows }, quarantine: [] }
  }
  const mapped = migrateV2ToV3(parsed)
  if (!mapped.ok) return blocked(mapped.message)
  const backup = v2BackupPath(home)
  const existing = await io.readText(backup)
  if (existing !== null && existing !== raw) return blocked('v2 backup exists with different bytes')
  if (existing === null) {
    try { if (io.transact !== undefined) await io.transact(backup, () => raw); else await io.writeText(backup, raw) } catch { return blocked('v2 backup write failed') }
  }
  await readOnly(backup)
  const rawRows = (parsed as { rows?: unknown }).rows
  if (Array.isArray(rawRows)) {
    for (const row of rawRows as Array<{ id?: unknown; state?: unknown; pairKey?: unknown; stagingRef?: unknown; stagingExpiresAt?: unknown; runId?: unknown; updatedAt?: unknown }>) {
      if (typeof row.id !== 'string' || typeof row.pairKey !== 'string' || typeof row.stagingRef !== 'string') continue
      if (row.state !== 'pending' && row.state !== 'approved') continue
      await writeStagingIndex(io, home, { rowId: row.id, pairKey: row.pairKey, ref: row.stagingRef, expiresAt: typeof row.stagingExpiresAt === 'number' ? row.stagingExpiresAt : Date.now() + 7 * 86_400_000, ...(typeof row.runId === 'string' ? { runId: row.runId } : {}), createdAt: typeof row.updatedAt === 'string' && !Number.isNaN(Date.parse(row.updatedAt)) ? Date.parse(row.updatedAt) : Date.now() })
    }
  }
  if (mapped.quarantine.length > 0) {
    try { await io.writeText(join(home, 'merge', 'merge-state.quarantine.json'), JSON.stringify(mapped.quarantine, null, 2) + '\n') } catch { return blocked('quarantine write failed; v3 not written') }
  }
  const text = JSON.stringify(mapped.state, null, 2) + '\n'
  try {
    if (io.transact !== undefined) await io.transact(path, () => text)
    else await io.writeText(path, text)
  } catch { return blocked('v3 state write failed; v2 backup + quarantine retained') }
  return { ok: true, migrated: true, state: mapped.state, quarantine: mapped.quarantine }
}
