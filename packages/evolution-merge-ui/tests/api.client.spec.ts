// @tier fast
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOST_ROUTES, rows, view } from '../src/client/api.ts'

const answer = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

afterEach(() => { vi.unstubAllGlobals() })

describe('merge-ui client api', () => {
  it('mirrors the host routes', () => {
    expect(HOST_ROUTES.view).toBe('/api/dsh-evolution/merge/view')
    expect(HOST_ROUTES.rows).toBe('/api/dsh-evolution/merge/rows')
  })

  it('reads the view payload', async () => {
    const payload = { counts: { pending: 1, retry: 0, skipped: 0 }, tabs: [], commands: [] }
    const fetchMock = vi.fn(async () => answer({ ok: true, data: payload }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await view()).toEqual({ ok: true, payload })
    expect(fetchMock).toHaveBeenCalledWith(HOST_ROUTES.view, { headers: { accept: 'application/json' } })
  })

  it('keeps a nested host error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ ok: false, error: { code: 'bad-queue', message: 'queue must be pending/retry/skipped' } })))
    expect(await view()).toMatchObject({ ok: false, failure: { kind: 'refused', code: 'bad-queue', message: 'queue must be pending/retry/skipped' } })
  })

  it('passes queue/cursor to rows and keeps a host refusal', async () => {
    const fetchMock = vi.fn(async () => answer({ ok: false, code: 'service-absent', message: 'merge service is not mounted' }))
    vi.stubGlobal('fetch', fetchMock)
    const outcome = await rows('pending', 10)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(HOST_ROUTES.rows + '?queue=pending&cursor=10')
    expect(outcome).toMatchObject({ ok: false, failure: { kind: 'refused', code: 'service-absent' } })
  })
})