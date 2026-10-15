// @tier pre-tag
/** G2b/2b.3: the process-scope claims must be POSITIVE when the capability is there and RED when it is not.
 * The second case is the whole point: a cross-process claim on an io with no transact lock used to be an
 * unstated assumption, and this is where it becomes a failing test. */
import { expect, it } from 'vitest'
import { MEDIUM_PROCESS_DECLARATION, processScopeViolations } from '../src/medium-declaration.ts'

it('G2b/2b.3: every record type states its medium and scope, with a reason', () => {
  expect(MEDIUM_PROCESS_DECLARATION.length).toBeGreaterThan(2)
  for (const claim of MEDIUM_PROCESS_DECLARATION) {
    expect(['json', 'domain']).toContain(claim.medium)
    expect(['cross-process', 'single-process']).toContain(claim.scope)
    expect(claim.because.length).toBeGreaterThan(20)
  }
})

it('G2b/2b.3: a cross-process claim is refused when the io has no transact lock', () => {
  expect(processScopeViolations({ transact: async () => null })).toEqual([])
  const unbacked = processScopeViolations({})
  expect(unbacked.length).toBeGreaterThan(0)
  expect(unbacked[0]).toContain('no transact lock')
  expect(processScopeViolations(undefined).length).toBe(unbacked.length)
})
