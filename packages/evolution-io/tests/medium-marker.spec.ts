// @tier pre-tag
/** G2a/2a.1: the medium marker. Two properties matter: it answers WITHOUT resolving anything (asking must
 * not be what decides the medium), and it never invents a name for the registry default. */
import { expect, it } from 'vitest'
import { describeMedium, preferProvider } from '../src/index.ts'

function refusingRegistry() {
  return { provider(name?: string) { if (name === 'fs') return { id: 'fs' }; throw new Error('not registered') } }
}

it('G2a/2a.1: asking which medium is active does not resolve one', () => {
  expect(describeMedium(refusingRegistry()).state).toBe('unknown')
})

it('G2a/2a.1: a preference that served is named', () => {
  const registry = refusingRegistry()
  const io = preferProvider(registry, ['sqlite', 'fs'])
  expect(io).toEqual({ id: 'fs' })
  const medium = describeMedium(registry)
  expect(medium.state).toBe('known')
  if (medium.state !== 'known') throw new Error('unreachable')
  expect(medium.resolved).toBe('fs')
  expect(medium.via).toBe('preference')
})

it('G2a/2a.1: the registry default records default, with no invented name', () => {
  // The stub REFUSES a named preference, otherwise the preference hits and the default branch is unreachable.
  const registry = { provider(name?: string) { if (name !== undefined) throw new Error('not registered'); return { id: 'json' } } }
  preferProvider(registry, ['fs'])
  const medium = describeMedium(registry)
  expect(medium.state).toBe('known')
  if (medium.state !== 'known') throw new Error('unreachable')
  expect(medium.via).toBe('default')
  expect(medium.resolved).toBeUndefined()
})
