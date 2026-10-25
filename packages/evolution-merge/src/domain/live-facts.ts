/**
 * Read-time convergence facts for pending rows (FR-LIFE-14).
 *
 * Snapshot and reconcile must agree on WHY a pending row is no longer actionable, but no
 * reader may write. This module is the single derivation both sides call: given the live
 * library view it answers absent/source-gone/target-taken/source-changed, and the
 * persisted row state is only consulted for an already-recorded expiry.
 */
import type { RevisionRef } from '../contracts.ts'
import { revisionMismatch, sourceRevisionRefOf, supportDigestOf, targetRevisionRefOf } from '../revision.ts'
import type { SkillCard } from '../skill-card.ts'
import type { V4Row } from './row-v4.ts'

/** Why a pending row reads as expired. `source-gone` rows are removed by reconcile. */
export type PendingExpiryKind = 'target-taken' | 'source-changed' | 'source-gone'

/** The live library facts the derivation needs; no io, no writes. */
export interface LiveRowFacts {
  readonly managed: (name: string) => boolean
  readonly targetRevisionRef: (name: string) => RevisionRef
  readonly sourceRevisionRef: (a: string, b: string) => RevisionRef
  readonly supportDigest: (names: readonly string[]) => string
}

export function liveRowFactsOf(cards: readonly SkillCard[]): LiveRowFacts {
  const byName = new Map(cards.map(card => [card.name, card]))
  return {
    managed: name => byName.get(name)?.managed === true,
    targetRevisionRef: name => targetRevisionRefOf(cards, name),
    sourceRevisionRef: (a, b) => sourceRevisionRefOf(cards, a, b),
    supportDigest: names => supportDigestOf(cards, names),
  }
}

/**
 * The read-only expiry verdict for one row.
 * @param row - the persisted row (only pending rows converge here).
 * @param live - current library facts; absent means "cannot derive".
 * @returns the expiry kind, or null when the row is still actionable.
 */
export function pendingExpiry(row: V4Row, live: LiveRowFacts | undefined): PendingExpiryKind | null {
  if (live === undefined) return null
  if (row.state === 'verify') {
    return !live.managed(row.a) || !live.managed(row.b) ? 'source-gone' : null
  }
  if (row.state !== 'pending' && row.state !== 'fuse' && row.state !== 'approved') return null
  if (!live.managed(row.a) || !live.managed(row.b)) return 'source-gone'
  const decision = row.decision
  if (row.state !== 'pending') {
    if (revisionMismatch(decision.sourceRevisionRef, live.sourceRevisionRef(row.a, row.b)) !== null) return 'source-changed'
    if (decision.supportDigest !== undefined && decision.supportDigest !== live.supportDigest([decision.target, row.a, row.b])) return 'source-changed'
    return null
  }
  if (decision.mode !== 'create-umbrella') {
    if (!live.managed(decision.target)) return 'target-taken'
  }
  // A create-umbrella decision recorded "this name was free"; the name being taken now is
  // the same conflict the approve precheck reports.
  if (revisionMismatch(decision.targetRevisionRef, live.targetRevisionRef(decision.target)) !== null) return 'target-taken'
  const expectedSource = decision.sourceRevisionRef
  if (revisionMismatch(expectedSource, live.sourceRevisionRef(row.a, row.b)) !== null) return 'source-changed'
  if (decision.supportDigest !== undefined && decision.supportDigest !== live.supportDigest([decision.target, row.a, row.b])) return 'source-changed'
  return null
}

/** The persisted expiry kind, when the row already carries one. */
export function persistedExpiry(row: V4Row): PendingExpiryKind | null {
  return row.state === 'pending' && row.expired !== undefined ? row.expired : null
}
