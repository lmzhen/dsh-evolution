// @tier fast
/**
 * W9-g3 (audit 06-P1): the projection port used to accept only a callable-thenable handle; a plain
 * `Promise<ProjectionHandle>` (the platform's 0.2.2 form) fell through to the legacy branch and
 * every unit read undefined without an error. The port now names the shape it found.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { projectionPort, type EvolutionProjectionDefinition } from '../src/platform/projections.ts'

const definition: EvolutionProjectionDefinition<'unit', { n: number }> = {
  key: 'unit',
  stateVersion: 1,
  stateSchema: { parse: (value: unknown) => value } as never,
  init: () => ({ n: 0 }),
  apply: (state) => state,
}
const session = {} as never

const ctxOf = (registry: unknown): Context => ({ get: (name: string) => (name === 'sessionProjections' ? registry : undefined) }) as unknown as Context

describe('projection port shapes (06-P1)', () => {
  it('accepts the platform Promise<handle> contract', async () => {
    const dispose = vi.fn(async () => {})
    const registry = { register: () => Promise.resolve({ stateOf: () => ({ n: 7 }), dispose }) }
    const port = projectionPort(ctxOf(registry))
    const handle = await port!.register(definition)
    expect(port?.shape).toBe('handle')
    expect(handle.stateOf(session)).toEqual({ n: 7 })
  })

  it('NAMES an unrecognised shape instead of pretending the units are empty', async () => {
    const registry = { register: () => ({ unexpected: true }) }
    const port = projectionPort(ctxOf(registry))
    const handle = await port!.register(definition)
    expect(port?.shape).toBe('unrecognised')
    expect(port?.reason).toContain('returned object')
    expect(handle.stateOf(session)).toBeUndefined()
  })

  it('returns undefined when the host has no projection registry', () => {
    expect(projectionPort(ctxOf(undefined))).toBeUndefined()
  })
})
