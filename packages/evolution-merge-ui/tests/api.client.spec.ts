// @tier fast
import { afterEach, describe, expect, it, vi } from 'vitest'
import { body, history, HOST_ROUTES, rows, view } from '../src/client/api.ts'

const answer = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

afterEach(() => { vi.unstubAllGlobals() })

describe('merge-ui client api', () => {
  it('mirrors the host routes', () => {
    expect(HOST_ROUTES.view).toBe('/api/dsh-evolution/merge/view')
    expect(HOST_ROUTES.rows).toBe('/api/dsh-evolution/merge/rows')
    expect(HOST_ROUTES.body).toBe('/api/dsh-evolution/merge/body')
    expect(HOST_ROUTES.history).toBe('/api/dsh-evolution/merge/history')
  })

  it('maps the wire Facts envelope', async () => {
    const facts = { wireVersion: 1, readAt: 1, approval: { mergeApproval: true }, counts: { active: { verify: 0, pending: 1, fuse: 0, skipped: 0 }, expired: 0 }, active: null, last: null, startCommands: { scan: 's', pair: 'p' }, fallback: [{ id: 'scan', command: '/evolution merge scan' }], notes: [], degraded: false }
    const fetchMock = vi.fn(async () => answer(facts))
    vi.stubGlobal('fetch', fetchMock)
    expect(await view()).toMatchObject({ ok: true, payload: { counts: { pending: 1 }, commands: ['/evolution merge scan'], approval: true } })
    expect(fetchMock).toHaveBeenCalledWith(HOST_ROUTES.view, { headers: { accept: 'application/json' } })
  })

  it('maps wire body/history and preserves refusals', async () => {
    const fetchMock = vi.fn(async (url: string) => answer(url.includes('/body')
      ? { wireVersion: 1, readAt: 1, name: 'a', side: 'live', text: '# a', markdown: true, truncated: false, totalBytes: 3 }
      : { wireVersion: 1, readAt: 1, items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await body('mr_a', 'a')).toMatchObject({ ok: true, payload: { content: '# a', html: '# a' } })
    expect(await history()).toMatchObject({ ok: true, payload: { items: [] } })
  })

  it('passes queue/cursor to rows and keeps a top-level refusal', async () => {
    const fetchMock = vi.fn(async (url: string) => answer(url.includes('/rows')
      ? { wireVersion: 1, readAt: 1, queue: 'pending', expiredOnly: true, counts: { active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 }, rows: [{ id: 'r', state: 'pending', queue: 'pending', a: 'a', b: 'b', target: { requested: 'a', actual: 'a2', created: true }, staging: { state: 'cleared-source-ok' }, verifySubState: 'queued', skipKind: 'agent-keep', actions: [{ id: 'approve', command: '/evolution merge approve r', confirm: false, enabled: false, disabledReason: 'expired' }], createdAt: 1, updatedAt: 2 }], notes: [] }
      : { wireVersion: 1, code: 'service-absent', message: 'merge service is not mounted' }))
    vi.stubGlobal('fetch', fetchMock)
    const page = await rows('pending', 'abc', true)
    expect(page).toMatchObject({ ok: true, payload: { queue: 'pending' } })
    if (page.ok) expect(page.payload.items[0]).toMatchObject({ targetActual: 'a2', targetCreated: true, stagingState: 'cleared-source-ok', verifySubState: 'queued', skipKind: 'agent-keep', actions: [{ id: 'approve', enabled: false, disabledReason: 'expired' }] })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(HOST_ROUTES.rows + '?queue=pending&cursor=abc&expired=1')
    vi.stubGlobal('fetch', vi.fn(async () => answer({ wireVersion: 1, code: 'service-absent', message: 'merge service is not mounted' })))
    expect(await rows('pending', undefined, true)).toMatchObject({ ok: false, failure: { kind: 'refused', code: 'service-absent' } })
    vi.stubGlobal('fetch', vi.fn(async () => answer({ wireVersion: 1, readAt: 1, queue: 'fuse', expiredOnly: false, counts: {}, rows: [], notes: [] })))
    expect(await rows('pending')).toMatchObject({ ok: false, failure: { kind: 'server' } })
  })
})
