#!/usr/bin/env node
/**
 * Generate the family's client scale into both browser halves (G2).
 *
 * `client-tokens.json` is the one source for every size, radius, hairline, measure, tone and cap the
 * two client packages draw. A browser half CANNOT import evolution-core: `build-client.mjs` keeps every
 * `@deepseek-ai/*` specifier external, so an import would become a runtime bare require with no row in
 * the platform's module table. The scale is therefore GENERATED into each package, and
 * `verify-client-tokens.mjs` fails the gate when a copy drifts from the source.
 *
 * The generated file is byte-identical in every package: it may not name its own package, and the
 * package's stylesheet decides which element the custom properties are declared on (`tokenVars`).
 *
 * Usage: node gen-client-tokens.mjs <evolution-root> [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { clientHalfDirs } from './lib-family-packages.mjs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The browser halves that receive the generated scale come from the ONE rule in
 * lib-family-packages.mjs (`clientHalfDirs`, v46 S2.3) — a hand-copied list here silently skipped a
 * new browser half. */

/** Where the generated copy lives inside one package. */
const RELATIVE = 'src/client/tokens.ts'

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
 * Render the generated module both packages carry.
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
    ' * Both browser halves of the family carry this file with identical bytes, because the scale is one',
    ' * fact: `verify-client-tokens.mjs` (a gate step) fails when either copy drifts from the source. The',
    ' * scale cannot be shared at runtime - a browser half may not import evolution-core, since every',
    ' * `@deepseek-ai/*` specifier stays external in the client build and the platform module table has no',
    ' * row for it - so the values are generated into each package instead.',
    ' *',
    ' * Usage: put `tokenVars(...)` for your root class in the package stylesheet, then read',
    ' * `var(--evo-group-name)` in its rules.',
    ' * Regenerate with: node packages/scripts/gen-client-tokens.mjs packages',
    ' * @module @deepseek-ai/dsh-evolution-client-scale',
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
  const discovered = clientHalfDirs(root)
  if (discovered.unreadable.length > 0) {
    console.error('gen-client-tokens: unreadable manifest(s) under ' + root + ' — a browser half may be hidden: ' + discovered.unreadable.join('; '))
    return 1
  }
  const targets = discovered.dirs
  if (targets.length === 0) {
    console.error('gen-client-tokens: no package under ' + root + ' declares dsh.client — the browser halves cannot be discovered (an empty target list would write nothing and report success)')
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
