// @tier pre-tag
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { readMergeSnapshot } from '../../src/domain/merge-snapshot.ts'
import { makeMergeRoutes, MERGE_ROUTES, type MergeRouteSource } from '../../src/merge-routes.ts'
import { writeCommitReceipt } from '../../src/commit-receipt.ts'
import { seedRow } from '../support/seed-row.ts'
import { pairKey, rowIdOf } from '../../src/contracts.ts'
import { parseMergeCommand } from '../../src/commands.ts'

const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }

it('previous-ui fixture accepts new server view/rows/body/history and copies a row action', async () => {
  const home = await tempRoot('dsh-rg4c-prev-ui-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const key = pairKey('a', 'b')
  const row = { id: rowIdOf(key), pairKey: key, a: 'a', b: 'b', state: 'pending' as const, queue: 'pending' as const, decision, runId: 'run-1', createdAt: 'c', updatedAt: 'u' }
  await seedRow(io, home, row)
  await writeCommitReceipt(io, home, { runId: 'run-0', unitId: 'u-0', target: 'a', create: false, sources: ['b'], archived: ['b'], at: 1 })
  const source: MergeRouteSource = {
    async snapshot() { return await readMergeSnapshot({ io, home, runs: [], approval: false, platformWrite: false }) },
    async bodyRef() { return '# a\n' },
    commands() { return [] },
  }
  const routes = makeMergeRoutes({ getSource: () => source }, {} as never)
  const get = async (path: string): Promise<Response> => await routes.find(item => item.path === path.split('?')[0])!.fetch(new Request('http://local' + path))
  const view = await (await get(MERGE_ROUTES.view)).json() as { wireVersion: 1; counts: { active: { pending: number } }; approval: { platformWrite?: boolean }; fallback: { command: string }[] }
  const rows = await (await get(MERGE_ROUTES.rows + '?queue=pending')).json() as { rows: { stage?: string; actions: { command: string }[] }[] }
  const body = await (await get(MERGE_ROUTES.body + '?id=' + encodeURIComponent(row.id) + '&side=a')).json() as { wireVersion: 1; text: string; markdown: boolean }
  const history = await (await get(MERGE_ROUTES.history)).json() as { items: { reasonCode?: string }[] }
  expect(view.wireVersion).toBe(1)
  expect(view.counts.active.pending).toBe(1)
  expect(view.approval.platformWrite).toBe(false)
  expect(rows.rows[0]?.actions.some(action => action.command.startsWith('/evolution merge approve '))).toBe(true)
  expect(body).toMatchObject({ wireVersion: 1, text: '# a\n', markdown: true })
  expect(history.items[0]?.reasonCode).toBe('merged')
  expect(history.items[0]?.generation).toBe(1)
  const copied = rows.rows[0]!.actions.find(action => action.command.includes(' approve '))!.command.replace('/evolution merge ', '')
  expect(parseMergeCommand(copied.split(' '))).toMatchObject({ ok: true })
})
