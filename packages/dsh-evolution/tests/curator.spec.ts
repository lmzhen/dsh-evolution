import { expect, it } from 'vitest'
import { computeLifecycleTransitions } from '../src/curator.ts'

it('curator transitions active -> stale -> archived by idle time', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const stale = new Date(now.getTime() - 40 * 86_400_000)
  const ancient = new Date(now.getTime() - 120 * 86_400_000)
  const usage = new Map()
  usage.set('fresh', { created_by: 'agent', created_at: now.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: now.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  usage.set('stale-skill', { created_by: 'agent', created_at: stale.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: stale.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  usage.set('old-skill', { created_by: 'agent', created_at: ancient.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: ancient.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90, pruneBuiltins: true }, now)
  expect(result.markStale).toEqual(['stale-skill'])
  expect(result.archive).toEqual(['old-skill'])
})

it('quality-warned skills may turn stale earlier without early archive', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const idle = new Date(now.getTime() - 10 * 86_400_000)
  const usage = new Map()
  usage.set('warned-skill', { created_by: 'agent', created_at: idle.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: idle.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null, quality_warn: true })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90, pruneBuiltins: true, qualityWarnStaleAfterDays: 7 }, now)
  expect(result.markStale).toEqual(['warned-skill'])
  expect(result.archive).toEqual([])
})

it('pinned and non-agent skills are untouched', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const old = new Date(now.getTime() - 200 * 86_400_000)
  const usage = new Map()
  usage.set('pinned', { created_by: 'agent', created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: true, archived_at: null })
  usage.set('manual', { created_by: null, created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90, pruneBuiltins: true }, now)
  expect(result.transitions.length).toBe(0)
})
