import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/restrictor.ts'

interface ChildCtx {
  readonly tools: { restrict(filter: Record<string, unknown>): () => void }
  readonly effect: (run: () => () => void, label?: string) => unknown
}

function harness(composedOf: (ctx: ChildCtx) => string | undefined = () => 'evolution-reviewer-readonly') {
  const calls: Array<Record<string, unknown>> = []
  const cleanups: Array<() => void> = []
  const labels: Array<string | undefined> = []
  let listener: ((payload: { agent?: { ctx: ChildCtx } }) => void) | undefined
  const presets = { composedPreset: (ctx: ChildCtx) => composedOf(ctx) }
  const ctx = {
    agentPresets: presets,
    on(_event: 'agent/created', registered: (payload: { agent?: { ctx: ChildCtx } }) => void) {
      listener = registered
      return () => {}
    },
  }
  const child = (): ChildCtx => ({
    tools: {
      restrict(filter: Record<string, unknown>) {
        calls.push(filter)
        return () => { calls.push({ disposed: true }) }
      },
    },
    effect(run: () => () => void, label?: string) {
      labels.push(label)
      const dispose = run()
      cleanups.push(dispose)
      return () => {}
    },
  })
  return {
    ctx,
    calls,
    cleanups,
    labels,
    child,
    emit(agentCtx: ChildCtx) { listener?.({ agent: { ctx: agentCtx } }) },
    listenerRegistered: () => listener !== undefined,
  }
}

describe('evolution restrictor (G2-S3, W4 R: child-scope)', () => {
  it('is the frozen restricted-preset row and waits for the preset registry', () => {
    expect(name).toBe('evolution-restrictor')
    expect(inject).toEqual(['agentPresets'])
  })

  it('restricts ONLY agents composed with its own restricted preset', () => {
    const h = harness((ctx) => (ctx === h.own ? 'evolution-reviewer-readonly' : 'standard'))
    apply(h.ctx as never, { allow: [' skill ', 'skill', ''], presetId: 'evolution-reviewer-readonly' })
    expect(h.listenerRegistered()).toBe(true)
    const other = h.child()
    h.emit(other)
    expect(h.calls).toEqual([])
    const own = h.child()
    ;(h as unknown as { own: ChildCtx }).own = own
    h.emit(own)
    expect(h.calls).toEqual([{ allow: ['skill'] }])
    expect(h.labels).toEqual(['evolution-restrictor:child'])
  })

  it('passes deny alone and both sets when given', () => {
    const a = harness()
    apply(a.ctx as never, { deny: ['skill_manage'], presetId: 'evolution-reviewer-readonly' })
    const ownA = a.child()
    ;(a as unknown as { own: ChildCtx }).own = ownA
    a.emit(ownA)
    expect(a.calls).toEqual([{ deny: ['skill_manage'] }])
    const b = harness()
    apply(b.ctx as never, { allow: ['a'], deny: ['b'], presetId: 'evolution-reviewer-readonly' })
    const ownB = b.child()
    ;(b as unknown as { own: ChildCtx }).own = ownB
    b.emit(ownB)
    expect(b.calls).toEqual([{ allow: ['a'], deny: ['b'] }])
  })

  it('releases the restriction through the CHILD context effect', () => {
    const h = harness()
    apply(h.ctx as never, { allow: ['skill'], presetId: 'evolution-reviewer-readonly' })
    const own = h.child()
    ;(h as unknown as { own: ChildCtx }).own = own
    h.emit(own)
    h.cleanups.forEach((dispose) => { dispose() })
    expect(h.calls).toEqual([{ allow: ['skill'] }, { disposed: true }])
  })

  it('fails loud with E-324 on an empty filter, a missing presetId, or a scope without on()', () => {
    expect(() => apply(harness().ctx as never, { allow: [], presetId: 'evolution-reviewer-readonly' })).toThrow(/E-324/)
    expect(() => apply(harness().ctx as never, { allow: ['skill'] })).toThrow(/presetId/)
    expect(() => apply({ agentPresets: {} } as never, { allow: ['skill'], presetId: 'x' })).toThrow(/E-324/)
    const h = harness()
    apply(h.ctx as never, { allow: ['skill'], presetId: 'evolution-reviewer-readonly' })
    ;(h as unknown as { own: ChildCtx }).own = h.child()
    const brokenChild = { tools: undefined } as unknown as ChildCtx
    expect(() => h.emit(brokenChild)).toThrow(/E-324/)
  })
})
