// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { loadMergeState, readMergeReport, runScanCommand, type MergeRegistryPort } from '../src/index.ts'

it('wraps scan in the registry/report shell', async () => {
  const home = await tempRoot('dsh-merge-scan-command-')
  const io = nodeEvolutionIo()
  const calls: string[] = []
  const registry: MergeRegistryPort = {
    async begin() { calls.push('begin'); return { id: 'run-1', signal: new AbortController().signal, startedAt: 100 } },
    async stage(id, stage) { calls.push('stage:' + stage) },
    async settle(id, outcome) { calls.push('settle:' + outcome.state) },
  }
  const result = await runScanCommand({
    io, home, registry, approval: false, platformWrite: true, now: () => 200,
    ports: {
      async screening() { return [{ a: 'a', b: 'b' }] },
      async round1() { return { kind: 'keep' } },
      async round2() { return { kind: 'failed' } },
    },
  })
  expect(result.ok).toBe(true)
  expect(calls).toEqual(['begin', 'stage:screening', 'stage:decide', 'settle:succeeded'])
  expect((await readMergeReport(io, home, 'run-1')).kind).toBe('present')
  expect((await loadMergeState(io, home)).state.rows.map(row => row.state)).toEqual(['skipped'])
})
