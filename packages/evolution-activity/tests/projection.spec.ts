import { describe, expect, it } from 'vitest'
import { apply, applyState, type State } from '../src/index.ts'

describe('evolution-activity projection', () => {
  it('folds plan-applied events into a bounded activity list', () => {
    let state: State = { items: [] }
    state = applyState(state, { type: 'evolution/plan-applied', data: { planId: 'p1', memoryApplied: 1, skillApplied: 1, rejectedOps: 0 }, time: 100 })
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ planId: 'p1', memoryApplied: 1 })
  })

  it('registers schemas both projection contracts can call .parse on', () => {
    interface ParsedSchema { parse(value: unknown): unknown }
    interface Captured {
      schema: ParsedSchema
      stateSchema: ParsedSchema
      wire: { viewSchema: ParsedSchema; view(state: unknown): unknown }
      view(state: unknown): unknown
    }
    const registrations: Captured[] = []
    const ctx = {
      inject(_deps: string[], callback: (projectionCtx: unknown) => void): void {
        callback({
          sessionProjections: {
            register(definition: Captured): () => void {
              registrations.push(definition)
              return () => {}
            },
          },
        })
      },
    }
    apply(ctx as never)
    expect(registrations).toHaveLength(1)
    const definition = registrations[0]!
    // Legacy (0.1.0-rc.6) hosts read `def.schema.parse`; 0.1.1+ hosts drive
    // `stateSchema` and `wire.viewSchema` — a schemastery schema (no .parse)
    // in either position breaks session-history loads.
    const schemas: Array<[string, ParsedSchema]> = [
      ['schema', definition.schema],
      ['stateSchema', definition.stateSchema],
      ['wire.viewSchema', definition.wire.viewSchema],
    ]
    const valid = { items: [{ planId: 'p1', kind: 'plan', memoryApplied: 1, skillApplied: 0, rejectedOps: 0, at: 100 }] }
    for (const [label, schema] of schemas) {
      expect(typeof schema.parse, label).toBe('function')
      expect(schema.parse(valid), label).toEqual(valid)
      expect(() => schema.parse({
        items: [{ planId: 'p1', kind: 'plan', memoryApplied: -1, skillApplied: 0, rejectedOps: 0, at: 100 }],
      }), label).toThrow()
    }
    const state = { items: [] }
    expect(definition.view(state)).toEqual(state)
    expect(definition.wire.view(state)).toEqual(state)
  })
})
