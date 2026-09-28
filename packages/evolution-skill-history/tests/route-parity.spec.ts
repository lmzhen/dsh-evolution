/**
 * The client's route table against the host's: the panel calls literals it declares itself, and a
 * rename on one side that missed the other would surface as a 404 in the GUI rather than in CI.
 *
 * The client deliberately declares FEWER routes than the host publishes (it never calls the health
 * probe), so the invariant is one-directional: every path the browser half knows must exist in the
 * host table under the same key and with the same value.
 */
import { describe, expect, it } from 'vitest'
import { HOST_ROUTES } from '../src/client/api.ts'
import { SKILL_HISTORY_ROUTES } from '../src/routes.ts'

describe('skill-history: the two route tables agree', () => {
  it('mirrors every client route to the host route of the same name', () => {
    const host: Record<string, string> = { ...SKILL_HISTORY_ROUTES }
    for (const [key, path] of Object.entries(HOST_ROUTES)) {
      expect(host[key], 'host table has no "' + key + '"').toBe(path)
    }
  })

  it('keeps the client from inventing a path the host does not publish', () => {
    const published = new Set<string>(Object.values(SKILL_HISTORY_ROUTES))
    for (const path of Object.values(HOST_ROUTES)) expect(published.has(path)).toBe(true)
  })
})
