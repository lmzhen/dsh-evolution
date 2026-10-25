// @tier fast
import { afterEach, describe, expect, it, vi } from 'vitest'
import { body, HOST_ROUTES, rows, view } from '../src/client/api.ts'

const answer = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response
const facts = {
  wireVersion: 1, readAt: 1,
  counts: { active: { verify: 0, pending: 1, fuse: 0, skipped: 0 }, expired: 0 },
  active: null, last: null,
  approval: { mergeApproval: true, platformWrite: { enabled: false, capability: true } },
  fallback: [{ id: 'scan', command: '/evolution merge scan' }],
  startCommands: { scan: 's', pair: 'p' }, notes: [], degraded: false,
}
afterEach(() => { vi.unstubAllGlobals() })

describe('merge-ui client api', () => {
  it('maps Facts including platformWrite and fallback commands', async () => {
    const fetchMock = vi.fn(async () => answer(facts))
    vi.stubGlobal('fetch', fetchMock)
    const result = await view()
    expect(result).toMatchObject({ ok: true, payload: {
      counts: { pending: 1 }, commands: ['/evolution merge scan'],
      approval: { mergeApproval: true, platformWrite: { enabled: false, capability: true } },
    } })
    expect(fetchMock).toHaveBeenCalledWith(HOST_ROUTES.view, { headers: { accept: 'application/json' } })
  })

  it('maps row stage, summary, reasonCode and body name/side', async () => {
    const fetchMock = vi.fn(async (url: string) => answer(url.includes('/body')
      ? { wireVersion: 1, name: 'alpha', side: 'live', text: '# a', markdown: true, truncated: false, totalBytes: 3 }
      : { wireVersion: 1, readAt: 1, queue: 'pending', expiredOnly: false, counts: facts.counts.active, rows: [{
          id: 'mr_a', state: 'pending', queue: 'pending', a: 'alpha', b: 'beta',
          target: { requested: 'alpha', actual: 'alpha-v2' }, summary: { a: 'A', b: 'B', rationale: 'R' },
          stage: 'lost', reasonCode: 'target-taken', actions: [{ id: 'approve', command: '/evolution merge approve mr_a', confirm: false, enabled: true }],
          bodies: [{ name: 'alpha', side: 'live' }, { name: 'beta', side: 'archive' }], createdAt: 1, updatedAt: 2,
        }] }))
    vi.stubGlobal('fetch', fetchMock)
    const page = await rows('pending')
    expect(page).toMatchObject({ ok: true, payload: { items: [{ id: 'mr_a', targetActual: 'alpha-v2', stageView: { state: 'lost' }, summary: { a: 'A', b: 'B', rationale: 'R' }, reasonCode: 'target-taken', actions: [{ id: 'approve' }] }] } })
    const bodyResult = await body('alpha', 'live')
    expect(bodyResult).toMatchObject({ ok: true, payload: { name: 'alpha', side: 'live', text: '# a' } })
    expect(fetchMock.mock.calls[1]?.[0]).toContain('name=alpha')
    await body('beta', 'archive')
    expect(fetchMock.mock.calls[2]?.[0]).toContain('side=archive')
  })

  it('maps the duplicate-name 400 to a body-ambiguous failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ wireVersion: 1, code: 'merge-bad-query', message: 'name matches multiple merge rows' }, 400)))
    expect(await body('dup', 'live')).toMatchObject({ ok: false, failure: { kind: 'problem', code: 'body-ambiguous', wireCode: 'merge-bad-query' } })
  })

  it('combines a stage with the staging expiry carried by the same row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ wireVersion: 1, readAt: 1, queue: 'fuse', expiredOnly: false, counts: facts.counts.active, rows: [{ id: 'mr_fuse', state: 'approved', queue: 'fuse', a: 'a', b: 'b', stage: 'present', staging: { state: 'kept', expiresAt: 42 }, target: { requested: 'a' }, actions: [], createdAt: 1, updatedAt: 2 }] })))
    expect(await rows('fuse')).toMatchObject({ ok: true, payload: { items: [{ stageView: { state: 'present', expiresAt: 42 } }] } })
  })

  it('classifies the error taxonomy', async () => {
    const cases: readonly [unknown, number, string][] = [
      [{}, 401, 'unauthenticated'],
      [{}, 403, 'forbidden'],
      [{ wireVersion: 1, code: 'E-325' }, 404, 'unmounted'],
      [{ wireVersion: 1, code: 'E-323', message: 'E-323: subagent channel unavailable' }, 503, 'capability'],
      [{ wireVersion: 1, code: 'merge-body-not-found' }, 404, 'body-missing'],
      [{ wireVersion: 1, code: 'merge-bad-query' }, 400, 'bad-query'],
      [{ wireVersion: 2 }, 200, 'wire-version'],
      [{ wireVersion: 1, code: 'merge-body-missing' }, 200, 'body-missing'],
      [{ wireVersion: 1, code: 'service-absent' }, 200, 'refused'],
      [{ code: 'maintenance' }, 503, 'server'],
    ]
    for (const [payload, status, code] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => answer(payload, status)))
      const result = await view()
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.failure).toMatchObject({ kind: 'problem', code })
    }
    const readiness = { ok: false, code: 'merge-state-migration-blocked', message: 'raw host message' }
    vi.stubGlobal('fetch', vi.fn(async () => answer({ wireVersion: 1, code: 'merge-state-blocked', readiness }, 503)))
    const blocked = await view()
    expect(blocked).toMatchObject({ ok: false, failure: { kind: 'blocked', code: 'merge-state-blocked', readiness } })
  })

  it('does not treat a generic 503 as blocked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ code: 'maintenance' }, 503)))
    expect(await view()).toMatchObject({ ok: false, failure: { kind: 'problem', code: 'server', status: 503 } })
  })
})
