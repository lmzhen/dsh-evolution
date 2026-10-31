// @tier ci-only
import { describe, expect, it } from 'vitest'
import { SKILL_MANAGE_DESCRIPTION, computeBehaviorMetrics, isDiscoveryUserPolicy } from '../src/index.ts'

describe('G6 product contract', () => {
  it('accepts only map mode/maxCards/tokenBudget/staleAfterHours/pin/disable', () => {
    expect(isDiscoveryUserPolicy({ mode: 'auto', maxCards: 8, tokenBudget: 1200, staleAfterHours: 24, pinDomains: ['d'], disableDomains: [] })).toBe(true)
    expect(isDiscoveryUserPolicy({ mode: 'on', skills: ['a'] })).toBe(false)
    expect(isDiscoveryUserPolicy({ mode: 'bad' })).toBe(false)
    expect(isDiscoveryUserPolicy({ primaryParent: 'd' })).toBe(false)
    expect(SKILL_MANAGE_DESCRIPTION).not.toContain('<')
    expect(SKILL_MANAGE_DESCRIPTION).toContain('no proposal means unclassified')
  })

  it('computes replayable behavior metrics without sentence locking', () => {
    const metrics = computeBehaviorMetrics([
      { awarenessShown: true, awarenessRecalled: true, silentMiss: false, searched: true, overSearch: false, underSearch: false, wrongLoad: false, taskSuccess: true, tokens: 10, fallback: false },
      { awarenessShown: true, awarenessRecalled: false, silentMiss: true, searched: false, overSearch: false, underSearch: true, wrongLoad: false, taskSuccess: false, tokens: 20, fallback: true },
    ])
    expect(metrics.total).toBe(2)
    expect(metrics.awarenessRecall).toBe(0.5)
    expect(metrics.silentMissRate).toBe(0.5)
    expect(metrics.underSearchRate).toBe(0)
    expect(metrics.taskSuccess).toBe(0.5)
    expect(metrics.tokens).toBe(30)
    expect(metrics.fallbackRate).toBe(0)
    expect(computeBehaviorMetrics([]).total).toBe(0)
  })
})
