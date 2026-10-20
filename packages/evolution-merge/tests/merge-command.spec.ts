// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createMergeCommand, createReadOnlyMergeService } from '../src/index.ts'

it('dispatches read-only verbs and rejects missing ones', async () => {
  const home = await tempRoot('dsh-merge-command-')
  const io = nodeEvolutionIo()
  const command = createMergeCommand(createReadOnlyMergeService(io, home))
  expect(command.name).toBe('merge')
  const status = await command.handler({ rawInput: '/merge status' })
  expect(status).toMatchObject({ kind: 'success' })
  expect(status.text).toContain('merge: pending 0')
  const scan = await command.handler({ rawInput: 'scan' })
  expect(scan.kind).toBe('error')
  expect((await command.handler({ rawInput: 'pair only-one' })).kind).toBe('error')
  expect((await command.handler({ rawInput: '' })).text).toContain('merge scan')
})
