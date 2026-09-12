import { expect, it } from 'vitest'
import {
  PENDING_RESOLVED_CAP,
  REVIEW_STATE_SESSION_CAP,
  selectPendingOverflow,
  selectSessionOverflow,
  type PendingRecord,
} from '@deepseek-ai/dsh-evolution-state-storage'

/**
 * V27 G2.2: the audit cap and the review-session cap are ONE pure rule each,
 * consumed by both state providers. These cases pin the boundaries the audit
 * found untested (`<CAP` / `=CAP` / `>CAP`), the eligibility exemptions and the
 * "unknown timestamp sorts last" ordering that json documented but domain
 * re-derived.
 */
const record = (id: string, over: Partial<PendingRecord> = {}): PendingRecord => ({
  id,
  kind: 'skill',
  summary: `staged ${id}`,
  args: {},
  createdAt: '2026-09-01T00:00:00.000Z',
  status: 'approved',
  resolvedAt: '2026-09-01T01:00:00.000Z',
  ...over,
})

it('V27 G2.2: selectPendingOverflow evicts only above the cap, oldest first', () => {
  const resolved = (count: number): PendingRecord[] => Array.from({ length: count }, (_, index) =>
    record(`r-${index}`, { resolvedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString() }))
  // Below and AT the cap nothing is evicted (the boundary is inclusive).
  expect(selectPendingOverflow(resolved(PENDING_RESOLVED_CAP - 1))).toEqual([])
  expect(selectPendingOverflow(resolved(PENDING_RESOLVED_CAP))).toEqual([])
  // One over: exactly the oldest by resolvedAt.
  expect(selectPendingOverflow(resolved(PENDING_RESOLVED_CAP + 1)).map(item => item.id)).toEqual(['r-0'])
  // Three over: the three oldest, in order.
  expect(selectPendingOverflow(resolved(PENDING_RESOLVED_CAP + 3)).map(item => item.id)).toEqual(['r-0', 'r-1', 'r-2'])
  // A caller-supplied cap is honoured (the rule is not hard-wired to the seam value).
  expect(selectPendingOverflow(resolved(5), 2).map(item => item.id)).toEqual(['r-0', 'r-1', 'r-2'])
})

it('V27 G2.2: live rows and capability approvals are never eviction candidates', () => {
  const candidates = [
    // Only ONE eligible record: the cap cannot be exceeded by anything else.
    record('live-pending', { status: 'pending', resolvedAt: undefined }),
    record('live-executing', { status: 'executing', resolvedAt: undefined }),
    ...Array.from({ length: PENDING_RESOLVED_CAP }, (_, index) => record(`approved-${index}`)),
    record('capability-approval', { kind: 'capability' }),
  ]
  // The capability approval is exempt (v23 AP-1: `approvedPackage` reads the LIVE
  // approved list, so evicting one would make it permanently unactivatable) and
  // pending/executing rows are live work — the eligible count is exactly the cap.
  expect(selectPendingOverflow(candidates)).toEqual([])
})

it('V27 G2.2: a missing or unparseable resolvedAt sorts LAST, never the victim', () => {
  const rows = [
    ...Array.from({ length: PENDING_RESOLVED_CAP }, (_, index) =>
      record(`dated-${index}`, { resolvedAt: new Date(Date.UTC(2026, 8, 2, 0, 0, index)).toISOString() })),
    record('unknown-time', { resolvedAt: undefined }),
    record('garbage-time', { resolvedAt: 'not a date' }),
    record('older-than-all', { resolvedAt: '2026-01-01T00:00:00.000Z' }),
  ]
  const evicted = selectPendingOverflow(rows).map(item => item.id)
  // Three over the cap → the genuinely oldest record plus two dated ones leave;
  // both unknown-time rows survive (an unknown time must not be the victim).
  expect(evicted).toEqual(['older-than-all', 'dated-0', 'dated-1'])
  expect(evicted).not.toContain('unknown-time')
  expect(evicted).not.toContain('garbage-time')
})

it('V27 G2.2: selectSessionOverflow drops one row per over-cap save, unknown stamps first', () => {
  const rows = (count: number, stampOf: (index: number) => number) =>
    Array.from({ length: count }, (_, index) => ({ key: `s-${index}`, stamp: stampOf(index) }))
  const options = { keyOf: (row: { key: string }) => row.key, stampOf: (row: { key: string; stamp: number }) => row.stamp }
  // `rows` are the OTHER sessions — the saving session is added by the caller,
  // so `rows.length === CAP` would make the table CAP+1 and one row must go.
  expect(selectSessionOverflow(rows(REVIEW_STATE_SESSION_CAP - 1, index => index), options)).toEqual([])
  expect(selectSessionOverflow(rows(REVIEW_STATE_SESSION_CAP, index => index), options)).toEqual(['s-0'])
  // Two over → two victims, oldest first.
  expect(selectSessionOverflow(rows(REVIEW_STATE_SESSION_CAP + 1, index => index), options)).toEqual(['s-0', 's-1'])
  // A stamp of 0 means "pre-0.3.67 row / no stamp" and is the oldest by
  // construction, so it leaves before any stamped row: with cap 2 and three
  // other sessions (plus the saving one = 4 rows) the two oldest go.
  const mixed = [{ key: 'unstamped', stamp: 0 }, { key: 'fresh', stamp: 9_999 }, { key: 'older', stamp: 5 }]
  expect(selectSessionOverflow(mixed, options, 2)).toEqual(['unstamped', 'older'])
})

it('v28 G2.4 (STATE-03): when the overflow exceeds every known timestamp, unknown-time rows are evicted last (forced phase)', () => {
  // Corruption-level shape where the overflow necessarily reaches the unknown
  // tail: 3 known-timestamp rows + 201 unknown = 204 resolved, cap 200 →
  // overflow 4. The cap must be enforced, so after the 3 known rows the FIRST
  // unknown (insertion order, stable sort on equal MAX keys) becomes a victim
  // — the old doc promise ("never the victim") was unenforceable at this phase.
  const rows = [
    record('dated-0', { resolvedAt: new Date(Date.UTC(2026, 8, 2, 0, 0, 0)).toISOString() }),
    record('dated-1', { resolvedAt: new Date(Date.UTC(2026, 8, 2, 0, 0, 1)).toISOString() }),
    record('dated-2', { resolvedAt: new Date(Date.UTC(2026, 8, 2, 0, 0, 2)).toISOString() }),
    ...Array.from({ length: 201 }, (_, index) => record(`unknown-${index}`, { resolvedAt: undefined })),
  ]
  const evicted = selectPendingOverflow(rows).map(item => item.id)
  expect(evicted).toEqual(['dated-0', 'dated-1', 'dated-2', 'unknown-0'])
  // Unknown rows sort strictly after every known timestamp (never before).
  expect(evicted).not.toContain('dated-3')
  expect(evicted[3]).toBe('unknown-0')
})
