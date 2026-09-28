// @vitest-environment jsdom
/**
 * Which module rows count as a renderer.
 *
 * Why this needs its own spec: the seam's success path cannot run in this lane at all (a module's
 * bare `require` here is vite-node's own, not `globalThis.require` — measured 2026-09-28: calling it
 * with the platform specifier throws `Cannot find module`). What CAN be pinned is the decision that
 * gates every render — and it needed pinning: 0.14.0 shipped a `typeof === 'function'` test, which
 * rejected the platform's `memo(...)` component (an OBJECT) and silently degraded every preview and
 * rendered diff to raw source. The live panel is what caught it; these cases keep it caught.
 */
import { describe, expect, it } from 'vitest'
import { rendererOf } from '../src/client/markdown.ts'

describe('the renderer a module row carries', () => {
  it('accepts a memo wrapper, which is an object rather than a function', () => {
    const memoLike = { $$typeof: Symbol.for('react.memo'), type: (): null => null, compare: null }
    expect(rendererOf({ MarkdownText: memoLike })).toBe(memoLike)
  })

  it('accepts a plain function component', () => {
    const component = (): null => null
    expect(rendererOf({ MarkdownText: component })).toBe(component)
  })

  it('refuses a row that carries no renderer', () => {
    expect(rendererOf({})).toBeUndefined()
    expect(rendererOf({ MarkdownText: null })).toBeUndefined()
    expect(rendererOf({ MarkdownText: 'MarkdownText' })).toBeUndefined()
  })
})
