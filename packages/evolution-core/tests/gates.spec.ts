import { describe, expect, it } from 'vitest'
import { EvolutionGateSet, createGateSet, lifecycleCandidate, computeLifecycleTransitions, computeScopeView, PROTECTED_BUILTIN_SKILLS, type UsageRecord } from '@deepseek-ai/dsh-evolution-core'

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  created_by: 'agent',
  created_at: '2026-01-01T00:00:00.000Z',
  use_count: 1,
  view_count: 0,
  patch_count: 0,
  last_used_at: '2026-01-02T00:00:00.000Z',
  last_viewed_at: null,
  last_patched_at: null,
  state: 'active',
  pinned: false,
  archived_at: null,
  ...overrides,
})

describe('EvolutionGateSet (decision B: one gate source)', () => {
  it('reports the first blocking protection with its reason', () => {
    const gates = new EvolutionGateSet({
      exclude: new Set(['excluded-skill']),
      referenced: new Set(['scheduled-skill']),
      suppressed: new Set(['suppressed-skill']),
    })
    expect(gates.blockReason('excluded-skill')).toBe('excluded')
    expect(gates.blockReason('scheduled-skill')).toBe('referenced')
    expect(gates.blockReason('suppressed-skill')).toBe('suppressed')
    // Protected builtins are always part of the set.
    for (const builtin of PROTECTED_BUILTIN_SKILLS) {
      expect(gates.blockReason(builtin)).toBe('protected-builtin')
    }
    expect(gates.blockReason('regular-skill')).toBeNull()
    expect(gates.isBlocked('regular-skill')).toBe(false)
  })

  it('createGateSet maps the curator-style config field names', () => {
    const gates = createGateSet({
      excludeSkillNames: new Set(['a']),
      referencedSkillNames: new Set(['b']),
      suppressedNames: new Set(['c']),
    })
    expect(gates.isBlocked('a')).toBe(true)
    expect(gates.isBlocked('b')).toBe(true)
    expect(gates.isBlocked('c')).toBe(true)
    expect(gates.isBlocked('d')).toBe(false)
  })

  it('lifecycleCandidate blocks gated names regardless of record state', () => {
    const config = {
      staleAfterDays: 30,
      archiveAfterDays: 90,
      excludeSkillNames: new Set(['gated']),
      manageUnmanaged: true,
    }
    // referenced/suppressed/protected-builtin pass through the same set.
    const gates = new EvolutionGateSet({ referenced: new Set(['scheduled-skill']) })
    expect(lifecycleCandidate('gated', record(), config, false)).toBe(false)
    expect(lifecycleCandidate('scheduled-skill', record(), config, false, gates)).toBe(false)
    expect(lifecycleCandidate('normal-skill', record(), config, false)).toBe(true)
  })

  it('computeLifecycleTransitions and the merge gate read the same instance', () => {
    const usage = new Map([
      ['gated', record()],
      ['ungated', record()],
    ])
    const gates = new EvolutionGateSet({ exclude: new Set(['gated']) })
    const result = computeLifecycleTransitions(usage, { staleAfterDays: 0, archiveAfterDays: 365 }, new Date(), gates)
    // The gated skill never transitions even though its idle clock exceeds
    // the (zero) stale window.
    expect(result.markStale).toEqual(['ungated'])
  })

  it('computeScopeView keeps its bucket semantics while reading the shared sets', () => {
    const usage = new Map([
      ['excluded-skill', record()],
      ['scheduled-skill', record()],
      ['suppressed-skill', record({ pinned: true })],
      ['plain-skill', record()],
    ])
    const gates = new EvolutionGateSet({
      exclude: new Set(['excluded-skill']),
      referenced: new Set(['scheduled-skill']),
      suppressed: new Set(['suppressed-skill']),
    })
    const view = computeScopeView(usage, { staleAfterDays: 30, archiveAfterDays: 90 }, undefined, gates)
    // exclude/referenced read as exempted; suppressed as protected (unchanged
    // presentation, shared source).
    expect(view.exempted).toEqual(['excluded-skill', 'scheduled-skill'])
    expect(view.protected).toEqual(['suppressed-skill'])
    expect(view.managed).toEqual(['plain-skill'])
  })
})
