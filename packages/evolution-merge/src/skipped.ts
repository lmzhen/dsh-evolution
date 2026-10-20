/**
 * Skipped filtering: a pair the operator marked as not-worth-merging stays out of automatic
 * screening until mergeSkippedTtlDays expires. Explicit /merge pair ignores this set.
 */
import { pairKey, type MergeRow } from './contracts.ts'

export function skippedPairKeys(rows: readonly MergeRow[], ttlDays: number, now: number): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const row of rows) {
    if (row.state !== 'skipped') continue
    if (ttlDays <= 0) { keys.add(row.pairKey); continue }
    const createdAt = Date.parse(row.createdAt)
    if (!Number.isFinite(createdAt) || now - createdAt < ttlDays * 86_400_000) keys.add(row.pairKey)
  }
  return keys
}

export function isSkippedPair(keys: ReadonlySet<string>, a: string, b: string): boolean {
  return keys.has(pairKey(a, b))
}
