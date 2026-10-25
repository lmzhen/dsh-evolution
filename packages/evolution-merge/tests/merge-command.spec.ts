// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { makeV4Home } from './support/schema4-home.ts'
import { createMergeCommand, createReadOnlyMergeService, runMergeCommand } from '../src/index.ts'

it('dispatches read-only verbs and rejects missing ones', async () => {
  const { home, io } = await makeV4Home([])
  const command = createMergeCommand(createReadOnlyMergeService(io, home))
  expect(command.name).toBe('merge')
  const status = await command.handler({ rawInput: '/merge status' })
  expect(status).toMatchObject({ kind: 'success' })
  expect(status.text).toContain('merge: verify 0, pending 0')
  const scan = await command.handler({ rawInput: 'scan' })
  expect(scan.kind).toBe('error')
  expect((await command.handler({ rawInput: 'pair only-one' })).kind).toBe('error')
  expect((await command.handler({ rawInput: '' })).text).toContain('merge scan')
})

it('accepts the /evolution merge prefix through the shared runner', async () => {
  const { home, io } = await makeV4Home([])
  const result = await runMergeCommand(createReadOnlyMergeService(io, home), '/evolution merge status')
  expect(result.ok).toBe(true)
  expect(result.text).toContain('merge: verify 0, pending 0')
})

it('renders a runtime failure as three lines with next', async () => {
  const command = createMergeCommand({ async execute() { throw new Error('boom') } })
  const result = await command.handler({ rawInput: 'scan' })
  expect(result.kind).toBe('error')
  expect(result.text.split('\n')).toHaveLength(3)
  expect(result.text).toContain('next:')
})

it('passes the invoking agent through to the service', async () => {
  let seen: unknown
  const command = createMergeCommand({
    async execute(_command, context) { seen = context; return { ok: true, text: 'ok' } },
  })
  await command.handler({ rawInput: 'scan', agent: { session: 's1' } })
  expect(seen).toEqual({ parent: { session: 's1' } })
})
