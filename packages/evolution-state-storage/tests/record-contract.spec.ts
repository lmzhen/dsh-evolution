import { describe, expect, it } from 'vitest'
import {
  assertCloneable,
  cloneRecord,
  recordIssue,
  CURATOR_STATE_TABLE,
  PENDING_TABLE,
  REVIEW_STATE_TABLE,
  UNKNOWN_FIELD_POLICY,
} from '../src/index.ts'

const pending = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending', ...overrides,
})

describe('seam record contract (P2-12/14/15/16/18, v19)', () => {
  it('accepts the well-formed shapes of all three tables', () => {
    expect(recordIssue(REVIEW_STATE_TABLE, { turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })).toBeNull()
    expect(recordIssue(CURATOR_STATE_TABLE, { lastRunAt: 1, runCount: 0, lastSummary: 's', paused: false })).toBeNull()
    expect(recordIssue(CURATOR_STATE_TABLE, { schemaVersion: 2, lastRunAt: 1, runCount: 0, lastSummary: 's', paused: true })).toBeNull()
    expect(recordIssue(PENDING_TABLE, pending())).toBeNull()
    // Unknown fields are allowed by design (UNKNOWN_FIELD_POLICY = preserve).
    expect(recordIssue(PENDING_TABLE, { ...pending(), extra: 1 })).toBeNull()
    expect(UNKNOWN_FIELD_POLICY).toBe('preserve')
  })

  it('refuses the malformed shapes both providers must reject', () => {
    expect(recordIssue(REVIEW_STATE_TABLE, { turnsSinceMemory: -1, turnsSinceSkill: 0, lastTurn: 0 })).toContain('turnsSinceMemory')
    expect(recordIssue(CURATOR_STATE_TABLE, { schemaVersion: 1.5, lastRunAt: 1, runCount: 0, lastSummary: 's', paused: false })).toContain('schemaVersion')
    expect(recordIssue(CURATOR_STATE_TABLE, { lastRunAt: Number.NaN, runCount: 0, lastSummary: 's', paused: false })).toContain('lastRunAt')
    expect(recordIssue(PENDING_TABLE, { ...pending(), args: undefined })).toBeNull() // key present
    const { args: _args, ...withoutArgs } = pending()
    expect(recordIssue(PENDING_TABLE, withoutArgs)).toContain('args')
    expect(recordIssue(PENDING_TABLE, pending({ kind: 'nope' }))).toContain('kind')
    expect(recordIssue(PENDING_TABLE, pending({ status: 'nope' }))).toContain('status')
    expect(recordIssue(PENDING_TABLE, pending({ resolvedAt: 1 }))).toContain('resolvedAt')
    expect(recordIssue(PENDING_TABLE, [1, 2])).toContain('plain object')
  })

  it('rejects non-cloneable payloads and copies deeply', () => {
    expect(assertCloneable({ fn: () => {} })).toContain('not structured-cloneable')
    expect(assertCloneable({ ok: 1 })).toBeNull()
    const source = { nested: { value: 1 } }
    const copy = cloneRecord(source)
    copy.nested.value = 2
    expect(source.nested.value).toBe(1)
  })
})
