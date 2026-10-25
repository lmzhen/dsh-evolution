// @tier pre-tag
import { expect, it } from 'vitest'
import { runMergeCommand, createMergeCommand } from '../../src/merge-command.ts'
import { MERGE_COMMAND_SURFACE } from '../../src/command-surface.ts'

it('dispatches every rowAction command through the handler service', async () => {
  const seen: string[] = []
  const service = { async execute(command: { verb: string }) { seen.push(command.verb); return { ok: true, text: command.verb } } }
  for (const command of MERGE_COMMAND_SURFACE.commands) for (const action of command.rowActions) {
    const raw = action.command.replace('/evolution merge ', '').replaceAll('{id}', 'mr_1').replaceAll('{a}', 'a-skill').replaceAll('{b}', 'b-skill').replaceAll('{runId}', 'run-1')
    const result = await runMergeCommand(service, raw)
    expect(result.ok, raw).toBe(true)
  }
  for (const verb of ['pair', 'approve', 'reject', 'resume', 'skipped', 'discard', 'status', 'report', 'cancel', 'candidates']) expect(seen).toContain(verb)
})

it('registers /merge only before 0.32 and marks 0.31 deprecated', () => {
  const service = { async execute() { return { ok: true, text: '' } } }
  expect(createMergeCommand(service, '0.30.18')).not.toBeNull()
  expect(createMergeCommand(service, '0.31.0')).toMatchObject({ description: expect.stringContaining('已弃用') })
  expect(createMergeCommand(service, '0.32.0')).toBeNull()
})
