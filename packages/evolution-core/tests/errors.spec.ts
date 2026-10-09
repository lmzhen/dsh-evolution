/**
 * The error table's own invariants (S2.9/1-5).
 *
 * E-305's text shipped twice, byte for byte, under two keys ('e-305-this-invocation-carries-no'
 * and its '-2' sibling) while both call sites passed the same placeholder — one scenario under two
 * names, so the next text edit would have moved only one of them. The table's own rule is "a key
 * names a SCENARIO"; this spec is what holds the 27 entries to it.
 */
import { describe, expect, it } from 'vitest'
import { EVOLUTION_ERRORS, errorText } from '../src/errors.ts'

describe('the evolution error table', () => {
  it('carries no duplicated text: one scenario, one key', () => {
    const byText = new Map<string, string[]>()
    for (const [key, text] of Object.entries(EVOLUTION_ERRORS)) {
      byText.set(text, [...(byText.get(text) ?? []), key])
    }
    const duplicated = [...byText.entries()].filter(([, keys]) => keys.length > 1)
    expect(duplicated).toEqual([])
  })

  it('fills every %aN% slot from the call site', () => {
    expect(errorText('e-305-this-invocation-carries-no', { a1: 'learn' }))
      .toContain('E-305: this invocation carries no agent — `learn` needs a session-backed call')
  })
})
