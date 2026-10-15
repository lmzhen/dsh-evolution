// @tier pre-tag
/** G3/3.3: the footprint has two halves that must not be conflated - the READING (one line per
 * registered store, UNKNOWN when nothing was measured) and the FORWARDING (the reading reaches the
 * facts block through buildMaintainFacts). Removing either half removes every store line. */
import { expect, it } from 'vitest'
import { buildMaintainFacts } from '../src/orchestrate.ts'
import { reclamationFootprint } from '../src/footprint.ts'

it('G3/3.3: without io every registered store reads UNKNOWN, with the reason stated', async () => {
  const footprint = await reclamationFootprint(undefined)
  expect(footprint.length).toBeGreaterThan(5)
  expect(footprint.every(entry => entry.used === undefined)).toBe(true)
  expect(footprint.every(entry => (entry.skipped ?? '').length > 0)).toBe(true)
})

it('G3/3.3: the reading reaches the facts block through buildMaintainFacts', async () => {
  const footprint = await reclamationFootprint(undefined)
  const { facts } = buildMaintainFacts([], undefined, undefined, footprint)
  expect(facts).toContain('signal=store/')
  expect(facts).toContain('[UNKNOWN] signal=store/')
  const without = buildMaintainFacts([], undefined, undefined)
  expect(without.facts).not.toContain('signal=store/')
})
