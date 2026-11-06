// @tier fast
/**
 * The error table's own invariants (S2.9/1-5).
 *
 * E-305's text shipped twice, byte for byte, under two keys ('e-305-this-invocation-carries-no'
 * and its '-2' sibling) while both call sites passed the same placeholder — one scenario under two
 * names, so the next text edit would have moved only one of them. The table's own rule is "a key
 * names a SCENARIO"; this spec is what holds the 27 entries to it.
 */
import { describe, expect, it } from 'vitest'
import { EVOLUTION_ERRORS, EVOLUTION_ERRORS_EN, EVOLUTION_ERRORS_JA, errorText, type EvolutionErrorId } from '../src/errors.ts'
import { installHostLocale } from '../src/messages.ts'

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
      .toContain('E-305: 本次调用没有携带 agent —— `learn` 需要由会话支撑的调用')
  })

  it('carries complete en and ja translations and resolves them via hostLocale', () => {
    for (const key of Object.keys(EVOLUTION_ERRORS) as EvolutionErrorId[]) {
      expect(EVOLUTION_ERRORS_EN[key]).toBeTruthy()
      expect(EVOLUTION_ERRORS_JA[key]).toBeTruthy()
    }
    const releaseEn = installHostLocale(() => 'en')
    try {
      expect(errorText('e-305-this-invocation-carries-no', { a1: 'learn' }))
        .toContain('E-305: This invocation carries no agent — `learn` requires a session-backed invocation')
    } finally {
      releaseEn()
    }
    const releaseJa = installHostLocale(() => 'ja')
    try {
      expect(errorText('e-305-this-invocation-carries-no', { a1: 'learn' }))
        .toContain('E-305: この呼び出しにはエージェントが含まれていません。`learn` にはセッションを伴う呼び出しが必要です')
    } finally {
      releaseJa()
    }
  })
})
