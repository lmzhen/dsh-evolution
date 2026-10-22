/**
 * Pure command-surface parser for the /evolution merge prefix. The command layer only
 * validates shape; run/state effects are injected by the host shell.
 */
export type MergeCliCommand =
  | { readonly verb: 'scan' }
  | { readonly verb: 'pair'; readonly a: string; readonly b: string; readonly force?: true }
  | { readonly verb: 'status'; readonly id?: string }
  | { readonly verb: 'report'; readonly id?: string }
  | { readonly verb: 'cancel'; readonly id?: string }
  | { readonly verb: 'runs' }
  | { readonly verb: 'doctor' }
  | { readonly verb: 'pending'; readonly expired?: true }
  | { readonly verb: 'candidates'; readonly retry?: true }
  | { readonly verb: 'approve'; readonly id: string }
  | { readonly verb: 'reject'; readonly id: string }
  | { readonly verb: 'resume'; readonly id?: string; readonly clear?: string; readonly retry?: true }
  | { readonly verb: 'skipped'; readonly restore?: string }
  | { readonly verb: 'discard'; readonly id: string }
  | { readonly verb: 'undo'; readonly target: string; readonly run: string }

export type ParseMergeCommandResult =
  | { readonly ok: true; readonly command: MergeCliCommand; readonly help?: boolean }
  | { readonly ok: false; readonly code: 'usage'; readonly message: string }

const USAGE = 'usage: /evolution merge scan | pair [--force] <a> <b> | status [id] | report [id] | cancel [id] | runs | doctor | pending [--expired] | candidates [--retry] | approve <id> | reject <id> | resume [id] [--retry] [--clear <id>] | skipped [--restore <id>] | discard <id> | undo <target> --run <id>'

function flags(args: readonly string[], allowed: readonly string[]): { values: Map<string, string>; error?: string } {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (!token.startsWith('--') || token === '--force' || token === '--expired' || token === '--retry') continue
    const name = token.slice(2)
    if (!allowed.includes(name)) return { values, error: 'unknown flag: --' + name }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) return { values, error: 'missing value for --' + name }
    values.set(name, value)
    index += 1
  }
  return { values }
}

function switches(args: readonly string[]): Set<string> {
  return new Set(args.filter(token => token === '--force' || token === '--expired' || token === '--retry').map(token => token.slice(2)))
}

function positional(args: readonly string[]): string[] {
  const filtered = args.filter(token => token !== '--force' && token !== '--expired' && token !== '--retry')
  return filtered.filter((token, index) => !token.startsWith('--') && !(index > 0 && (filtered[index - 1] as string).startsWith('--')))
}

export function parseMergeCommand(argv: readonly string[]): ParseMergeCommandResult {
  const [verb, ...rest] = argv
  if (verb === undefined || verb === 'help' || verb === '--help' || verb === '-h') return { ok: true, command: { verb: 'scan' }, help: true }
  const pos = positional(rest)
  const marked = switches(rest)
  switch (verb) {
    case 'scan': return pos.length === 0 ? { ok: true, command: { verb: 'scan' } } : { ok: false, code: 'usage', message: USAGE }
    case 'pair': return pos.length === 2 ? { ok: true, command: { verb: 'pair', a: pos[0] as string, b: pos[1] as string, ...(marked.has('force') ? { force: true } : {}) } } : { ok: false, code: 'usage', message: USAGE }
    case 'status': return pos.length <= 1 ? { ok: true, command: { verb: 'status', ...(pos[0] === undefined ? {} : { id: pos[0] }) } } : { ok: false, code: 'usage', message: USAGE }
    case 'report': return pos.length <= 1 ? { ok: true, command: { verb: 'report', ...(pos[0] === undefined ? {} : { id: pos[0] }) } } : { ok: false, code: 'usage', message: USAGE }
    case 'cancel': return pos.length <= 1 ? { ok: true, command: { verb: 'cancel', ...(pos[0] === undefined ? {} : { id: pos[0] }) } } : { ok: false, code: 'usage', message: USAGE }
    case 'runs': return pos.length === 0 ? { ok: true, command: { verb: 'runs' } } : { ok: false, code: 'usage', message: USAGE }
    case 'doctor': return pos.length === 0 ? { ok: true, command: { verb: 'doctor' } } : { ok: false, code: 'usage', message: USAGE }
    case 'pending': return pos.length === 0 ? { ok: true, command: { verb: 'pending', ...(marked.has('expired') ? { expired: true } : {}) } } : { ok: false, code: 'usage', message: USAGE }
    case 'candidates': return pos.length === 0 ? { ok: true, command: { verb: 'candidates', ...(marked.has('retry') ? { retry: true } : {}) } } : { ok: false, code: 'usage', message: USAGE }
    case 'approve': return pos.length === 1 ? { ok: true, command: { verb: 'approve', id: pos[0] as string } } : { ok: false, code: 'usage', message: USAGE }
    case 'reject': return pos.length === 1 ? { ok: true, command: { verb: 'reject', id: pos[0] as string } } : { ok: false, code: 'usage', message: USAGE }
    case 'resume': {
      const parsed = flags(rest, ['clear'])
      if (parsed.error !== undefined) return { ok: false, code: 'usage', message: parsed.error }
      const clear = parsed.values.get('clear')
      if (pos.length > 1) return { ok: false, code: 'usage', message: USAGE }
      return { ok: true, command: { verb: 'resume', ...(pos[0] === undefined ? {} : { id: pos[0] }), ...(clear === undefined ? {} : { clear }), ...(marked.has('retry') ? { retry: true } : {}) } }
    }
    case 'skipped': {
      const parsed = flags(rest, ['restore'])
      if (parsed.error !== undefined) return { ok: false, code: 'usage', message: parsed.error }
      if (pos.length > 0) return { ok: false, code: 'usage', message: USAGE }
      const restore = parsed.values.get('restore')
      return { ok: true, command: { verb: 'skipped', ...(restore === undefined ? {} : { restore }) } }
    }
    case 'discard': return pos.length === 1 ? { ok: true, command: { verb: 'discard', id: pos[0] as string } } : { ok: false, code: 'usage', message: USAGE }
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
