// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { writeCommitReceipt } from '../src/commit-receipt.ts'
import { runUndoOperation } from '../src/undo-operation.ts'

it('fails closed with undo-evidence-expired when the unit evidence aged out', async () => {
  const home = await tempRoot('dsh-merge-undo-evidence-')
  const io = nodeEvolutionIo()
  await writeCommitReceipt(io, home, { runId: 'run-1', unitId: 'u-gone', evidenceSha256: 'sha', target: 'a', create: false, sources: ['b'], archived: ['b'], pairKey: 'k', at: 1 })
  const result = await runUndoOperation({ io, home, runId: 'run-1', port: {} as never, now: () => 2 })
  expect(result).toMatchObject({ ok: false, code: 'undo-evidence-expired' })
})

it('keeps the legacy-receipt code when the receipt never had evidence', async () => {
  const home = await tempRoot('dsh-merge-undo-legacy-')
  const io = nodeEvolutionIo()
  await writeCommitReceipt(io, home, { runId: 'run-1', unitId: 'u-legacy', target: 'a', create: false, sources: ['b'], archived: ['b'], pairKey: 'k', at: 1 })
  const result = await runUndoOperation({ io, home, runId: 'run-1', port: {} as never, now: () => 2 })
  expect(result).toMatchObject({ ok: false, code: 'undo-unavailable-legacy-receipt' })
})
