/** Family command catalog: one source for parser/help/surface/fallback. */
export interface CommandFlagDef { readonly name: string; readonly kind: 'boolean' | 'value'; readonly valueName?: string; readonly repeatable?: boolean; readonly values?: readonly string[]; readonly default?: string; readonly required?: boolean }
export interface CommandPositionalDef { readonly name: string; readonly kind: 'skill' | 'target' | 'runId' | 'id' | 'json' | 'text'; readonly required: boolean; readonly variadic?: boolean }
export interface RowActionDef { readonly id: string; readonly command: string; readonly confirm?: boolean; readonly enabledWhen?: string }
export interface CommandDef { readonly id: string; readonly words: readonly string[]; readonly summaryKey: string; readonly helpKey: string; readonly flags: readonly CommandFlagDef[]; readonly positional: readonly CommandPositionalDef[]; readonly readOnly: boolean; readonly needsRun: boolean; readonly aliases?: readonly string[]; readonly rowActions?: readonly RowActionDef[]; readonly fallback: string; readonly deprecatedAt?: '0.31' | '0.32'; readonly surface?: boolean; readonly usage?: boolean }
export interface CommandSurfaceCommand { readonly id: string; readonly words: readonly string[]; readonly flags: readonly { readonly name: string; readonly kind: 'boolean' | 'value'; readonly valueName?: string; readonly repeatable?: boolean; readonly values?: readonly string[] }[]; readonly positional: readonly { readonly name: string; readonly kind: 'skill' | 'target' | 'runId' | 'id' | 'json' | 'text'; readonly required: boolean; readonly variadic?: boolean }[]; readonly readOnly: boolean; readonly needsRun: boolean; readonly defaults: Readonly<Record<string, string>>; readonly rowActions: readonly { readonly id: string; readonly command: string; readonly confirm: boolean }[]; readonly fallback: string }
export interface CommandSurfaceView { readonly wireVersion: 1; readonly prefix: string; readonly commands: readonly CommandSurfaceCommand[]; readonly fallback: readonly { readonly id: string; readonly command: string }[] }
export type ParsedCommand = { readonly ok: true; readonly id: string; readonly values: Readonly<Record<string, string | true>>; readonly help?: true } | { readonly ok: false; readonly code: 'usage'; readonly message: string }
export function buildSurface(defs: readonly CommandDef[], prefix: string): CommandSurfaceView {
  const defaults = (def: CommandDef): Readonly<Record<string, string>> => Object.fromEntries(def.flags.flatMap(flag => {
    if (flag.default !== undefined) return [[flag.name, flag.default] as const]
    return flag.kind === 'boolean' ? [[flag.name, 'false'] as const] : []
  }))
  return { wireVersion: 1, prefix, commands: defs.filter(def => def.surface !== false).map(def => ({ id: def.id, words: def.words, flags: def.flags, positional: def.positional, readOnly: def.readOnly, needsRun: def.needsRun, defaults: defaults(def), rowActions: (def.rowActions ?? []).map(action => ({ id: action.id, command: action.command, confirm: action.confirm === true })), fallback: def.fallback })), fallback: defs.filter(def => def.surface !== false && (def.rowActions === undefined || def.rowActions.length === 0)).map(def => ({ id: def.id, command: def.fallback })) }
}
export function parseCommand(defs: readonly CommandDef[], argv: readonly string[]): ParsedCommand {
  const [verb, ...rest] = argv
  if (verb === undefined || verb === 'help' || verb === '--help' || verb === '-h') return { ok: true, id: 'help', values: {}, help: true }
  const candidates = defs.filter(item => item.words.includes(verb))
  const def = candidates.find(item => rest.filter(token => token.startsWith('--')).every(token => item.flags.some(flag => flag.name === token.slice(2)))) ?? candidates[0]
  if (def === undefined) return { ok: false, code: 'usage', message: 'unknown command: ' + verb }
  const values: Record<string, string | true> = {}
  const positional: string[] = []
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string
    if (!token.startsWith('--')) { positional.push(token); continue }
    const name = token.slice(2)
    const flag = def.flags.find(item => item.name === name)
    if (flag === undefined) return { ok: false, code: 'usage', message: 'unknown flag: --' + name }
    if (flag.kind === 'boolean') values[name] = true
    else {
      const value = rest[index + 1]
      if (value === undefined || value.startsWith('--')) return { ok: false, code: 'usage', message: 'missing value for --' + name }
      values[name] = value; index += 1
    }
  }
  for (const flag of def.flags) if (flag.required === true && values[flag.name] === undefined) return { ok: false, code: 'usage', message: 'missing required flag: --' + flag.name }
  const required = def.positional.filter(item => item.required).length
  if (positional.length < required || positional.length > def.positional.length) return { ok: false, code: 'usage', message: 'usage: ' + def.fallback }
  def.positional.forEach((item, index) => { const value = positional[index]; if (value !== undefined) values[item.name] = value })
  return { ok: true, id: def.id, values }
}
export function aliasRegistration(version: string, def: CommandDef): 'registered' | 'deprecated' | 'removed' {
  if (def.deprecatedAt === undefined) return 'registered'
  const [major, minor] = version.split('.').map(Number)
  const [depMajor = 0, depMinor = 0] = def.deprecatedAt.split('.').map(Number)
  if ((major ?? 0) > depMajor || ((major ?? 0) === depMajor && (minor ?? 0) >= depMinor + 1)) return 'removed'
  if ((major ?? 0) === depMajor && (minor ?? 0) === depMinor) return 'deprecated'
  return 'registered'
}
