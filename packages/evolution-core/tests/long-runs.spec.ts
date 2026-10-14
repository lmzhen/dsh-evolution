// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { LONG_RUNS } from '../src/index.ts'

describe('long-run inventory (S4)', () => {
  it('every entry names an owner, a measured basis, a budget line and a result home', () => {
    expect(LONG_RUNS.length).toBeGreaterThan(0)
    for (const entry of LONG_RUNS) {
      expect(entry.owner.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.measured.trim().length, entry.id).toBeGreaterThan(20)
      expect(entry.budget.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.resultHome.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.note.trim().length, entry.id).toBeGreaterThan(0)
    }
  })

  it('work whose lifetime is the plugin names an owner and a readable result — it outlives the request', () => {
    const pluginOwned = LONG_RUNS.filter(entry => entry.lifetime === 'plugin')
    expect(pluginOwned.length, 'the inventory must contain the runs that outlive a request').toBeGreaterThan(0)
    for (const entry of pluginOwned) {
      expect(entry.owner.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.resultHome, entry.id).toMatch(/reports\/|inbox/)
    }
    // The maintenance command must NOT borrow the request lifetime: that is the S2
    // contract, and the reason this table exists.
    expect(LONG_RUNS.find(entry => entry.id === '/evolution maintain')?.lifetime).toBe('plugin')
  })

  it('a request-lifetime entry states the budget or the reason it needs none', () => {
    for (const entry of LONG_RUNS.filter(item => item.lifetime === 'request')) {
      expect(entry.budget.trim().length, entry.id).toBeGreaterThan(0)
    }
  })

  // G5 step 5 (audit F1/F2): the README-vs-renderer pin was retired with the renderer's last
  // consumer - `renderLongRunTable` has no caller (the README is generated on the producing side),
  // so both sides of that assertion sat off the production path.
})
