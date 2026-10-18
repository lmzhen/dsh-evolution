import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/restrictor.ts'

interface Harness {
  readonly ctx: unknown
  readonly calls: Array<Record<string, unknown>>
  readonly cleanups: Array<() => void>
}

function harness(): Harness {
  const calls: Array<Record<string, unknown>> = []
  const cleanups: Array<() => void> = []
  const tools = {
    restrict(filter: Record<string, unknown>): () => void {
      calls.push(filter)
      return () => { calls.push({ disposed: true }) }
    },
  }
  const ctx = {
    tools,
    effect(run: () => () => void, _label?: string): () => void {
      const dispose = run()
      cleanups.push(dispose)
      return () => {}
    },
  }
  return { ctx, calls, cleanups }
}

describe('evolution restrictor (G2-S3)', () => {
  it('injects the tools service under the frozen name', () => {
    expect(name).toBe('evolution-restrictor')
    expect(inject).toEqual(['tools'])
  })

  it('restricts to the normalized allow set exactly once', () => {
    const h = harness()
    apply(h.ctx as never, { allow: [' tool-skill ', 'tool-skill', ''] })
    expect(h.calls).toEqual([{ allow: ['tool-skill'] }])
  })

  it('passes deny alone and both sets when given', () => {
    const a = harness()
    apply(a.ctx as never, { deny: ['skill_manage'] })
    expect(a.calls).toEqual([{ deny: ['skill_manage'] }])
    const b = harness()
    apply(b.ctx as never, { allow: ['a'], deny: ['b'] })
    expect(b.calls).toEqual([{ allow: ['a'], deny: ['b'] }])
  })

  it('disposes the restriction through the context effect', () => {
    const h = harness()
    apply(h.ctx as never, { allow: ['tool-skill'] })
    h.cleanups.forEach((dispose) => { dispose() })
    expect(h.calls).toEqual([{ allow: ['tool-skill'] }, { disposed: true }])
  })

  it('fails loud with E-324 on an empty filter or a missing tools service', () => {
    expect(() => apply(harness().ctx as never, { allow: [] })).toThrow(/E-324/)
    const bare = { effect: () => () => {} }
    expect(() => apply(bare as never, { allow: ['a'] })).toThrow(/E-324/)
  })
})
