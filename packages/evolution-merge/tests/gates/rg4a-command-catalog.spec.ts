// @tier pre-tag
import { expect, it } from 'vitest'
import { aliasRegistration, parseCommand } from '@deepseek-ai/dsh-evolution-commands'
import { MERGE_COMMAND_DEFS } from '../../src/command-defs.ts'
import { MERGE_COMMAND_SURFACE } from '../../src/command-surface.ts'
import { parseMergeCommand } from '../../src/commands.ts'

it('has one catalog source for 19 surface commands plus doctor/reconcile parsers', () => {
  expect(MERGE_COMMAND_SURFACE.commands).toHaveLength(19)
  expect(MERGE_COMMAND_SURFACE.wireVersion).toBe(1)
  expect(parseMergeCommand(['doctor'])).toMatchObject({ ok: true, command: { verb: 'doctor' } })
  expect(parseMergeCommand(['candidates', '--retry', 'mr_1'])).toEqual({ ok: true, command: { verb: 'candidates', retry: true, id: 'mr_1' } })
  expect(parseCommand(MERGE_COMMAND_DEFS, ['doctor'])).toMatchObject({ ok: true, id: 'merge.doctor' })
})

it('round-trips every rowAction command through the same parser', () => {
  for (const command of MERGE_COMMAND_SURFACE.commands) {
    for (const action of command.rowActions) {
      const rendered = action.command
        .replaceAll('{id}', 'mr_1').replaceAll('{a}', 'a-skill').replaceAll('{b}', 'b-skill').replaceAll('{runId}', 'run-1')
      expect(parseMergeCommand(rendered.replace('/evolution merge ', '').split(' ')), rendered).toMatchObject({ ok: true })
    }
  }
})

it('registers /merge alias by plugin version', () => {
  const def = MERGE_COMMAND_DEFS[0]!
  expect(aliasRegistration('0.30.18', def)).toBe('registered')
  expect(aliasRegistration('0.31.0', { ...def, deprecatedAt: '0.31' })).toBe('deprecated')
  expect(aliasRegistration('0.32.0', { ...def, deprecatedAt: '0.31' })).toBe('removed')
})
