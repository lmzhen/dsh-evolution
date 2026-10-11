/**
 * verify-write-inventory — the write table audited against the code that resolves it (G2).
 *
 * Three fail-loud steps, each with a drill recorded in 26-G2 design archive:
 *   1. SHAPE      every path's LEADING <root> symbol is declared in the table's own legend, and no
 *                 legend entry is a zombie (unused). Symbols later in a path are filename
 *                 placeholders (<name>, <review|curator|pending>), not roots.
 *   2. LEGEND<=SRC each legend entry's segments must appear in the body of the resolver it names
 *                 (a quoted literal, or an identifier declared as that literal in the same file).
 *                 This is the anti-drift half: change evolutionHome() and the legend stops matching.
 *   3. LANDING    with --home <dir>, every path resolves to an absolute path that stays INSIDE that
 *                 home (a path that escapes the plane is the failure this step exists for).
 *
 * Usage: node verify-write-inventory.mjs <packages-root> [--strict] [--home <dir>]
 *   --strict also requires a home: without one the landing check cannot run and the run is NOT ARMED.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const argv = process.argv.slice(2)
// A flag's VALUE is not a positional: `--home <dir> <root>` used to pick the home as the root and then
// report "not armed" on a tree it never looked at (review P2-11).
const VALUE_FLAGS = new Set(['--home', '--profile'])
const positionals = argv.filter((arg, index) => !arg.startsWith('--') && !VALUE_FLAGS.has(argv[index - 1] ?? ''))
const root = positionals[0] ?? 'packages/evolution'
const strict = argv.includes('--strict') || process.env.DSH_EVOLUTION_ARCH_STRICT === '1'
const homeIndex = argv.indexOf('--home')
const homeArg = homeIndex >= 0 ? argv[homeIndex + 1] : (process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : undefined)
const INVENTORY = 'evolution-core/persisted-write-inventory.json'
const problems = []

if (!existsSync(root)) {
  console.error('usage: verify-write-inventory.mjs <packages/evolution-root> [--strict] [--home <dir>] (root not found: ' + root + ')')
  process.exit(2)
}

const inventoryPath = join(root, INVENTORY)
if (!existsSync(inventoryPath)) {
  console.log('verify-write-inventory: not armed: no ' + INVENTORY + ' under ' + root)
  process.exit(0)
}

let table = null
try {
  table = JSON.parse(readFileSync(inventoryPath, 'utf8'))
} catch (error) {
  problems.push(INVENTORY + ': unreadable (' + (error instanceof Error ? error.message : String(error)) + ')')
}
const symbols = table !== null && typeof table === 'object' && table.symbols !== null && typeof table.symbols === 'object' && !Array.isArray(table.symbols) ? table.symbols : null
const sites = table !== null && typeof table === 'object' && Array.isArray(table.sites) ? table.sites : null
if (symbols === null) problems.push(INVENTORY + ': no { symbols } legend — a path cannot be audited against a root')
if (sites === null) problems.push(INVENTORY + ': no { sites } array — the inventory vouches for nothing (a vacuum pass is not a pass)')

// --- step 1: shape -------------------------------------------------------------------------------
const usedRoots = new Set()
if (symbols !== null && sites !== null) {
  for (const site of sites) {
    const id = typeof site?.id === 'string' ? site.id : '<missing id>'
    const path = String(site?.path ?? '')
    const leading = /^<[^<>]+>/.exec(path)
    if (leading === null) problems.push(INVENTORY + ': ' + id + ' writes ' + path + ' without a leading <root> symbol')
    else if (!Object.hasOwn(symbols, leading[0])) problems.push(INVENTORY + ': ' + id + ' writes ' + path + ' but the legend declares no ' + leading[0] + ' root')
    else usedRoots.add(leading[0])
  }
  for (const symbol of Object.keys(symbols)) {
    // A zombie is an entry no site roots at AND no other entry extends: the DSH home itself is
    // legitimately only a base.
    const extended = Object.entries(symbols).some(([other, entry]) => other !== symbol && entry?.basedOn === symbol)
    if (!usedRoots.has(symbol) && !extended) problems.push(INVENTORY + ': legend entry ' + symbol + ' is a zombie (no site uses it and no entry extends it)')
  }
}

// --- step 2: legend <= source --------------------------------------------------------------------
const RESOLVER_FILES = {
  evolutionRoot: 'evolution-core/src/state-store.ts',
  evolutionHome: 'evolution-core/src/state-store.ts',
  skillsRoot: 'evolution-core/src/skill-store.ts',
  memoryRoot: 'evolution-core/src/memory-store.ts',
  historyRoot: 'evolution-core/src/skill-history.ts',
}

/** The text of one exported function, from its declaration to the next top-level declaration. */
function functionBody(text, name) {
  const at = text.indexOf('export function ' + name + '(')
  if (at < 0) return null
  const rest = text.slice(at)
  const end = rest.indexOf('\n}', 1)
  return end < 0 ? rest : rest.slice(0, end)
}

