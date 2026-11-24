/**
 * The durable review/pending/curator document, independent of its medium.
 *
 * The v1 file provider and the v2 MVCC provider both consume this module; a
 * claim/resolve/overflow rule written here cannot drift between media. Parsing
 * and every mutation are pure over an in-memory document; IO belongs to the
 * provider.
 *
 * @module @deepseek-ai/dsh-evolution-core/state/document
 */

import type {
  CuratorStateRecord,
  PendingRecord,
  PendingResolution,
  PendingStatus,
  ReviewStateRecord,
} from '../contract.ts'
import { assertCloneable, cloneRecord, recordIssue } from './record-contract.ts'
import {
  CURATOR_STATE_TABLE,
  PENDING_RESOLVED_CAP,
  PENDING_TABLE,
  REVIEW_STATE_SESSION_CAP,
  REVIEW_STATE_TABLE,
} from './constants.ts'
import {
  canClaimPending,
  canResolvePending,
  releasedStatus,
  selectPendingOverflow,
  selectSessionOverflow,
} from './storage.ts'
import type { EvolutionIoLike } from '../io.ts'

/** The on-disk version of the review/pending/curator document. */
export const STATE_DOCUMENT_VERSION = 1

/** A review-state row with its provider-owned eviction stamp. */
export type StoredReviewState = ReviewStateRecord & { updatedAt?: number }

/** The complete durable state document. */
export interface StateDocument {
  version: typeof STATE_DOCUMENT_VERSION
  review: Record<string, StoredReviewState>
  curator: CuratorStateRecord | null
  pending: Record<string, PendingRecord>
}

/** A consumer-facing snapshot without provider-only review stamps. */
export interface StateDocumentSnapshot {
  readonly review: Record<string, StoredReviewState>
  readonly curator: CuratorStateRecord | null
  readonly pending: Record<string, PendingRecord>
}

const invalid = (message: string): never => {
  throw new Error('evolution-state-document: ' + message)
}

/** Empty document with a fresh map; never shared between two providers. */
export function emptyStateDocument(): StateDocument {
  return { version: STATE_DOCUMENT_VERSION, review: {}, curator: null, pending: {} }
}

