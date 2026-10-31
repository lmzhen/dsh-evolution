import { describe, expect, it } from 'vitest'
import { SKILL_SEARCH_DESCRIPTION, searchWithDegraded } from '../src/index.ts'

describe('skill_search degraded path', () => {
  it('never returns silent empty when search is unavailable or throws', async () => {
    const missing = await searchWithDegraded(undefined, { query: 'alpha' })
    expect(missing.degraded).toBe(true)
    expect(missing.hint).toContain('skill(name)')
    const failed = await searchWithDegraded({ search: async () => { throw new Error('down') } }, { query: 'alpha' })
    expect(failed.degraded).toBe(true)
    expect(failed.truncated).toBe(false)
  })

  it('passes through normal results and keeps the static description free of dynamic domains', async () => {
    const response = await searchWithDegraded({ search: async () => ({ results: [{ name: 'alpha', description: 'a' }], truncated: false }) }, { query: 'alpha', limit: 3 })
    expect(response.results).toHaveLength(1)
    expect(response.degraded).toBeUndefined()
    expect(SKILL_SEARCH_DESCRIPTION).not.toContain('<')
    expect(SKILL_SEARCH_DESCRIPTION.length).toBeLessThan(400)
  })
})
