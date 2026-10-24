// @tier pre-tag
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { readFacts } from '../../src/facts.ts'
import { MERGE_ROUTES, makeMergeRoutes, type MergeRouteSource } from '../../src/index.ts'
import { mergeStatePath } from '../../src/state.ts'

it('GET reads write zero bytes through state/run I/O', async () => {
  const home = await tempRoot('dsh-rg5-zero-')
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [] }))
  const io = nodeEvolutionIo()
  let writes = 0
  const guarded: EvolutionIoLike = { ...io, writeText: async (path, text) => { writes += 1; await io.writeText(path, text) }, remove: async path => { writes += 1; await io.remove(path) }, rename: async (from, to) => { writes += 1; await io.rename(from, to) } }
  await readFacts({ io: guarded, home, runs: [], approval: false, readAt: 1 })
  expect(writes).toBe(0)
})

it('four panel routes only call read methods on the source', async () => {
  let reads = 0
  const source: MergeRouteSource = {
    async rows() { reads += 1; return [] },
    async run() { reads += 1; return undefined },
    async runs() { reads += 1; return [] },
    async body() { reads += 1; return null },
    async history() { reads += 1; return [] },
    commands() { return [] },
    approval() { return false },
  }
  const routes = makeMergeRoutes({ getSource: () => source }, { channel: 'connection.fetch', principal: 'owner', deploymentAllowsRemote: true })
  for (const path of [MERGE_ROUTES.view, MERGE_ROUTES.rows + '?queue=verify', MERGE_ROUTES.body + '?id=x&side=a', MERGE_ROUTES.history]) {
    const route = routes.find(item => item.path === path.split('?')[0])!
    await route.fetch(new Request('http://local' + path))
  }
  expect(reads).toBeGreaterThan(0)
  expect(routes.every(route => route.methods?.every(method => method === 'GET'))).toBe(true)
})
