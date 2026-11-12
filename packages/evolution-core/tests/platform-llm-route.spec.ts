// @tier fast
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { modelRoute } from '../src/platform/llm.ts'

/**
 * The platform publishes two selections (packages/core/agent/src/model-selection.ts): `lastUsed` — the
 * model the previous request actually used — and `pending`, a choice the user just made that no request
 * has carried yet. Reading `lastUsed` first leaves auxiliary calls (review, curator) on the old model
 * until the user sends another message, which is exactly the window this pins.
 */

const PROBE = { provider: 'deepseek', model: 'probe' }
const OLD = { provider: 'deepseek', model: 'old' }
const NEXT = { provider: 'deepseek', model: 'next' }

function ctxWith(value: unknown, defaults: unknown = undefined): Context {
  return {
    get: (name: string) => {
      if (name === 'sessionProjections') return { snapshot: () => ({ values: { modelSelection: value } }) }
      if (name === 'agentDefaultModel') return defaults === undefined ? undefined : { currentSelection: () => defaults }
      return undefined
    },
  } as unknown as Context
}

describe('modelRoute: the session selection the agent has not used yet still wins', () => {
  it('prefers pending (a fresh user choice) over lastUsed', () => {
    expect(modelRoute(ctxWith({ lastUsed: OLD, pending: NEXT }), undefined, {})).toEqual(NEXT)
  })

  it('falls back to lastUsed once the pending choice has been consumed', () => {
    expect(modelRoute(ctxWith({ lastUsed: OLD, pending: null }), undefined, {})).toEqual(OLD)
  })

  it('ignores a session selection that carries neither field', () => {
    expect(modelRoute(ctxWith({}, PROBE), undefined, {})).toEqual(PROBE)
  })

  it('lets the agent-owned selection win over both', () => {
    const agent = { model: { current: () => OLD } }
    expect(modelRoute(ctxWith({ lastUsed: NEXT, pending: NEXT }, PROBE), agent, {})).toEqual(OLD)
  })
})
