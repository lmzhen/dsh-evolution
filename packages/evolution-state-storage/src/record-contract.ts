/**
 * Record contract of the three seam tables (P2-12/14/15/16/18, v19).
 *
 * The contract belongs to the SEAM, not to each provider: before this module
 * the json provider gated writes with plain field predicates while the domain
 * provider relied on its zod schemas, so the same consumer code behaved
 * differently per medium — `transactCuratorState` skipped validation entirely
 * on domain, unknown fields were stripped by zod but preserved by json,
 * `args` was shared by reference on domain, and a non-cloneable payload
 * poisoned every later read. Both providers now call these functions.
 *
 * UNKNOWN_FIELD_POLICY is `preserve`: a record written by a newer version must
 * survive a round-trip through an older provider, so unknown fields are kept
 * (json does this naturally; the domain schemas are `.loose()`).
 *
 * @module @deepseek-ai/dsh-evolution-state-storage/src/record-contract
 */

import { CURATOR_STATE_TABLE, PENDING_TABLE, REVIEW_STATE_TABLE } from './constants.ts'

/** The three seam tables a record can belong to. */
export type SeamRecordTable = typeof REVIEW_STATE_TABLE | typeof CURATOR_STATE_TABLE | typeof PENDING_TABLE

/** Unknown fields survive a provider round-trip (json preserves by
 * construction; the domain schemas are `.loose()`). */
export const UNKNOWN_FIELD_POLICY = 'preserve' as const

const isNonNegInt = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string'
const PENDING_KINDS = new Set(['memory', 'skill', 'capability'])
const PENDING_STATUSES = new Set(['pending', 'executing', 'approved', 'rejected'])

/**
 * The write gate for one record. Both providers call this before persisting,
 * so a record the other provider would refuse can never land.
 * @param table - the seam table the record belongs to.
 * @param record - the candidate record.
 * @returns a human-readable issue, or null when the record is well-formed.
 */
export function recordIssue(table: SeamRecordTable, record: unknown): string | null {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return 'record must be a plain object'
  const value = record as Record<string, unknown>
  if (table === REVIEW_STATE_TABLE) {
    if (!isNonNegInt(value.turnsSinceMemory)) return 'turnsSinceMemory must be a non-negative integer'
    if (!isNonNegInt(value.turnsSinceSkill)) return 'turnsSinceSkill must be a non-negative integer'
    if (!isNonNegInt(value.lastTurn)) return 'lastTurn must be a non-negative integer'
    return null
  }
  if (table === CURATOR_STATE_TABLE) {
    if (value.schemaVersion !== undefined && !isNonNegInt(value.schemaVersion)) return 'schemaVersion must be a non-negative integer when present'
    if (typeof value.lastRunAt !== 'number' || !Number.isFinite(value.lastRunAt) || value.lastRunAt < 0) return 'lastRunAt must be a finite non-negative number'
    if (!isNonNegInt(value.runCount)) return 'runCount must be a non-negative integer'
    if (typeof value.lastSummary !== 'string') return 'lastSummary must be a string'
    if (typeof value.paused !== 'boolean') return 'paused must be a boolean'
    return null
  }
  if (typeof value.id !== 'string') return 'id must be a string'
  if (typeof value.kind !== 'string' || !PENDING_KINDS.has(value.kind)) return 'kind must be memory|skill|capability'
  if (typeof value.summary !== 'string') return 'summary must be a string'
  if (!Object.prototype.hasOwnProperty.call(value, 'args')) return 'args key is required (may be any cloneable value)'
  if (typeof value.createdAt !== 'string') return 'createdAt must be a string'
  if (typeof value.status !== 'string' || !PENDING_STATUSES.has(value.status)) return 'status must be pending|executing|approved|rejected'
  for (const field of ['resolvedAt', 'claimedBy', 'claimedAt', 'origin', 'sessionId']) {
    if (!optionalString(value[field])) return `${field} must be a string when present`
  }
  return null
}

/**
 * P2-15 (v19): the value must survive the seam's copy discipline. A payload
 * that cannot be structured-cloned (functions, symbols, class instances with
 * private state) would make every later read throw far away from the write.
 * @param record - the candidate record.
 * @returns a human-readable issue, or null when the value is cloneable.
 */
export function assertCloneable(record: unknown): string | null {
  try {
    structuredClone(record)
    return null
  } catch (error) {
    return `record is not structured-cloneable (${error instanceof Error ? error.message : String(error)})`
  }
}

/** Deep copy for every boundary crossing (read AND write). @param record - the value to copy. @returns an independent deep copy. */
export function cloneRecord<T>(record: T): T {
  return structuredClone(record)
}
