// @tier pre-tag
import { expect, it } from 'vitest'
import type { RunRecord, RunRegistry } from '@deepseek-ai/dsh-evolution-core'
import { mergeRunIdsToSupersede, supersedeMergeRuns } from '../src/index.ts'

const run = (id: string, kind: RunRecord['kind'], supersededAt?: number): RunRecord => ({ id, kind, state: 'succeeded', startedAt: 1, ...(supersededAt === undefined ? {} : { supersededAt }) })

it('only marks non-superseded merge runs', async () => {
  const records = [run('a', 'merge'), run('b', 'merge', 2), run('c', 'maintenance')]
  expect(mergeRunIdsToSupersede(records)).toEqual(['a'])
  let seen: readonly string[] = []
  const registry = { runs: () => records, supersede: async (ids: readonly string[]) => { seen = ids } } as unknown as RunRegistry
  expect(await supersedeMergeRuns(registry)).toBe(1)
  expect(seen).toEqual(['a'])
})
