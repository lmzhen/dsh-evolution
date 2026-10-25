/** Merge CommandDef data; parser/help/surface/fallback live in evolution-commands. */
import { readFileSync } from 'node:fs'
import type { CommandDef } from '@deepseek-ai/dsh-evolution-commands'
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }
export const MERGE_PACKAGE_VERSION = manifest.version ?? '0.30.18'
export const MERGE_ALIAS_DEF: CommandDef = { id: 'merge.alias', words: ['merge'], summaryKey: 'merge.alias', helpKey: 'merge.alias.help', flags: [], positional: [], readOnly: false, needsRun: false, fallback: '/merge', deprecatedAt: '0.31' }
const pos = (name: string, kind: 'skill' | 'target' | 'runId' | 'id' | 'json' | 'text', required = true): CommandDef['positional'][number] => ({ name, kind, required })
const flag = (name: string, kind: 'boolean' | 'value', valueName?: string, required = false): CommandDef['flags'][number] => ({ name, kind, ...(valueName === undefined ? {} : { valueName }), ...(required ? { required: true } : {}) })
const action = (id: string, command: string, confirm = false): NonNullable<CommandDef['rowActions']>[number] => ({ id, command, confirm })
const cmd = (id: string, words: readonly string[], flags: readonly CommandDef['flags'][number][], positional: readonly CommandDef['positional'][number][], readOnly: boolean, needsRun: boolean, rowActions: NonNullable<CommandDef['rowActions']>, fallback: string): CommandDef => ({ id, words, summaryKey: id, helpKey: id + '.help', flags, positional, readOnly, needsRun, rowActions, fallback })
export const MERGE_COMMAND_DEFS: readonly CommandDef[] = [
  ({ ...({ ...cmd('merge.doctor', ['doctor'], [], [], false, false, [], '/evolution merge doctor'), usage: false }), surface: false }),
  ({ ...cmd('merge.reconcile', ['reconcile'], [], [], false, false, [], '/evolution merge reconcile'), surface: false }),
  cmd('merge.scan', ['scan'], [], [], false, true, [], '/evolution merge scan'),
  cmd('merge.pair', ['pair'], [], [pos('a', 'skill'), pos('b', 'skill')], false, true, [action('pair', '/evolution merge pair {a} {b}', true)], '/evolution merge pair <a> <b>'),
  cmd('merge.pair.force', ['pair'], [flag('force', 'boolean')], [pos('a', 'skill'), pos('b', 'skill')], false, true, [action('pair', '/evolution merge pair {a} {b}', true)], '/evolution merge pair --force <a> <b>'),
  cmd('merge.status', ['status'], [], [pos('id', 'id', false)], true, false, [action('status', '/evolution merge status {runId}')], '/evolution merge status'),
  cmd('merge.report', ['report'], [], [pos('id', 'id', false)], true, false, [action('report', '/evolution merge report {runId}')], '/evolution merge report'),
  cmd('merge.cancel', ['cancel'], [], [pos('id', 'id', false)], false, false, [action('cancel', '/evolution merge cancel {runId}')], '/evolution merge cancel <id>'),
  cmd('merge.runs', ['runs'], [], [], true, false, [], '/evolution merge runs'),
  cmd('merge.pending', ['pending'], [], [], true, false, [], '/evolution merge pending'),
  cmd('merge.pending.expired', ['pending'], [flag('expired', 'boolean')], [], true, false, [], '/evolution merge pending --expired'),
  cmd('merge.approve', ['approve'], [], [pos('id', 'id')], false, true, [action('approve', '/evolution merge approve {id}')], '/evolution merge approve <id>'),
  cmd('merge.reject', ['reject'], [], [pos('id', 'id')], false, false, [action('reject', '/evolution merge reject {id}', true)], '/evolution merge reject <id>'),
  cmd('merge.skipped', ['skipped'], [], [], true, false, [], '/evolution merge skipped'),
  cmd('merge.skipped.restore', ['skipped'], [flag('restore', 'value', 'id')], [], false, false, [action('restore', '/evolution merge skipped --restore {id}', true)], '/evolution merge skipped --restore <id>'),
  cmd('merge.candidates', ['candidates'], [], [], true, false, [], '/evolution merge candidates'),
  cmd('merge.candidates.retry', ['candidates'], [flag('retry', 'boolean')], [pos('id', 'id', false)], false, true, [action('retry-candidates', '/evolution merge candidates --retry {id}')], '/evolution merge candidates --retry <id>'),
  cmd('merge.resume', ['resume'], [flag('clear', 'value', 'id')], [pos('id', 'id', false)], true, false, [action('retry-resume', '/evolution merge resume --retry {id}')], '/evolution merge resume'),
  cmd('merge.resume.retry', ['resume'], [flag('retry', 'boolean'), flag('clear', 'value', 'id')], [pos('id', 'id', false)], false, true, [action('retry-resume', '/evolution merge resume --retry {id}')], '/evolution merge resume --retry <id>'),
  cmd('merge.discard', ['discard'], [], [pos('id', 'id')], false, false, [action('discard', '/evolution merge discard {id}', true)], '/evolution merge discard <id>'),
  cmd('merge.undo', ['undo'], [flag('run', 'value', 'id', true)], [pos('target', 'target')], false, false, [], '/evolution merge undo <target> --run <id>'),
]
