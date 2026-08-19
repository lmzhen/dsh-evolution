import { describe, expect, it } from 'vitest'
import { apply, applyState, type State } from '../src/index.ts'

describe('evolution-activity projection', () => {
  it('folds plan-applied events into a bounded activity list', () => {
    let state: State = { items: [] }
    state = applyState(state, { type: 'evolution/plan-applied', data: { planId: 'p1', memoryApplied: 1, skillApplied: 1, rejectedOps: 0 }, time: 100 })
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ planId: 'p1', memoryApplied: 1 })
  })

  it('registers a schema the projection host can call .parse on', () => {
    const registrations: Array<{ schema: { parse(value: unknown): unknown } }> = []
    const ctx = {
      inject(_deps: string[], callback: (projectionCtx: unknown) => void): void {
        callback({
          sessionProjections: {
            register(definition: { schema: { parse(value: unknown): unknown } }): () => void {
              registrations.push(definition)
              return () => {}
            },
          },
        })
      },
    }
    apply(ctx as never)
    expect(registrations).toHaveLength(1)
    const { schema } = registrations[0]!
    // dsh-session-projection reads every projection through `def.schema.parse`,
    // so a schema without `parse` (e.g. a schemastery schema) breaks history loads.
    expect(typeof schema.parse).toBe('function')
    const valid = { items: [{ planId: 'p1', kind: 'plan', memoryApplied: 1, skillApplied: 0, rejectedOps: 0, at: 100 }] }
    expect(schema.parse(valid)).toEqual(valid)
    expect(() => schema.parse({
      items: [{ planId: 'p1', kind: 'plan', memoryApplied: -1, skillApplied: 0, rejectedOps: 0, at: 100 }],
    })).toThrow()
  })
})
