#!/usr/bin/env node
/**
 * Generate the family's client scale into the client kit (G2/G1).
 *
 * `client-tokens.json` is the one source for every size, radius, hairline, measure, tone and cap the
 * client packages draw. The scale is GENERATED once into the client kit, and every browser half
 * imports it; a half must not carry its own copy. `verify-client-tokens.mjs` fails the gate when the
 * kit copy drifts from the source.
 *
 * Usage: node gen-client-tokens.mjs <evolution-root> [--check]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The browser halves that receive the generated scale come from the ONE rule in
 * lib-family-packages.mjs (`clientHalfDirs`, v46 S2.3) — a hand-copied list here silently skipped a
 * new browser half. */

/** Where the generated copy lives inside one package. */
const TARGET = 'evolution-client-kit'
const RELATIVE = 'src/tokens.ts'

/**
 * One single-quoted TypeScript string literal. Token values carry no quote, semicolon or brace —
 * `verify-client-tokens.mjs` rejects those shapes — so this cannot need escaping.
 * @param value - the literal text.
 * @returns the literal.
 */
function single(value) {
  return ["'", String(value), "'"].join('')
}

/**
 * Read the token source.
 * @returns the groups in declared order, and the flat custom-property list.
 */
export function readTokens() {
  const source = JSON.parse(readFileSync(join(HERE, 'client-tokens.json'), 'utf8'))
  const flat = []
  for (const [group, entries] of Object.entries(source.groups)) {
    for (const [name, entry] of Object.entries(entries)) {
      flat.push(['--evo-' + group + '-' + name, entry.value])
    }
  }
  return { groups: source.groups, flat }
}

/**
 * Render the generated module the client kit carries.
 * @returns the whole file text, ending in one newline.
 */
export function renderModule() {
  const { flat } = readTokens()
  const rows = flat.map(pair => '  ' + single(pair[0]) + ': ' + single(pair[1]) + ',')
  const declarations = flat.map(pair => pair[0] + ':' + pair[1]).join(';')
  return [
    '/**',
    ' * The family client scale - GENERATED from packages/scripts/client-tokens.json. Do not edit.',
    ' *',
    ' * The shared client kit carries this file, because the scale is one fact: `verify-client-tokens.mjs`',
    ' * (a gate step) fails when the kit copy drifts from the source. The kit bundles into each browser',
    ' * half at build time, so no runtime module-table row is needed.',
    ' *',
    ' * Usage: put `tokenVars(...)` for your root class in the package stylesheet, then read',
    ' * `var(--evo-group-name)` in its rules.',
    ' * Regenerate with: node packages/scripts/gen-client-tokens.mjs packages',
    ' * @module dsh-evolution-client-scale',
    ' */',
    '',
    '/** Every custom property of the scale, in the source order. */',
    'export const TOKENS: Readonly<Record<string, string>> = {',
    ...rows,
    '}',
    '',
    '/** The declarations, without a selector. */',
    'export const TOKEN_CSS: string = ' + single(declarations),
    '',
    '/**',
    ' * The scale, declared on one element so it never leaks into the host shell.',
    ' * @param scope - the selector the custom properties are declared on.',
    ' * @returns the declaration block to put in the stylesheet.',
    ' */',
    'export function tokenVars(scope: string): string {',
    "  return scope + '{' + TOKEN_CSS + '}'",
    '}',
    '',
  ].join('\n')
}

/**
 * Write both copies, or check them against the source.
 * @param args - the CLI arguments.
 * @returns the process exit code.
 */
function main(args) {
  const rootArg = args.find(arg => !arg.startsWith('--'))
  const root = resolve(rootArg ?? 'packages')
  const check = args.includes('--check')
  const unknown = args.filter(arg => arg.startsWith('--') && arg !== '--check')
  if (unknown.length > 0) {
    console.error('gen-client-tokens: unknown flag ' + unknown.join(', ') + ' - usage: node gen-client-tokens.mjs <evolution-root> [--check]')
    return 2
  }
  const targets = [TARGET]
  if (!existsSync(join(root, TARGET, 'package.json'))) {
    console.error('gen-client-tokens: missing client kit at ' + join(root, TARGET) + ' — there is no target for the generated scale')
    return 1
  }
  const wanted = renderModule()
  let drift = 0
  for (const pkg of targets) {
    const file = join(root, pkg, RELATIVE)
    if (!check) {
      writeFileSync(file, wanted)
      continue
    }
    // A discovered browser half with NO generated copy is the shape the hand-copied target list
    // used to hide: report it as drift instead of crashing on the missing read (v46 S2.3).
    let current = null
    try { current = readFileSync(file, 'utf8') } catch { current = null }
    if (current !== wanted) {
      console.error('gen-client-tokens: DRIFT ' + file + ' - regenerate with node packages/scripts/gen-client-tokens.mjs ' + (rootArg ?? 'packages'))
      drift++
    }
  }
  if (!check) {
    console.log('gen-client-tokens: wrote ' + targets.length + ' copies of client-tokens.json')
    return 0
  }
  console.log(drift === 0
    ? 'gen-client-tokens: ok (' + targets.length + ' copies identical to client-tokens.json)'
    : 'gen-client-tokens: ' + drift + ' copy/copies drifted')
  return drift === 0 ? 0 : 1
}

// Importing this file (verify-client-tokens.mjs) must write nothing: only the process entry runs.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
