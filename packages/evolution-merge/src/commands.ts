/**
 * Pure command-surface parser for the /evolution merge prefix. The command layer only
 * validates shape; run/state effects are injected by the host shell.
 */
export type MergeCliCommand =
  | { readonly verb: 'scan' }
  | { readonly verb: 'pair'; readonly a: string; readonly b: string }
  | { readonly verb: 'status'; readonly id?: string }
  | { readonly verb: 'report'; readonly id?: string }
  | { readonly verb: 'cancel'; readonly id?: string }
  | { readonly verb: 'runs' }
  | { readonly verb: 'pending' }
  | { readonly verb: 'approve'; readonly id: string }
  | { readonly verb: 'reject'; readonly id: string }
  | { readonly verb: 'resume'; readonly id?: string; readonly clear?: string }
  | { readonly verb: 'skipped'; readonly restore?: string }
  | { readonly verb: 'undo'; readonly target: string; readonly run: string }

export type ParseMergeCommandResult =
  | { readonly ok: true; readonly command: MergeCliCommand; readonly help?: boolean }
  | { readonly ok: false; readonly code: 'usage'; readonly message: string }

const USAGE = 'usage: merge scan | pair <a> <b> | status [id] | report [id] | cancel [id] | runs | pending | approve <id> | reject <id> | resume [id] [--clear <id>] | skipped [--restore <id>] | undo <target> --run <id>'

function flags(args: readonly string[], allowed: readonly string[]): { values: Map<string, string>; error?: string } {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (!token.startsWith('--')) continue
    const name = token.slice(2)
    if (!allowed.includes(name)) return { values, error: 'unknown flag: --' + name }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) return { values, error: 'missing value for --' + name }
    values.set(name, value)
    index += 1
  }
  return { values }
}

function positional(args: readonly string[]): string[] {
  return args.filter((token, index) => !token.startsWith('--') && !(index > 0 && (args[index - 1] as string).startsWith('--')))
}

export function parseMergeCommand(argv: readonly string[]): ParseMergeCommandResult {
  const [verb, ...rest] = argv
  if (verb === undefined || verb === 'help' || verb === '--help' || verb === '-h') return { ok: true, command: { verb: 'scan' }, help: true }
  const pos = positional(rest)
  switch (verb) {
    case 'scan': return pos.length === 0 ? { ok: true, command: { verb: 'scan' } } : { ok: false, code: 'usage', message: USAGE }
    case 'pair': return pos.length === 2 ? { ok: true, command: { verb: 'pair', a: pos[0] as string, b: pos[1] as string } } : { ok: false, code: 'usage', message: USAGE }
    case 'status': return pos.length <= 1 ? { ok: true, command: { verb: 'status', ...(pos[0] === undefined ? {} : { id: pos[0] }) } } : { ok: false, code: 'usage', message: USAGE }
    case 'report': return pos.length <= 1 ? { ok: true, command: { verb: 'report', ...(pos[0] === undefined ? {} : { id: pos[0] }) } } : { ok: false, code: 'usage', message: USAGE }
    case 'cancel': return pos.length <= 1 ? { ok: true, command: { verb: 'cancel', ...(pos[0] === undefined ? {} : { id: pos[0] }) } } : { ok: false, code: 'usage', message: USAGE }
    case 'runs': return pos.length === 0 ? { ok: true, command: { verb: 'runs' } } : { ok: false, code: 'usage', message: USAGE }
    case 'pending': return pos.length === 0 ? { ok: true, command: { verb: 'pending' } } : { ok: false, code: 'usage', message: USAGE }
    case 'approve': return pos.length === 1 ? { ok: true, command: { verb: 'approve', id: pos[0] as string } } : { ok: false, code: 'usage', message: USAGE }
    case 'reject': return pos.length === 1 ? { ok: true, command: { verb: 'reject', id: pos[0] as string } } : { ok: false, code: 'usage', message: USAGE }
    case 'resume': {
      const parsed = flags(rest, ['clear'])
      if (parsed.error !== undefined) return { ok: false, code: 'usage', message: parsed.error }
      const clear = parsed.values.get('clear')
      if (pos.length > 1) return { ok: false, code: 'usage', message: USAGE }
      return { ok: true, command: { verb: 'resume', ...(pos[0] === undefined ? {} : { id: pos[0] }), ...(clear === undefined ? {} : { clear }) } }
    }
    case 'skipped': {
      const parsed = flags(rest, ['restore'])
      if (parsed.error !== undefined) return { ok: false, code: 'usage', message: parsed.error }
      if (pos.length > 0) return { ok: false, code: 'usage', message: USAGE }
      const restore = parsed.values.get('restore')
      return { ok: true, command: { verb: 'skipped', ...(restore === undefined ? {} : { restore }) } }
    }
    case 'undo': {
      const parsed = flags(rest, ['run'])
      if (parsed.error !== undefined) return { ok: false, code: 'usage', message: parsed.error }
      const target = pos[0]
      const run = parsed.values.get('run')
      if (target === undefined || run === undefined || pos.length !== 1) return { ok: false, code: 'usage', message: USAGE }
      return { ok: true, command: { verb: 'undo', target, run } }
    }
    default: return { ok: false, code: 'usage', message: 'unknown merge command: ' + verb + '\n' + USAGE }
  }
}

export function mergeUsage(): string {
  return USAGE
}
