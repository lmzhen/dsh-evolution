/**
 * F-4/G7.4 (C7): the ONE parser for the /evolution command surface.
 *
 * The surface used to answer each subcommand with its own regex (`^params(?: --group ([a-z-]+))?(?: --json)?$`
 * and nine siblings), so `params --json --group review` and `params --group=review` were refused as
 * "not a subcommand", while a sibling regex accepted `=` — and a mistyped group name degraded into the
 * generic error instead of the one that lists the known groups.
 *
 * This parser is order- and `=`-tolerant, matches the subcommand name case-insensitively, keeps a flag
 * VALUE's case intact (the domain layer is the one that validates it), and answers a SYNTAX failure when a
 * declared value flag is left without its value (F-3: `policy set a.b --expect 3` must not read
 * `--expect 3` as the value).
 *
 * @module @deepseek-ai/dsh-evolution-commands/parse
 */

/** The flags whose declared form takes a value (`--group <name>`, `--expect <revision>`, …). */
/**
 * Exported so the command-table gate can tie it to the table's usage lines (P2: two declarations of
 * "which flags take a value" would otherwise be free to drift apart).
 */
export const VALUE_FLAGS: readonly string[] = [
  // No `profile`: the word only appears in the preset row's PROSE, no command declares a value-taking
  // `--profile`, and nothing reads `flags.get('profile')`. Kept honest by the measurement, not by
  // leaving a name standing (independent review P2-4).
  'group', 'expect', 'base', 'to', 'timeout', 'plan',
]

/** One parsed command line. */
export interface ParsedCommand {
  /** The subcommand name, lower-cased (the table stores it lower-case too). */
  readonly name: string
  /** Declared flags: a value when the flag takes one, `true` when it is bare. */
  readonly flags: ReadonlyMap<string, string | true>
  /** Everything that was neither the name nor a flag, in order. */
  readonly positionals: readonly string[]
}

/** A SYNTAX failure — the caller answers it as a usage error, never as a domain error. */
export interface ParseFailure {
  /** Which syntax rule was broken. */
  readonly kind: 'unknown-subcommand' | 'unknown-flag' | 'missing-value'
  /** The subcommand name the caller saw (empty when the line was empty). */
  readonly name: string
  /** The flag involved, for the two flag failures. */
  readonly flag?: string
}

/**
 * Narrow a parse result: true when it is the syntax failure rather than a command.
 * @param result - what {@link parseSubcommand} answered.
 * @returns whether the line was refused.
 */
export function isParseFailure(result: ParsedCommand | ParseFailure): result is ParseFailure {
  return (result as ParseFailure).kind !== undefined
}


/**
 * Split a command line into tokens: whitespace separates, and a double-quoted run is ONE token with its
 * quotes removed (the `restructure <name> "<heading>" <to_file>` form needs that; the old regexes each
 * carried their own quoting rule).
 * @param input - the text after `/evolution`.
 * @returns the tokens, in order.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  for (const char of input.trim()) {
    if (char === String.fromCharCode(34)) { quoted = !quoted; continue }
    if (!quoted && /\s/.test(char)) {
      if (current !== '') { tokens.push(current); current = '' }
      continue
    }
    current += char
  }
  if (current !== '') tokens.push(current)
  return tokens
}


/**
 * Read one SUB-FORM line: `maintain status`, `maintain report`, … — the shape the regexes used to own.
 *
 * A sub-form matches only when: the line parses, the name matches, the first positional is the sub-form,
 * and every flag the line carries is DECLARED by the table (an undeclared flag keeps the old
 * "unknown arguments" answer instead of silently becoming a bare flag).
 * @param input - the text after `/evolution`.
 * @param name - the subcommand name the table declares (e.g. `maintain`).
 * @param sub - the sub-form word (e.g. `status`).
 * @param declaredFlags - the flags the table declares for `name` (`flagsOf(name)`).
 * @returns the parsed command, or null when this line is not that sub-form.
 */
export function subcommandOf(
  input: string,
  name: string,
  sub: string,
  declaredFlags: readonly string[],
): ParsedCommand | null {
  const parsed = parseSubcommand(input)
  if (isParseFailure(parsed) || parsed.name !== name) return null
  if (parsed.positionals[0] !== sub) return null
  for (const flag of parsed.flags.keys()) {
    if (!declaredFlags.includes('--' + flag)) return null
  }
  return parsed
}

/**
 * Parse one command line into its name, flags and positionals.
 * @param input - the text after `/evolution`.
 * @returns the parsed command, or the syntax failure that refused it.
 */
export function parseSubcommand(input: string): ParsedCommand | ParseFailure {
  const [first, ...rest] = tokenize(input)
  // Destructured, not indexed: `noUncheckedIndexedAccess` is on for this tree, so `tokens[0]` is
  // `string | undefined` and every read would need a guard (the CI build line proved it).
  if (first === undefined) return { kind: 'unknown-subcommand', name: '' }
  const name = first.toLowerCase()
  const flags = new Map<string, string | true>()
  const positionals: string[] = []
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (token === undefined) continue
    if (!token.startsWith('--')) { positionals.push(token); continue }
    // Flags are stored WITHOUT their `--` (callers read `flags.get('group')`).
    const equals = token.indexOf('=')
    const flag = (equals < 0 ? token : token.slice(0, equals)).slice(2)
    if (equals >= 0) {
      flags.set(flag, token.slice(equals + 1))
      continue
    }
    if (!VALUE_FLAGS.includes(flag)) { flags.set(flag, true); continue }
    const next = rest[index + 1]
    if (next === undefined || next.startsWith('--')) return { kind: 'missing-value', name, flag }
    flags.set(flag, next)
    index += 1
  }
  return { name, flags, positionals }
}