/** Parse one complete document; null text is an explicit empty document, malformed text is fatal. */
export function parseStateDocument(text: string | null): StateDocument {
  if (text === null || text.trim() === '') return emptyStateDocument()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    invalid('store is not valid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) invalid('store must be an object')
  const candidate = raw as Record<string, unknown>
  if (candidate.version !== STATE_DOCUMENT_VERSION) invalid('unsupported store version: ' + String(candidate.version))
  const review = candidate.review
  const pending = candidate.pending
  if (typeof review !== 'object' || review === null || Array.isArray(review)) invalid('review must be an object')
  if (typeof pending !== 'object' || pending === null || Array.isArray(pending)) invalid('pending must be an object')
  const document = emptyStateDocument()
  for (const [sessionId, record] of Object.entries(review as Record<string, unknown>)) {
    const issue = recordIssue(REVIEW_STATE_TABLE, record)
    if (issue !== null) invalid(`review[${sessionId}]: ${issue}`)
    document.review[sessionId] = cloneRecord(record as StoredReviewState)
  }
  for (const [key, record] of Object.entries(pending as Record<string, unknown>)) {
    const issue = recordIssue(PENDING_TABLE, record)
    if (issue !== null) invalid(`pending[${key}]: ${issue}`)
    const pendingRecord = cloneRecord(record as PendingRecord)
    // A hand-written/legacy slot whose key drifted from record.id is reachable
    // by claim/resolve only after re-keying; the canonical id wins.
    if (pendingRecord.id !== key) {
      if (document.pending[pendingRecord.id] === undefined) document.pending[pendingRecord.id] = pendingRecord
      continue
    }
    document.pending[pendingRecord.id] = pendingRecord
  }
  const curator = candidate.curator
  if (curator !== undefined && curator !== null) {
    const issue = recordIssue(CURATOR_STATE_TABLE, curator)
    if (issue !== null) invalid('curator: ' + issue)
    document.curator = cloneRecord(curator as CuratorStateRecord)
  }
  return document
}

/** Canonical serialization used by both providers. */
export function serializeStateDocument(document: StateDocument): string {
  return JSON.stringify(document, null, 2) + '\n'
}

/** Read and validate a document from an IO path; missing text is an empty document. */
export async function readStateDocument(io: EvolutionIoLike, path: string): Promise<StateDocument> {
  return parseStateDocument(await io.readText(path))
}

/** Consumer-facing snapshot from a document. */
export function snapshotStateDocument(document: StateDocument): StateDocumentSnapshot {
  return {
    review: document.review,
    curator: document.curator,
    pending: document.pending,
  }
}

/** Validate and clone one review row; the provider-owned stamp is added by the caller. */
export function assertReviewRecord(record: ReviewStateRecord): ReviewStateRecord {
  const issue = recordIssue(REVIEW_STATE_TABLE, record) ?? assertCloneable(record)
  if (issue !== null) invalid('refusing an invalid review-state record: ' + issue)
  return cloneRecord(record)
}

/** Validate and clone one pending row. */
export function assertPendingRecord(record: PendingRecord): PendingRecord {
  const issue = recordIssue(PENDING_TABLE, record) ?? assertCloneable(record)
  if (issue !== null) invalid('refusing an invalid pending record: ' + issue)
  return cloneRecord(record)
}

/** Validate and clone the curator row. */
export function assertCuratorRecord(record: CuratorStateRecord): CuratorStateRecord {
  const issue = recordIssue(CURATOR_STATE_TABLE, record) ?? assertCloneable(record)
  if (issue !== null) invalid('refusing an invalid curator-state record: ' + issue)
  return cloneRecord(record)
}

/** Apply one review save (clone + stamp + session cap). */
export function saveReviewInDocument(document: StateDocument, sessionId: string, record: ReviewStateRecord, now: number = Date.now()): void {
  document.review[sessionId] = { ...assertReviewRecord(record), updatedAt: now }
  const entries = Object.entries(document.review)
    .filter(([key]) => key !== sessionId)
    .map(([key, row]) => ({ key, updatedAt: row.updatedAt ?? 0 }))
  const victims = selectSessionOverflow(entries, {
    keyOf: entry => entry.key,
    stampOf: entry => entry.updatedAt,
  }, REVIEW_STATE_SESSION_CAP)
  for (const victim of victims) delete document.review[victim]
}

/** Apply one curator save (null is not a delete; the seam has no delete semantic). */
export function saveCuratorInDocument(document: StateDocument, record: CuratorStateRecord): void {
  document.curator = assertCuratorRecord(record)
}

/** Apply the curator transaction; returning null keeps the current record and must not leak a mutation. */
export function transactCuratorInDocument(
  document: StateDocument,
  task: (current: CuratorStateRecord | null) => CuratorStateRecord | null,
): void {
  const current = document.curator === null ? null : cloneRecord(document.curator)
  const next = task(current)
  if (next === null) return
  document.curator = assertCuratorRecord(next)
}

/** Apply one pending save. */
export function savePendingInDocument(document: StateDocument, record: PendingRecord): PendingRecord {
  const valid = assertPendingRecord(record)
  document.pending[valid.id] = valid
  return valid
}

/** Claim one pending row; returns the new record or null when the transition is not allowed. */
export function claimPendingInDocument(document: StateDocument, id: string, claimId: string, now: string = new Date().toISOString()): PendingRecord | null {
  const current = document.pending[id]
  if (current === undefined || !canClaimPending(current.status)) return null
  const next: PendingRecord = {
    ...current,
    status: 'executing',
    claimedBy: claimId,
    claimedAt: now,
  }
  document.pending[id] = next
  return cloneRecord(next)
}

/** Release an executing claim back to pending; foreign claims are ignored. */
export function releasePendingClaimInDocument(document: StateDocument, id: string, claimId: string): void {
  const current = document.pending[id]
  if (current === undefined || current.claimedBy !== claimId) return
  if (current.status !== 'pending' && current.status !== 'executing') return
  const next: PendingRecord = { ...current, status: releasedStatus(current.status) }
  delete next.claimedBy
  delete next.claimedAt
  document.pending[id] = next
}

/** Resolve one pending row and apply the resolved-tail cap. */
export function resolvePendingInDocument(
  document: StateDocument,
  id: string,
  status: Exclude<PendingStatus, 'pending'>,
  expectedClaimId?: string,
  now: string = new Date().toISOString(),
): PendingResolution {
  const current = document.pending[id]
  if (current === undefined) return { record: null, applied: false }
  if (!canResolvePending(current.status)) return { record: cloneRecord(current), applied: false }
  if (expectedClaimId !== undefined && current.claimedBy !== expectedClaimId) {
    return { record: cloneRecord(current), applied: false }
  }
  const resolved: PendingRecord = { ...current, status, resolvedAt: now }
  document.pending[id] = resolved
  for (const victim of selectPendingOverflow(Object.values(document.pending), PENDING_RESOLVED_CAP)) {
    if (document.pending[victim.id]?.resolvedAt === victim.resolvedAt) delete document.pending[victim.id]
  }
  return { record: cloneRecord(resolved), applied: true }
}

/** List pending rows by status without exposing mutable document storage. */
export function listPendingInDocument(document: StateDocument, status: PendingStatus = 'pending'): PendingRecord[] {
  const seen = new Set<string>()
  const out: PendingRecord[] = []
  for (const record of Object.values(document.pending)) {
    if (record.status !== status) continue
    if (seen.has(record.id)) continue
    seen.add(record.id)
    out.push(cloneRecord(record))
  }
  return out
}
