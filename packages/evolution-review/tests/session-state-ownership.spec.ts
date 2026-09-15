/**
 * P1-9 (S2-2): the review plugin's per-session collections register at their
 * declaration site, so the dispose hook cannot drift behind a new map. These
 * cases read the plugin source (the registry is package-internal and its
 * collections are closure state, so ownership is what a source read can prove)
 * and drive the registry itself for the clearing behavior.
 */
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SessionScopedState } from '../src/session-state.ts'

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
// One match per per-session collection: group 1 is its registry key, or
// undefined when the collection was created outside the registry.
const collections = [...source.matchAll(/(?:sessionState\.add\('(\w+)', )?new (?:Map|Set)<SessionId/g)]
const registered = collections.map(match => match[1]).filter((key): key is string => key !== undefined)
const unregistered = collections.filter(match => match[1] === undefined).length

it('every per-session collection in the plugin source is registered', () => {
  // The count is the tripwire: a new Map<SessionId, …> fails here until it is
  // registered (update the expectation together with the registration).
  expect(unregistered).toBe(0)
  expect(registered).toHaveLength(9)
})

it('the dispose hook delegates to the registry instead of hand-listing clears', () => {
  // Slice the cleanup effect by its own label, not by a regex that could span
  // back to an earlier ctx.effect in the file.
  const label = source.indexOf("'dsh-evolution-review.cleanup'")
  const open = source.lastIndexOf('ctx.effect(', label)
  expect(label).toBeGreaterThan(-1)
  expect(open).toBeGreaterThan(-1)
  const body = source.slice(source.indexOf('{', open) + 1, source.lastIndexOf('}', label))
  expect(body).toContain('sessionState.dispose()')
  expect(body).not.toContain('.clear()')
})

it('dispose empties every registered collection and is idempotent', () => {
  const registry = new SessionScopedState()
  const collections = registered.map(key => registry.add(key, new Map<string, number>([['session-a', 1]])))
  expect(registry.keys()).toEqual(registered)
  registry.dispose()
  for (const collection of collections) expect(collection.size).toBe(0)
  registry.dispose()
  for (const collection of collections) expect(collection.size).toBe(0)
})

it('registering the same key twice is refused', () => {
  const registry = new SessionScopedState()
  registry.add('turnStarts', new Map<string, number>())
  expect(() => registry.add('turnStarts', new Set<string>())).toThrow(/registered twice/)
})
