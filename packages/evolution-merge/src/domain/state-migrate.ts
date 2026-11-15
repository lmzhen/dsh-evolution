/**
 * The one v2/v3→v4 migration seam. The startup gate and the operator CLI both call this,
 * so a backup/journal fix in one path cannot drift from the other.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { ensureMergeStateReady } from './state-bootstrap.ts'
import { normalizePairLedger } from './pair-ledger.ts'
import { readV4Readiness } from './schema4.ts'

/** Outcome of the one-time migration. */
export type MigrateToV4Result =
  | { readonly ok: true; readonly migrated: boolean; readonly backupRef?: string }
  | { readonly ok: false; readonly code: string; readonly message: string }

/**
 * Migrate v1/v2/v3 merge state to v4. v4 is a no-op; forward-only/needs-repair are reported
 * before attempting anything, so a newer state is never overwritten.
 * @param io - the evolution IO seam.
 * @param home - the evolution home.
 * @param fence - optional home write fence used by the host.
 * @returns the migration outcome.
 */
export async function migrateMergeStateToV4(
  io: EvolutionIoLike,
  home: string,
  fence?: { run<T>(body: () => Promise<T>): Promise<T> },
): Promise<MigrateToV4Result> {
  const v4 = await readV4Readiness(io, home)
  if (v4.ok) return { ok: true, migrated: false }
  if (v4.code === 'merge-state-forward-only' || v4.code === 'merge-state-needs-repair') {
    return { ok: false, code: v4.code, message: v4.message }
  }
  const v3 = await ensureMergeStateReady(io, home, fence)
  if (!v3.ok) return { ok: false, code: v3.code, message: v3.message }
  const normalized = await normalizePairLedger(io, home)
  if (!normalized.ok) return { ok: false, code: 'merge-state-needs-repair', message: normalized.message ?? 'v3->v4 normalize failed' }
  return normalized.backupRef === undefined
    ? { ok: true, migrated: normalized.migrated }
    : { ok: true, migrated: normalized.migrated, backupRef: normalized.backupRef }
}
