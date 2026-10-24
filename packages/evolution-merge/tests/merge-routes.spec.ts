// @tier pre-tag
import { expect, it } from 'vitest'
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { MERGE_ROUTES, makeMergeRoutes, type MergeRow, type MergeRouteSource } from '../src/index.ts'

const audit = { channel: 'connection.fetch' as const, principal: 'owner' as const, deploymentAllowsRemote: true }
const row = (a: string, b: string, state: MergeRow['state']): MergeRow => ({
  id: 'mr_' + a, pairKey: a + '\u0000' + b, a, b, state,
  queue: state === 'pending' ? 'pending' : state === 'skipped' ? 'skipped' : state === 'fuse' || state === 'approved' ? 'fuse' : 'verify', createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z',
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

it('serves wire envelopes for view/rows/body/history', async () => {
  const view = await (await fetchPath(MERGE_ROUTES.view)).json() as { wireVersion: number; counts: unknown; active?: { id: string } }
  expect(view).toMatchObject({ wireVersion: 1, counts: { active: { verify: 0, pending: 1, fuse: 1, skipped: 0 }, expired: 0 }, active: { id: 'r1' } })
  const rows = await (await fetchPath(MERGE_ROUTES.rows + '?queue=pending')).json() as { wireVersion: number; rows: { id: string }[] }
  expect(rows.wireVersion).toBe(1)
  expect(rows.rows.map(item => item.id)).toEqual(['mr_a'])
  const body = await (await fetchPath(MERGE_ROUTES.body + '?id=mr_a&side=a')).json() as { wireVersion: number; text: string; markdown: boolean; totalBytes: number }
  expect(body).toMatchObject({ wireVersion: 1, text: '# alpha', markdown: true, totalBytes: 7 })
  expect((await (await fetchPath(MERGE_ROUTES.body + '?id=missing&side=a')).json() as { code: string }).code).toBe('merge-body-missing')
  expect((await (await fetchPath(MERGE_ROUTES.history)).json() as { wireVersion: number; items: unknown[] }).items).toHaveLength(0)
})

it('rejects bad queries and reports E-325 for an absent service', async () => {
  expect((await fetchPath(MERGE_ROUTES.view, 'POST')).status).toBe(405)
  const bad = await fetchPath(MERGE_ROUTES.rows + '?queue=nope')
  expect(bad.status).toBe(400)
  expect((await bad.json() as { code: string }).code).toBe('merge-bad-query')
  const absent = makeMergeRoutes({ getSource: () => undefined }, audit)
  const response = await (absent.find(item => item.path === MERGE_ROUTES.view) as { fetch: (request: Request) => Promise<Response> }).fetch(new Request('http://local' + MERGE_ROUTES.view))
  expect(response.status).toBe(404)
  expect((await response.json() as { code: string }).code).toBe('E-325')
})
