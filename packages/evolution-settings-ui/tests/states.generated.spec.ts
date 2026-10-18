// @tier fast
/**
 * G5/W7: the generated four-state base (states.generated.ts) is consumed by every card, so its
 * matrix is pinned here: an answer maps to exactly one phase, a refusal keeps the host sentence
 * verbatim, and a failed-state block announces itself (role=alert) with the surface's fallback hint.
 */
import { describe, expect, it } from 'vitest'
import { Block, FailureBlock, failureText, loadStateOf } from '../src/client/states.generated.ts'
import type { RouteAnswer, RouteFailure } from '../src/client/route-client.generated.ts'
import { FALLBACKS } from '../src/client/fallbacks.generated.ts'

const t = (key: string, values?: Readonly<Record<string, string | number>>): string =>
  values === undefined ? key : key + ':' + String(values['command'] ?? '')

const ok = <T>(data: T): RouteAnswer<T> => ({ ok: true, data })
const failed = <T>(failure: RouteFailure): RouteAnswer<T> => ({ ok: false, failure })

describe('loadStateOf: the four-state matrix', () => {
  it('maps an ok answer to ready/empty via the caller predicate', () => {
    expect(loadStateOf(ok([1]), data => data.length === 0)).toEqual({ phase: 'ready', data: [1] })
    expect(loadStateOf(ok([] as number[]), data => data.length === 0)).toEqual({ phase: 'empty' })
  })

  it('maps a classified failure to failed and keeps the failure object', () => {
    const failure: RouteFailure = { kind: 'unmounted', status: 404 }
    expect(loadStateOf(failed<number>(failure), () => false)).toEqual({ phase: 'failed', failure })
  })
})

describe('failureText: one sentence per classified kind', () => {
  it('uses the locale key for the four transport kinds and the host sentence for a refusal', () => {
    expect(failureText({ kind: 'unauthenticated', status: 401 }, t)).toBe('failureUnauthorized')
    expect(failureText({ kind: 'forbidden', status: 403 }, t)).toBe('failureForbidden')
    expect(failureText({ kind: 'unmounted', status: 404 }, t)).toBe('failureUnmounted')
    expect(failureText({ kind: 'server', status: 500 }, t)).toContain('HTTP 500')
    expect(failureText({ kind: 'refused', code: 'approval-refused', message: '宿主拒绝的原句' }, t)).toBe('宿主拒绝的原句')
  })
})

describe('Block / FailureBlock: the failed block is announced and cites the command fallback', () => {
  it('marks a fail block as role=alert and a neutral one without it', () => {
    const fail = Block({ tone: 'fail', title: 'x' }) as unknown as { props: { role?: string } }
    expect(fail.props.role).toBe('alert')
    const neutral = Block({ tone: 'neutral', title: 'x' }) as unknown as { props: { role?: string } }
    expect(neutral.props.role).toBeUndefined()
  })

  it('renders the fallback hint for an unreachable surface', () => {
    const node = FailureBlock({ failure: { kind: 'unmounted', status: 404 }, t, fallback: FALLBACKS.approval }) as unknown as {
      props: { children: unknown[] }
    }
    // The block's children are [title, hint]; the hint string carries the command table's answer.
    const serialized = JSON.stringify(node.props.children)
    expect(serialized).toContain('fallbackHint')
    expect(serialized).toContain('/evolution pending')
  })
})
