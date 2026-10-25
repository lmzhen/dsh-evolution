/** Pure skipped-TTL planning. Reconcile owns the durable write. */
import type { V4Row } from './row-v4.ts'

/** Row ids whose skipped TTL has elapsed at `now`; the caller applies one transition each. */
export function planSkippedExpiry(rows: readonly V4Row[], ttlDays: number, now: number): readonly string[] {
  if (ttlDays <= 0) return []
  const ids: string[] = []
  for (const row of rows) {
    if (row.state !== 'skipped' || row.expiredAt !== undefined) continue
    const created = Date.parse(row.createdAt)
    if (!Number.isFinite(created) || now - created < ttlDays * 86_400_000) continue
    ids.push(row.id)
  }
  return ids
}
