/**
 * Subcommand registry — the SINGLE SOURCE for the /evolution command surface.
 *
 * 0.3.55 (WD1): the input-declaration hint, the bare `/evolution` help output
 * and the README command table all render FROM this table; a hand-written
 * copy anywhere is drift waiting to happen (v10 R-13 proved it once).
 * Keep `usage` in the exact shape a user can type after `/evolution`.
 */
export interface CommandEntry {
  /** The subcommand as typed after `/evolution`. Variants use `|` (curator run|pause). */
  usage: string
  /** One-line purpose rendered in the help output. */
  summary: string
}

export const COMMAND_ENTRIES: CommandEntry[] = [
  { usage: 'pending [--detail]', summary: 'list staged evolution writes (--detail shows staged args)' },
  { usage: 'approve <id>', summary: 'replay an approved staged write through its runner' },
  { usage: 'reject <id>', summary: 'drop a staged write without running it' },
  { usage: 'doctor [--json]', summary: 'read-only self-check: install form, conflicts, env, services (--json feeds scripts)' },
  { usage: 'curator run|pause|resume|status|report|scope', summary: 'run one curation pass, control or inspect automatic curation' },
  { usage: 'mutations', summary: 'list skill-mutation audit records' },
  { usage: 'restore', summary: 'restore skills from the latest snapshot' },
  { usage: 'consolidate <target> <sources...> [--plan <runId>]', summary: 'merge source skills into a target umbrella skill' },
  { usage: 'skill restore <name>', summary: 'restore one archived skill by name' },
  { usage: 'skills health', summary: 'structure-health verdicts for the skill library' },
  { usage: 'skills refresh', summary: 'drop the catalog caches and re-read the tree' },
  { usage: 'learn [request]', summary: 'send a learning request to this session' },
  { usage: 'maintain [--timeout=<ms> | --facts]', summary: 'run a maintenance scan (--facts: 0-token preview)' },
  { usage: 'preset install', summary: 'generate the Evolution agent preset into the user root' },
  { usage: 'restructure <name> "<heading>" <to_file> [--plan <runId>]', summary: 'move a body section into a references/ file' },
  { usage: 'replay', summary: 'compare prompt-bundle replay for this session' },
]

/** The input-declaration hint (single line, ` | `-separated). */
export function renderHint(): string {
  return COMMAND_ENTRIES.map(entry => entry.usage).join(' | ')
}

/** The bare `/evolution` help body (one line per subcommand). */
export function renderHelpText(): string {
  return COMMAND_ENTRIES
    .map(entry => `  ${entry.usage.padEnd(44)} ${entry.summary}`)
    .join('\n')
}

/** Markdown command table fragment for README surfaces (T-WD2 pins it).
 * `|` inside a usage (curator run|pause|…) is escaped for the table cell. */
export function renderCommandTable(): string {
  const lines = COMMAND_ENTRIES.map(entry =>
    `| \`/evolution ${entry.usage.replace(/\|/g, '\\|')}\` | ${entry.summary} |`,
  )
  return lines.join('\n')
}
