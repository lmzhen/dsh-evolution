import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { readRunMeta, writeRunMeta, type MergeRunMeta } from '../src/domain/run-coordinator.ts'

const base = (phase: MergeRunMeta['phase']): MergeRunMeta => ({
  version: 1, runId: 'run-1', phase, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})

it('preserves degraded and terminal phase across overlapping run-meta writes', async () => {
  const home = await tempRoot('dsh-run-meta-merge-')
  const io = nodeEvolutionIo()
  await writeRunMeta(io, home, base('running'))
  await writeRunMeta(io, home, { ...base('running'), degraded: true, stopReason: 'degraded' })
  await writeRunMeta(io, home, { ...base('settled'), stopReason: 'completed' })
  await writeRunMeta(io, home, { ...base('running'), degraded: true })
  const meta = await readRunMeta(io, home, 'run-1')
  expect(meta).toMatchObject({ phase: 'settled', degraded: true, stopReason: 'completed' })
})