if (symbols !== null) {
  for (const [symbol, entry] of Object.entries(symbols)) {
    const resolver = typeof entry?.resolver === 'string' ? entry.resolver : ''
    const segments = Array.isArray(entry?.segments) ? entry.segments : []
    if (resolver === 'caller') {
      if (segments.length > 0) problems.push(INVENTORY + ': ' + symbol + ' is caller-supplied but declares segments')
      continue
    }
    const file = RESOLVER_FILES[resolver]
    if (file === undefined) {
      problems.push(INVENTORY + ': ' + symbol + ' names resolver ' + resolver + ', which this gate does not know (add it to RESOLVER_FILES)')
      continue
    }
    const filePath = join(root, file)
    if (!existsSync(filePath)) {
      problems.push(INVENTORY + ': ' + symbol + ' names resolver ' + resolver + ' in ' + file + ', which is missing under ' + root)
      continue
    }
    const text = readFileSync(filePath, 'utf8')
    const body = functionBody(text, resolver)
    if (body === null) {
      problems.push(INVENTORY + ': ' + file + ' declares no export function ' + resolver + '() — the legend names a resolver the source does not have')
      continue
    }
    for (const segment of segments) {
      const quoted = "'" + segment + "'"
      if (body.includes(quoted)) continue
      // A segment may ride a named constant (historyRoot uses HISTORY_DIR): accept a single
      // identifier whose declaration in the same file is exactly that literal.
      // Any identifier in the body that the SAME file declares as exactly this literal rides the
      // constant (historyRoot uses HISTORY_DIR).
      const identifiers = [...body.matchAll(/[A-Za-z_$][\w$]*/g)].map((match) => match[0])
      const ridesConstant = identifiers.some((name) => new RegExp('const ' + name + ' = ' + quoted).test(text))
      if (!ridesConstant) {
        problems.push(INVENTORY + ': ' + symbol + ' declares segment ' + JSON.stringify(segment) + ', but ' + resolver + '() in ' + file + ' does not use it (legend and source drifted apart)')
      }
    }
  }
}

// --- step 3: landing -----------------------------------------------------------------------------
// Review P1-3 (0.22.0): without a home this step cannot run, and the old code then printed a plain OK —
// a gate that silently skips its own landing check reads as armed when it is not. --strict refuses.
const hasHome = homeArg !== undefined && homeArg.trim() !== ''
if (!hasHome && strict) {
  console.error('verify-write-inventory [strict]: NOT ARMED — no --home/--profile and DSH_HOME is empty, so the landing check did not run')
  process.exit(1)
}
if (!hasHome) console.warn('verify-write-inventory: NOT ARMED — no home given (pass --home <dir> or set DSH_HOME); the landing check was skipped')
let resolvedCount = 0
let callerSupplied = 0
if (symbols !== null && sites !== null && hasHome) {
  const home = resolve(homeArg)
  const rootOf = (symbol, depth = 0) => {
    const entry = symbols[symbol]
    if (entry === undefined || depth > 4) return null
    const base = typeof entry.basedOn === 'string' ? rootOf(entry.basedOn, depth + 1) : home
    if (base === null) return null
    const segments = Array.isArray(entry.segments) ? entry.segments : []
    return segments.reduce((acc, segment) => join(acc, String(segment)), base)
  }
  for (const site of sites) {
    const id = typeof site?.id === 'string' ? site.id : '<missing id>'
    const path = String(site?.path ?? '')
    const leading = /^<[^<>]+>/.exec(path)
    if (leading === null) continue
    const entry = symbols[leading[0]]
    if (entry !== undefined && entry.resolver === 'caller') { callerSupplied += 1; continue }
    const base = rootOf(leading[0])
    if (base === null) { problems.push(INVENTORY + ': ' + id + ' cannot resolve ' + leading[0] + ' (unknown basedOn chain)'); continue }
    const tail = path.slice(leading[0].length).replace(/^[\\/]+/, '').replace(/<[^<>]*>/g, 'placeholder').replace(/\*\*/g, 'x').replace(/\*/g, 'x')
    const absolute = resolve(base, tail)
    resolvedCount += 1
    if (absolute !== home && !absolute.startsWith(home + sep)) {
      problems.push(INVENTORY + ': ' + id + ' resolves to ' + absolute + ', which is OUTSIDE the home ' + home + ' (a plane-escaping path)')
    }
  }
}

if (problems.length > 0) {
  const summary = problems.length + ' write-inventory problem(s)'
  if (strict) {
    console.error('verify-write-inventory [strict]: ' + summary + ':')
    console.error(problems.join('\n'))
    process.exit(1)
  }
  console.warn('verify-write-inventory [warn]: ' + summary + ':')
  console.warn(problems.join('\n'))
  process.exit(0)
}
const legendCount = symbols === null ? 0 : Object.keys(symbols).length
console.log('verify-write-inventory: OK — ' + (sites === null ? 0 : sites.length) + ' site(s), ' + legendCount + ' symbol(s)' + (resolvedCount > 0 ? ', ' + resolvedCount + ' path(s) checked against ' + resolve(String(homeArg)) + (callerSupplied > 0 ? ' (' + callerSupplied + ' caller-supplied skipped)' : '') : ''))
