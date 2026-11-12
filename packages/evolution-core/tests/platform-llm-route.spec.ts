// @tier fast
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { modelRoute } from '../src/platform/llm.ts'

/**
 * `sessionProjections.snapshot()` hands out the projection's VIEW. For modelSelection that view is
 * `{ lastUsed, next }` with `next = pending ?? lastUsed` (packages/core/agent/src/model-selection.ts
 * :87-88) — the state face's `pending` is NOT visible here, so reading it would always be undefined
 * and pin auxiliary calls to the model of the previous request.
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

describe('modelRoute: the view field `next` (already pending ?? lastUsed) wins', () => {
  it('takes the view next selection — a model the user just picked but no request has used yet', () => {
    expect(modelRoute(ctxWith({ lastUsed: OLD, next: NEXT }), undefined, {})).toEqual(NEXT)
  })

  it('falls back to lastUsed when the view carries no next selection', () => {
    expect(modelRoute(ctxWith({ lastUsed: OLD }), undefined, {})).toEqual(OLD)
  })

  it('ignores a view that carries neither field', () => {
    expect(modelRoute(ctxWith({}, PROBE), undefined, {})).toEqual(PROBE)
  })

  it('lets the agent-owned selection win over both', () => {
    const agent = { model: { current: () => OLD } }
    expect(modelRoute(ctxWith({ lastUsed: NEXT, next: NEXT }, PROBE), agent, {})).toEqual(OLD)
  })

  it('does not read the state field `pending`, which the view never exposes', () => {
    // A state-shaped payload must not be mistaken for a view: pending alone leaves the route on defaults.
    expect(modelRoute(ctxWith({ lastUsed: null, pending: NEXT }, PROBE), undefined, {})).toEqual(PROBE)
  })
})
