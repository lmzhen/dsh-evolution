// @tier fast
/**
 * The client data layer: `api.rows` is the panel's ONLY source of facts, so its three outcomes
 * (payload, host refusal, transport failure) are pinned here — a panel that renders an empty state
 * for a refusal would read as "nothing found". The transport is the GENERATED shared route-client:
 * 2xx carries the family envelope, and the four classified failures are its vocabulary.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOST_ROUTES, rows } from '../src/client/api.ts'

const answer = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('skill-health client api (HOST_ROUTES.rows)', () => {
  it('mirrors the host half route the panel fetches', () => {
    expect(HOST_ROUTES.rows).toBe('/api/dsh-evolution/skill-health/rows')
  })

  it('returns the payload the route reported', async () => {
    const payload = { rows: [{ name: 'a', verdict: 'ok', findings: [] }], truncated: false }
    const fetchMock = vi.fn(async () => answer({ ok: true, data: payload }))
    vi.stubGlobal('fetch', fetchMock)
    const outcome = await rows()
    expect(fetchMock).toHaveBeenCalledWith(HOST_ROUTES.rows, { headers: { accept: 'application/json' } })
    expect(outcome).toEqual({ ok: true, payload })
  })

  it("carries the host's own refusal sentence instead of inventing one", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ ok: false, code: 'curator-refused', message: 'curator: 未标定的规则不报数字' })))
    const outcome = await rows()
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.failure).toEqual({ kind: 'refused', code: 'curator-refused', message: 'curator: 未标定的规则不报数字' })
  })

  it('classifies the platform admission answers (401/403/404) without reading their bodies', async () => {
    for (const [status, kind] of [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'unmounted']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => answer('forbidden', status)))
      const outcome = await rows()
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.failure).toMatchObject({ kind, status })
    }
  })

  it('reports a transport failure as a refusal rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket closed') }))
    const outcome = await rows()
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.failure).toMatchObject({ kind: 'server', status: 0, detail: 'socket closed' })
  })
})
