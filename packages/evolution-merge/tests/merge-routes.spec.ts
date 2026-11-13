// @tier pre-tag
import { expect, it } from 'vitest'
import { MERGE_ROUTES, makeMergeRoutes, type MergeRouteSource } from '../src/index.ts'

const audit = { channel: 'connection.fetch' as const, principal: 'owner' as const, deploymentAllowsRemote: true }
const emptySnapshot = async (): Promise<never> => ({
  wireVersion: 1, schemaVersion: 4, readAt: 0, queueRevision: 'x', consistency: 'eventual',
  rows: [], stages: [], runs: [], reports: [], report: null, history: [], bodyRefs: [],
  doctor: { counts: { active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 }, staging: { state: 'absent', dirs: 0 }, rows: [] },
  approval: { mergeApproval: false }, notes: [], degraded: false,
}) as never

function routesFor(source: MergeRouteSource | undefined) {
  return makeMergeRoutes({ getSource: () => source }, audit)
}

function fetchFrom(routes: ReturnType<typeof routesFor>, path: string) {
  const route = routes.find(item => item.path === path.split('?')[0])
  if (route === undefined) throw new Error('missing route')
  return route.fetch(new Request('http://local' + path))
}

it('rejects bad queries, wrong methods and an absent service', async () => {
  const routes = routesFor({ snapshot: emptySnapshot })
  expect((await fetchFrom(routes, MERGE_ROUTES.view)).status).toBe(200)
  expect((await routes.find(item => item.path === MERGE_ROUTES.view)!.fetch(new Request('http://local' + MERGE_ROUTES.view, { method: 'POST' }))).status).toBe(405)
  const bad = await fetchFrom(routes, MERGE_ROUTES.rows + '?queue=nope')
  expect(bad.status).toBe(400)
  expect(await bad.json()).toMatchObject({ code: 'merge-bad-query' })
  const absent = await fetchFrom(routesFor(undefined), MERGE_ROUTES.view)
  expect(absent.status).toBe(404)
  expect(await absent.json()).toMatchObject({ code: 'E-325' })
})

it('GET routes do not mutate the snapshot object', async () => {
  const snapshot = Object.freeze({
    wireVersion: 1, schemaVersion: 4, readAt: 0, queueRevision: 'x', consistency: 'eventual',
    rows: [], stages: [], runs: [], reports: [], report: null, history: [], bodyRefs: [],
    doctor: { counts: { active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 }, staging: { state: 'absent', dirs: 0 }, rows: [] },
    approval: { mergeApproval: false }, notes: [], degraded: false,
  } as never)
  const routes = routesFor({ snapshot: async () => snapshot })
  for (const path of [MERGE_ROUTES.view, MERGE_ROUTES.rows + '?queue=pending', MERGE_ROUTES.body + '?id=x&side=a', MERGE_ROUTES.history]) {
    const response = await fetchFrom(routes, path)
    expect(response.status, path).not.toBe(500)
  }
})

it('returns E-323 on view/rows but keeps read-only body/history available when the host data plane is unavailable', async () => {
  const snapshot = {
    wireVersion: 1, schemaVersion: 4, readAt: 0, queueRevision: 'x', consistency: 'eventual',
    hostOnly: { code: 'E-323', detail: 'agentPresets not mounted' },
    rows: [], stages: [], runs: [], reports: [], report: null, history: [], bodyRefs: [],
    doctor: { counts: { active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 }, staging: { state: 'absent', dirs: 0 }, rows: [] },
    approval: { mergeApproval: false }, notes: [], degraded: false,
  } as never
  const routes = routesFor({ snapshot: async () => snapshot })
  for (const path of [MERGE_ROUTES.view, MERGE_ROUTES.rows + '?queue=pending']) {
    const response = await fetchFrom(routes, path)
    expect(response.status, path).toBe(503)
    expect(await response.json(), path).toMatchObject({ wireVersion: 1, code: 'E-323' })
  }
  expect((await fetchFrom(routes, MERGE_ROUTES.body + '?id=mr_a&side=a')).status).toBe(404)
  expect((await fetchFrom(routes, MERGE_ROUTES.history)).status).toBe(200)
})

it('resolves a body by row id + source name + side, and refuses ambiguity', async () => {
  const snapshot = {
    readAt: 1,
    rows: [{ row: { id: 'mr_x' }, stage: null }],
    bodyRefs: [
      { rowId: 'mr_x', name: 'm1', side: 'live' },
      { rowId: 'mr_x', name: 'm2', side: 'live' },
    ],
  } as never
  const routes = routesFor({ snapshot: async () => snapshot, bodyRef: async (ref) => '# ' + ref.name })
  const byId = await (await fetchFrom(routes, MERGE_ROUTES.body + '?id=mr_x&name=m2&side=live')).json() as { name: string; text: string }
  expect(byId).toMatchObject({ name: 'm2', text: '# m2' })
  const byName = await (await fetchFrom(routes, MERGE_ROUTES.body + '?name=m2')).json() as { name: string; text: string }
  expect(byName).toMatchObject({ name: 'm2', text: '# m2' })
  expect((await fetchFrom(routes, MERGE_ROUTES.body + '?id=mr_x&name=m3&side=live')).status).toBe(404)
  const ambiguous = await fetchFrom(routes, MERGE_ROUTES.body + '?id=mr_x&side=live')
  expect(ambiguous.status).toBe(400)
  expect((await ambiguous.json() as { message: string }).message).toContain('ambiguous')
})

it('decides through the injected real-agent callback', async () => {
  const decided: string[] = []
  const routes = makeMergeRoutes({
    getSource: () => ({ snapshot: emptySnapshot }),
    decide: async (request) => { decided.push(request.rowId + ':' + request.verb + ':' + request.sessionId); return { ok: true, message: 'decided', runId: 'r9' } },
  }, audit)
  const route = routes.find(item => item.path === MERGE_ROUTES.decision)
  if (route === undefined) throw new Error('missing decision route')
  const response = await route.fetch(new Request('http://local' + MERGE_ROUTES.decision, { method: 'POST', body: JSON.stringify({ rowId: 'mr_x', verb: 'approve', sessionId: 's1' }) }))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ wireVersion: 1, ok: true, message: 'decided', runId: 'r9' })
  expect(decided).toEqual(['mr_x:approve:s1'])
  const bad = await route.fetch(new Request('http://local' + MERGE_ROUTES.decision, { method: 'POST', body: JSON.stringify({ rowId: 'mr_x', verb: 'drop', sessionId: 's1' }) }))
  expect(bad.status).toBe(400)
})
