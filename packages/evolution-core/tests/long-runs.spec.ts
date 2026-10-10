import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LONG_RUNS, renderLongRunTable } from '../src/index.ts'

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

  it('T-WD2 pattern: the README table equals the renderer, with no extra row after the block', () => {
    const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8')
    const rendered = renderLongRunTable().split('\n')
    const lines = readme.split('\n')
    const start = lines.findIndex(line => line === rendered[0])
    if (start === -1) throw new Error(`README long-run table drifted: first row not found:\n${rendered[0]}`)
    expect(lines.slice(start, start + rendered.length)).toEqual(rendered)
    const after = lines[start + rendered.length]
    expect(after === undefined || !after.startsWith('|'), `README carries an extra long-run row: ${after}`).toBe(true)
  })
})
