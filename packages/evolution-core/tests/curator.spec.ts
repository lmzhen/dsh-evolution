import { expect, it } from 'vitest'
import { computeLifecycleTransitions, computeScopeView, lifecycleCandidate, parseCuratorNominations, type UsageRecord } from '@deepseek-ai/dsh-evolution-core'

it('curator transitions active -> stale -> archived by idle time', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const stale = new Date(now.getTime() - 40 * 86_400_000)
  const ancient = new Date(now.getTime() - 120 * 86_400_000)
  const usage = new Map()
  usage.set('fresh', { created_by: 'agent', created_at: now.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: now.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  usage.set('stale-skill', { created_by: 'agent', created_at: stale.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: stale.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  usage.set('old-skill', { created_by: 'agent', created_at: ancient.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: ancient.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90 }, now)
  expect(result.markStale).toEqual(['stale-skill'])
  expect(result.archive).toEqual(['old-skill'])
})

it('quality-warned skills may turn stale earlier without early archive', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const idle = new Date(now.getTime() - 10 * 86_400_000)
  const usage = new Map()
  usage.set('warned-skill', { created_by: 'agent', created_at: idle.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: idle.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null, quality_warn: true })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90, qualityWarnStaleAfterDays: 7 }, now)
  expect(result.markStale).toEqual(['warned-skill'])
  expect(result.archive).toEqual([])
})

it('pinned and non-agent skills are untouched', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const old = new Date(now.getTime() - 200 * 86_400_000)
  const usage = new Map()
  usage.set('pinned', { created_by: 'agent', created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: true, archived_at: null })
  usage.set('manual', { created_by: null, created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90 }, now)
  expect(result.transitions.length).toBe(0)
})

it('suppressed names and bundled eligibility follow pruneBuiltins (F8)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const old = new Date(now.getTime() - 200 * 86_400_000)
  const record = (createdBy: string | null) => ({ created_by: createdBy, created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  const usage = new Map()
  usage.set('builtin-old', record(null))
  usage.set('suppressed-old', record(null))
  usage.set('plain-old', record(null))
  // Without pruneBuiltins, a bundled/unmanaged skill never enters the lifecycle.
  let result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90 }, now)
  expect(result.archive).toEqual([])
  // With pruneBuiltins the bundled name becomes a candidate; hub-style names
  // only enter when marked bundled, and suppressed names stay untouched.
  result = computeLifecycleTransitions(usage, {
    staleAfterDays: 30, archiveAfterDays: 90, pruneBuiltins: true,
    bundledNames: new Set(['builtin-old']),
    suppressedNames: new Set(['suppressed-old']),
  }, now)
  expect(result.archive).toEqual(['builtin-old'])
})

it('referenced skill names are never auto-transitioned (F3)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const old = new Date(now.getTime() - 200 * 86_400_000)
  const usage = new Map()
  usage.set('scheduled-skill', { created_by: 'agent', created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  const result = computeLifecycleTransitions(usage, {
    staleAfterDays: 30,
    archiveAfterDays: 90,
    referencedSkillNames: new Set(['scheduled-skill']),
  }, now)
  expect(result.transitions.length).toBe(0)
  // Same lifecycle without the reference set: normal transitions apply.
  const active = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90 }, now)
  expect(active.archive).toEqual(['scheduled-skill'])
})

it('parseCuratorNominations reads both YAML sections defensively', () => {
  const text = [
    'consolidations:',
    '  - from: narrow-a',
    '    into: umbrella',
    '    reason: merge',
    '  - from: narrow-b',
    '    into: umbrella',
    'prunings:',
    '  - name: stale-skill',
    '    reason: obsolete',
    '  - name: invalid NAME',
  ].join('\n')
  const nominations = parseCuratorNominations(text)
  expect(nominations.consolidations).toEqual([
    { from: 'narrow-a', into: 'umbrella' },
    { from: 'narrow-b', into: 'umbrella' },
  ])
  expect(nominations.prunings).toEqual(['stale-skill'])
  expect(nominations.prunings).not.toContain('invalid NAME')
})

it('computeScopeView classifies managed/watched/exempted/protected like the transition gates', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const age = new Date(now.getTime() - 200 * 86_400_000)
  const record = (over: Partial<UsageRecord> = {}): UsageRecord => ({
    created_by: 'agent', created_at: age.toISOString(), use_count: 1, view_count: 0, patch_count: 0,
    last_used_at: age.toISOString(), last_viewed_at: null, last_patched_at: null,
    state: 'active', pinned: false, archived_at: null, ...over,
  })
  const usage = new Map<string, UsageRecord>()
  usage.set('in-candidate', record())
  usage.set('watched-stale', record({ state: 'stale' }))
  usage.set('watched-quality', record({ quality_warn: true }))
  usage.set('excluded', record({ created_by: null })) // unmanaged
  usage.set('referenced', record())
  usage.set('pinned-skill', record({ pinned: true }))
  const config = {
    staleAfterDays: 30, archiveAfterDays: 90,
    excludeSkillNames: new Set(['excluded']),
    referencedSkillNames: new Set(['referenced']),
  }
  const view = computeScopeView(usage, config)
  expect(view.managed).toEqual(['in-candidate', 'watched-quality', 'watched-stale'])
  expect(view.watched).toEqual(['watched-quality', 'watched-stale'])
  expect(view.exempted).toEqual(['excluded', 'referenced'])
  expect(view.protected).toEqual(['pinned-skill'])
  // Parity: the transition engine never touches anything the view classifies
  // as exempted or protected (same shared gate by construction).
  const transitions = computeLifecycleTransitions(usage, config, now)
  const touched = [...transitions.markStale, ...transitions.archive, ...transitions.reactivate]
  expect(touched.filter(name => ['excluded', 'referenced', 'pinned-skill'].includes(name))).toEqual([])
})

it('lifecycleCandidate mirrors the transition gate for a bundled-prune mix', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const old = new Date(now.getTime() - 200 * 86_400_000)
  const record: UsageRecord = { created_by: null, created_at: old.toISOString(), use_count: 0, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null }
  const config = { staleAfterDays: 30, archiveAfterDays: 90, pruneBuiltins: true, bundledNames: new Set(['b']) }
  // Non-agent, non-bundled: not a candidate; bundled with pruneBuiltins: candidate.
  expect(lifecycleCandidate('manual', record, config, false)).toBe(false)
  expect(lifecycleCandidate('b', record, config, true)).toBe(true)
})
