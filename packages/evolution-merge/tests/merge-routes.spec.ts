// @tier pre-tag
import { expect, it } from 'vitest'
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { MERGE_ROUTES, makeMergeRoutes, type MergeRow, type MergeRouteSource } from '../src/index.ts'

const audit = { channel: 'connection.fetch' as const, principal: 'owner' as const, deploymentAllowsRemote: true }
const row = (a: string, b: string, state: MergeRow['state']): MergeRow => ({
  id: 'mr_' + a, pairKey: a + '\u0000' + b, a, b, state,
  queue: state === 'pending' ? 'pending' : state === 'skipped' ? 'skipped' : state === 'fuse' || state === 'approved' ? 'fuse' : 'verify', createdAt: 'x', updatedAt: 'x',
})
const run: RunRecord = { id: 'r1', kind: 'merge', state: 'running', startedAt: 1, command: 'scan' }
const other: RunRecord = { id: 'r0', kind: 'maintenance', state: 'succeeded', startedAt: 0 }
const source: MergeRouteSource = {
  async rows() { return [row('a', 'b', 'pending'), row('c', 'd', 'fuse')] },
  async run(id) { return id === 'r1' ? run : undefined },
  async runs() { return [other, run] },
  async body(id, side) { const found = id === 'mr_a' ? row('a', 'b', 'pending') : undefined; return found === undefined ? null : side === 'a' ? '# alpha' : '# beta' },
  async history() { return [] },
  commands() { return ['merge scan'] },
  approval() { return true },
}
const routes = makeMergeRoutes({ getSource: () => source }, audit)
const fetchPath = async (path: string, method = 'GET') => {
  const route = routes.find(item => item.path === path.split('?')[0])
  if (route === undefined) throw new Error('missing route')
  return await route.fetch(new Request('http://local' + path, { method }))
}

it('serves view/rows/run/runs', async () => {
  const view = await (await fetchPath(MERGE_ROUTES.view)).json() as {
    ok: boolean
    data: { counts: unknown; latestRun?: { id: string }; approval?: boolean }
  }
  expect(view).toMatchObject({
    ok: true,
    data: { counts: { verify: 0, pending: 1, fuse: 1, skipped: 0 }, latestRun: { id: 'r1' }, approval: true },
  })
  const rows = await (await fetchPath(MERGE_ROUTES.rows + '?queue=pending')).json() as { data: { items: unknown[] } }
  expect(rows.data.items).toHaveLength(1)
  const body = await (await fetchPath(MERGE_ROUTES.body + '?id=mr_a&side=a')).json() as { data: { content: string; markdown: boolean; html: string } }
  expect(body.data).toMatchObject({ content: '# alpha', markdown: true })
  expect(body.data.html).toContain('<h1>alpha</h1>')
  expect((await (await fetchPath(MERGE_ROUTES.body + '?id=missing&side=a')).json() as { ok: boolean }).ok).toBe(false)
  expect((await (await fetchPath(MERGE_ROUTES.history)).json() as { data: { items: unknown[] } }).data.items).toHaveLength(0)
})

it('rejects non-GET and reports an absent service', async () => {
  expect((await fetchPath(MERGE_ROUTES.view, 'POST')).status).toBe(405)
  expect((await fetchPath(MERGE_ROUTES.rows + '?queue=nope')).status).toBe(400)
  const absent = makeMergeRoutes({ getSource: () => undefined }, audit)
  const response = await (absent.find(item => item.path === MERGE_ROUTES.view) as { fetch: (request: Request) => Promise<Response> }).fetch(new Request('http://local' + MERGE_ROUTES.view))
  expect(response.status).toBe(503)
})
