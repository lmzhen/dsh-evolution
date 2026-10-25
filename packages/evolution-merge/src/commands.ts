/** Merge command adapter over the family command catalog. No parser/usage table here. */
import { parseCommand } from '@deepseek-ai/dsh-evolution-commands'
import { MERGE_COMMAND_DEFS } from './command-defs.ts'

export type MergeCliCommand =
  | { readonly verb: 'scan' }
  | { readonly verb: 'pair'; readonly a: string; readonly b: string; readonly force?: true }
  | { readonly verb: 'status'; readonly id?: string }
  | { readonly verb: 'report'; readonly id?: string }
  | { readonly verb: 'cancel'; readonly id?: string }
  | { readonly verb: 'runs' }
  | { readonly verb: 'doctor' }
  | { readonly verb: 'reconcile' }
  | { readonly verb: 'pending'; readonly expired?: true }
  | { readonly verb: 'candidates'; readonly retry?: true; readonly id?: string }
  | { readonly verb: 'approve'; readonly id: string }
  | { readonly verb: 'reject'; readonly id: string }
  | { readonly verb: 'resume'; readonly id?: string; readonly clear?: string; readonly retry?: true }
  | { readonly verb: 'skipped'; readonly restore?: string }
  | { readonly verb: 'discard'; readonly id: string }
  | { readonly verb: 'undo'; readonly target: string; readonly run: string }
export type ParseMergeCommandResult = { readonly ok: true; readonly command: MergeCliCommand; readonly help?: boolean } | { readonly ok: false; readonly code: 'usage'; readonly message: string }

function text(value: string | true | undefined): string | undefined { return typeof value === 'string' ? value : undefined }
export function parseMergeCommand(argv: readonly string[]): ParseMergeCommandResult {
  const parsed = parseCommand(MERGE_COMMAND_DEFS, argv)
  if (!parsed.ok) return parsed
  if (parsed.help === true) return { ok: true, command: { verb: 'scan' }, help: true }
  const v = parsed.values
  switch (parsed.id) {
    case 'merge.scan': return { ok: true, command: { verb: 'scan' } }
    case 'merge.doctor': return { ok: true, command: { verb: 'doctor' } }
    case 'merge.reconcile': return { ok: true, command: { verb: 'reconcile' } }
    case 'merge.pair': return { ok: true, command: { verb: 'pair', a: text(v.a) ?? '', b: text(v.b) ?? '' } }
    case 'merge.pair.force': return { ok: true, command: { verb: 'pair', a: text(v.a) ?? '', b: text(v.b) ?? '', force: true } }
    case 'merge.status': return { ok: true, command: { verb: 'status', ...(text(v.id) === undefined ? {} : { id: text(v.id) as string }) } }
    case 'merge.report': return { ok: true, command: { verb: 'report', ...(text(v.id) === undefined ? {} : { id: text(v.id) as string }) } }
    case 'merge.cancel': return { ok: true, command: { verb: 'cancel', ...(text(v.id) === undefined ? {} : { id: text(v.id) as string }) } }
    case 'merge.runs': return { ok: true, command: { verb: 'runs' } }
    case 'merge.pending': return { ok: true, command: { verb: 'pending' } }
    case 'merge.pending.expired': return { ok: true, command: { verb: 'pending', expired: true } }
    case 'merge.approve': return { ok: true, command: { verb: 'approve', id: text(v.id) ?? '' } }
    case 'merge.reject': return { ok: true, command: { verb: 'reject', id: text(v.id) ?? '' } }
    case 'merge.skipped': return { ok: true, command: { verb: 'skipped' } }
    case 'merge.skipped.restore': return { ok: true, command: { verb: 'skipped', restore: text(v.restore) ?? '' } }
    case 'merge.candidates': return { ok: true, command: { verb: 'candidates' } }
    case 'merge.candidates.retry': return { ok: true, command: { verb: 'candidates', retry: true, ...(text(v.id) === undefined ? {} : { id: text(v.id) as string }) } }
    case 'merge.resume': return { ok: true, command: { verb: 'resume', ...(text(v.id) === undefined ? {} : { id: text(v.id) as string }), ...(text(v.clear) === undefined ? {} : { clear: text(v.clear) as string }) } }
    case 'merge.resume.retry': return { ok: true, command: { verb: 'resume', retry: true, ...(text(v.id) === undefined ? {} : { id: text(v.id) as string }), ...(text(v.clear) === undefined ? {} : { clear: text(v.clear) as string }) } }
    case 'merge.discard': return { ok: true, command: { verb: 'discard', id: text(v.id) ?? '' } }
    case 'merge.undo': return { ok: true, command: { verb: 'undo', target: text(v.target) ?? '', run: text(v.run) ?? '' } }
    default: return { ok: false, code: 'usage', message: 'unknown merge command: ' + parsed.id }
  }
}
export function mergeUsage(): string {
  return 'usage: ' + MERGE_COMMAND_DEFS.filter(def => def.id !== 'merge.doctor' && def.usage !== false).map(def => def.fallback).join(' | ') + '\ndefaults: mergeApproval=false, mergeSkippedTtlDays=0, mergeRunTimeoutMinutes=0, mergePairTimeoutMinutes=15, mergeModelsRoot=""'
}
