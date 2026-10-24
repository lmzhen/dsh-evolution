/** Frozen merge CommandSurface v1: 19 commands, JSON-safe, no handlers. */
import type { ActionId, CommandActionRule, CommandSpec, CommandSurface } from './wire.ts'

const flag = (name: string, kind: 'boolean' | 'value' = 'boolean', valueName?: string): CommandSpec['flags'][number] => ({ name, kind, ...(valueName === undefined ? {} : { valueName }) })
const pos = (name: string, kind: 'skill' | 'target' | 'runId' | 'id' | 'json' | 'text', required = true): CommandSpec['positional'][number] => ({ name, kind, required })
const action = (id: ActionId, command: string, confirm = false): CommandActionRule => ({ id, command, confirm })

function spec(id: string, words: string[], flags: CommandSpec['flags'], positional: CommandSpec['positional'], readOnly: boolean, needsRun: boolean, rowActions: CommandSpec['rowActions'], fallback: string): CommandSpec {
  return { id, words, flags, positional, summary: id, readOnly, needsRun, defaults: {}, rowActions, fallback }
}

export const MERGE_COMMANDS: readonly CommandSpec[] = [
  spec('merge.scan', ['scan'], [], [], false, true, [], '/evolution merge scan'),
  spec('merge.pair', ['pair'], [], [pos('a', 'skill'), pos('b', 'skill')], false, true, [action('pair', '/evolution merge pair', true)], '/evolution merge pair <a> <b>'),
  spec('merge.pair.force', ['pair'], [flag('force')], [pos('a', 'skill'), pos('b', 'skill')], false, true, [], '/evolution merge pair --force <a> <b>'),
  spec('merge.status', ['status'], [], [pos('id', 'id', false)], true, false, [action('status', '/evolution merge status')], '/evolution merge status'),
  spec('merge.report', ['report'], [], [pos('id', 'id', false)], true, false, [action('report', '/evolution merge report')], '/evolution merge report'),
  spec('merge.cancel', ['cancel'], [], [pos('id', 'id', false)], false, false, [action('cancel', '/evolution merge cancel')], '/evolution merge cancel <id>'),
  spec('merge.runs', ['runs'], [], [], true, false, [], '/evolution merge runs'),
  spec('merge.pending', ['pending'], [], [], true, false, [], '/evolution merge pending'),
  spec('merge.pending.expired', ['pending'], [flag('expired')], [], true, false, [], '/evolution merge pending --expired'),
  spec('merge.approve', ['approve'], [], [pos('id', 'id')], false, true, [action('approve', '/evolution merge approve <id>')], '/evolution merge approve <id>'),
  spec('merge.reject', ['reject'], [], [pos('id', 'id')], false, false, [action('reject', '/evolution merge reject <id>', true)], '/evolution merge reject <id>'),
  spec('merge.skipped', ['skipped'], [], [], true, false, [], '/evolution merge skipped'),
  spec('merge.skipped.restore', ['skipped'], [flag('restore', 'value', 'id')], [], false, false, [action('restore', '/evolution merge skipped --restore <id>', true)], '/evolution merge skipped --restore <id>'),
  spec('merge.candidates', ['candidates'], [], [], true, false, [], '/evolution merge candidates'),
  spec('merge.candidates.retry', ['candidates'], [flag('retry', 'value', 'id')], [], false, true, [action('retry-candidates', '/evolution merge candidates --retry <id>')], '/evolution merge candidates --retry <id>'),
  spec('merge.resume', ['resume'], [], [pos('id', 'id', false)], true, false, [], '/evolution merge resume'),
  spec('merge.resume.retry', ['resume'], [flag('retry', 'value', 'id')], [], false, true, [action('retry-resume', '/evolution merge resume --retry <id>')], '/evolution merge resume --retry <id>'),
  spec('merge.discard', ['discard'], [], [pos('id', 'id')], false, false, [action('discard', '/evolution merge discard <id>', true)], '/evolution merge discard <id>'),
  spec('merge.undo', ['undo'], [flag('run', 'value', 'id')], [pos('target', 'target')], false, false, [], '/evolution merge undo <target> --run <id>'),
]

export const MERGE_COMMAND_SURFACE: CommandSurface = {
  wireVersion: 1,
  prefix: '/evolution merge',
  commands: MERGE_COMMANDS,
  fallback: [
    { id: 'scan', command: '/evolution merge scan' },
    { id: 'pair', command: '/evolution merge pair <a> <b>' },
    { id: 'candidates', command: '/evolution merge candidates' },
    { id: 'pending', command: '/evolution merge pending' },
    { id: 'skipped', command: '/evolution merge skipped' },
    { id: 'resume', command: '/evolution merge resume' },
    { id: 'status', command: '/evolution merge status' },
    { id: 'report', command: '/evolution merge report' },
    { id: 'doctor', command: '/evolution merge doctor' },
  ],
}
