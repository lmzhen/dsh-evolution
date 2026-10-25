// @tier pre-tag
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { readMergeSnapshot } from '../../src/domain/merge-snapshot.ts'
import { makeMergeRoutes, MERGE_ROUTES, type MergeRouteSource } from '../../src/merge-routes.ts'
import { buildQueuePage } from '../../src/surface/merge-view.ts'
import { makeV4Home, v3Row } from '../support/schema4-home.ts'

function routes(source: MergeRouteSource) {
  return makeMergeRoutes({ getSource: () => source }, {} as never)
}
function find(source: MergeRouteSource, path: string) {
  const entry = routes(source).find(item => item.path === path)
  if (entry === undefined) throw new Error('route missing')
  return entry
}
async function sourceFor(home: string, io: ReturnType<typeof nodeEvolutionIo>): Promise<MergeRouteSource> {
  return {
    async snapshot() { return await readMergeSnapshot({ io, home, runs: [], approval: false }) },
    async bodyRef() { return 'body text' },
    commands() { return [] },
  }
}

it('serves the four panel GETs and body semantics', async () => {
  const { home, io } = await makeV4Home([v3Row()])
  const source = await sourceFor(home, io)
  const view = await find(source, MERGE_ROUTES.view).fetch(new Request('http://local' + MERGE_ROUTES.view))
  expect(view.status).toBe(200)
  const page = await find(source, MERGE_ROUTES.rows).fetch(new Request('http://local' + MERGE_ROUTES.rows + '?queue=verify'))
  expect(page.status).toBe(200)
  const history = await find(source, MERGE_ROUTES.history).fetch(new Request('http://local' + MERGE_ROUTES.history))
  expect(history.status).toBe(200)
  const body = await find(source, MERGE_ROUTES.body).fetch(new Request('http://local' + MERGE_ROUTES.body + '?id=r1&side=a'))
  expect(body.status).toBe(200)
  expect((await body.json() as { text: string }).text).toBe('body text')
  for (const query of ['?id=r1&name=a', '?id=missing', '?name=missing']) {
    const r = await find(source, MERGE_ROUTES.body).fetch(new Request('http://local' + MERGE_ROUTES.body + query))
    expect([400, 404]).toContain(r.status)
  }
})

it('returns 503 for blocked schema3', async () => {
  const home = await tempRoot('dsh-rg1b3-route-blocked-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(join(home, 'merge', 'merge-state.json'), JSON.stringify({ schemaVersion: 3, rows: [] }))
  const source = await sourceFor(home, io)
  const r = await find(source, MERGE_ROUTES.view).fetch(new Request('http://local' + MERGE_ROUTES.view))
  expect(r.status).toBe(503)
  expect(await r.json()).toMatchObject({ code: 'merge-state-blocked' })
})

it('rejects a stale queue cursor with 400', async () => {
  const { home, io } = await makeV4Home([v3Row({ id: 'r1' }), v3Row({ id: 'r2' })])
  const source = await sourceFor(home, io)
  const first = await source.snapshot!()
  const page = buildQueuePage(first, 'verify', false, undefined, 1)
  expect(page.nextCursor).toBeDefined()
  const raw = JSON.parse(await readFile(join(home, 'merge', 'merge-state.json'), 'utf8')) as { rows: { updatedAt: string }[] }
  raw.rows[0]!.updatedAt = 'changed'
  await writeFile(join(home, 'merge', 'merge-state.json'), JSON.stringify(raw))
  const r = await find(source, MERGE_ROUTES.rows).fetch(new Request('http://local' + MERGE_ROUTES.rows + '?queue=verify&limit=1&cursor=' + encodeURIComponent(page.nextCursor!)))
  expect(r.status).toBe(400)
})

it('400s duplicate body names and returns 200 empty body for empty content', async () => {
  const { home, io } = await makeV4Home([v3Row({ id: 'r1', a: 'same', b: 'b1' }), v3Row({ id: 'r2', a: 'same', b: 'b2' })])
  const source: MergeRouteSource = { async snapshot() { return await readMergeSnapshot({ io, home, runs: [], approval: false }) }, async bodyRef() { return null }, commands() { return [] } }
  const dup = await find(source, MERGE_ROUTES.body).fetch(new Request('http://local' + MERGE_ROUTES.body + '?name=same'))
  expect(dup.status).toBe(400)
  const empty = await find(source, MERGE_ROUTES.body).fetch(new Request('http://local' + MERGE_ROUTES.body + '?id=r1&side=a'))
  expect(empty.status).toBe(200)
  expect((await empty.json() as { text: string }).text).toBe('')
})
