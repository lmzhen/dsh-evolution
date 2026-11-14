/**
 * Subcommand registry — the SINGLE SOURCE for the /evolution command surface.
 *
 * 0.3.55 (WD1): the input-declaration hint, the bare `/evolution` help output
 * and the README command table all render FROM this table; a hand-written
 * copy anywhere is drift waiting to happen (v10 R-13 proved it once).
 * PLAN S5.3 (2026-09-16): "the README command table" means the FAMILY README
 * (`packages/README.md` — the T-WD2 anchor). Package-level READMEs cite that
 * home instead of restating the table (doc-facts rule N19).
 * Keep `usage` in the exact shape a user can type after `/evolution`.
 */
import { HOST_COMMANDS } from './generated/host-commands.ts'
import type { HostLocale } from '@deepseek-ai/dsh-evolution-core'
import { HOST_COMMAND_DEFS } from './host-command-defs.ts'

export interface CommandEntry {
  /** The subcommand as typed after `/evolution`. Variants use `|` (curator run|pause). */
  usage: string
  /** C7: true when the subcommand only READS (no skill/param write). Stored: not derivable. */
  readonly: boolean
  /** Authored flag declarations; `usage` documents them but is not the parser's source. */
  flags?: readonly (readonly [name: string, kind: 'boolean' | 'value'])[]
}

/** The flags the TABLE declares for one subcommand (name → `--flag`). */
export function flagsOf(name: string): string[] {
  const entry = COMMAND_ENTRIES.find(candidate => entryName(candidate) === name)
  return entry?.flags?.map(([flag]) => flag) ?? []
}

/**
 * C7 shape, DERIVED: the entry IDENTITY key, and it is HIERARCHICAL (E-08).
 *
 * The key used to be the first token alone, and `flagsOf` finds an entry with `.find(...)` - the FIRST
 * match - so `maintain handoff` / `maintain cancel` and `skill restore` / `skill history` / `skill undo` /
 * `skill pin` all derived the SAME key as their parent and every flag lookup silently saw the parent entry
 * only (nine collisions). A bare parent (`maintain [--timeout]`) keeps its one-token key, so parent lookups
 * still resolve: the one call site that named an entry by a name the key no longer produced was the preset
 * dispatch branch, and it now asks for the entry own key (`preset install`).
 */
export function entryName(entry: CommandEntry): string {
  // `noUncheckedIndexedAccess` makes both index reads `string | undefined`; destructuring with a
  // default says the same thing without two casts (the CI build line proved it).
  const [head = '', second = ''] = entry.usage.split(' ')
  const name = head.split('|')[0] ?? ''
  const secondIsName = /^[a-z][a-z-]*$/.test(second) && !second.startsWith('--')
  return secondIsName ? name + ' ' + second : name
}

export const COMMAND_ENTRIES: CommandEntry[] = HOST_COMMAND_DEFS.map(def => ({
  usage: def.usageLine,
  readonly: def.readOnly,
  ...(def.flags.length === 0 ? {} : { flags: def.flags.map(flag => ['--' + flag.name, flag.kind] as const) }),
}))

/** The one summary source: the generated command i18n catalog. */
export function summaryOf(entry: CommandEntry, locale: HostLocale = 'zh'): string {
  const text = (HOST_COMMANDS as Record<string, Partial<Record<HostLocale, string>>>)['summary.' + entryName(entry)]?.[locale]
  if (text === undefined) throw new Error('registry: no generated summary for ' + entryName(entry) + ' (' + locale + ')')
  return text
}

/** The input-declaration hint (single line, ` | `-separated). */
export function renderHint(): string {
  return COMMAND_ENTRIES.map(entry => entry.usage).join(' | ')
}

/** The bare `/evolution` help body (one line per subcommand). */
export function renderHelpText(locale: HostLocale = 'zh'): string {
  // First line first: the platform's command row collapses to the output's FIRST LINE, and a list
  // whose first line is a subcommand reads like that subcommand was what ran.
  const header = HOST_COMMANDS['help.subcommands'][locale] ?? HOST_COMMANDS['help.subcommands'].en
  return [header.replace('{count}', String(COMMAND_ENTRIES.length)), '', ...COMMAND_ENTRIES
    .map(entry => `  ${entry.usage.padEnd(44)} ${summaryOf(entry, locale)}`)]
    .join('\n')
}

/** Markdown command table fragment for README surfaces (T-WD2 pins it).
 * `|` inside a usage (curator run|pause|…) is escaped for the table cell. */
export function renderCommandTable(): string {
  const lines = COMMAND_ENTRIES.map(entry =>
    `| \`/evolution ${entry.usage.replace(/\|/g, '\\|')}\` | ${summaryOf(entry, 'zh')} |`,
  )
  return lines.join('\n')
}

/** Union of every entry's authored value flags. */
export const VALUE_FLAGS: readonly string[] = (() => {
  const names: string[] = []
  for (const entry of COMMAND_ENTRIES) for (const [name, kind] of entry.flags ?? []) {
    const bare = name.replace(/^--/, '')
    if (kind === 'value' && !names.includes(bare)) names.push(bare)
  }
  return names
})()
