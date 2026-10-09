#!/usr/bin/env node
/**
 * Check the family's client scale: the source is well formed, and both copies match it (G2).
 *
 * A generated file that nobody compares is a copy, not a source. This is the gate step that makes
 * `client-tokens.json` the one home of the scale: it re-renders the module and compares bytes with the
 * copy inside each browser half, so editing a generated `tokens.ts` by hand - or forgetting to
 * regenerate after a source edit - fails the 23-step gate with the exact file named.
 *
 * The shape rules exist for the guard that follows it (N25/N27 in verify-arch-guards): a value here
 * must be a plain CSS token - no semicolon, brace, quote or newline - because the rendered file puts it
 * inside a single-quoted literal and inside a declaration block.
 *
 * Usage: node verify-client-tokens.mjs <evolution-root> [--strict]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readTokens, renderModule } from './gen-client-tokens.mjs'
import { clientHalfDirs } from './lib-family-packages.mjs'

/** The nine groups the scale is made of, in the order the source declares them. */
const GROUPS = ['type', 'space', 'radius', 'hairline', 'measure', 'leading', 'tone', 'focus', 'cap']

/** A custom property that belongs to this scale. */
const NAME = /^--evo-[a-z]+-[a-z0-9]+$/

/** Shapes a value may take: whitespace-separated lengths, `var(...)` and `calc(...)` are all allowed. */
const FORBIDDEN = /[;{}'"\n\\]/

/** A reference to the scale from a package's own sources. */
const REFERENCE = /var\((--evo-[a-z0-9-]+)\)/g

/**
 * Every `.ts` file of one browser half, except the generated copy itself (which declares the names).
 * @param pkgDir - the package directory.
 * @returns the file paths, in directory order.
 */
function clientSources(pkgDir) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = dir + '/' + entry.name
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts') && entry.name !== 'tokens.ts') out.push(full)
    }
  }
  walk(pkgDir + '/src/client')
  return out
}

const argv = process.argv.slice(2)
const rootArg = argv.find(arg => !arg.startsWith('--'))
const root = resolve(rootArg ?? 'packages')
const strict = argv.includes('--strict')
const unknown = argv.filter(arg => arg.startsWith('--') && arg !== '--strict')
if (unknown.length > 0) {
  console.error('verify-client-tokens: unknown flag ' + unknown.join(', ') + ' - usage: node verify-client-tokens.mjs <evolution-root> [--strict]')
  process.exit(2)
}

const problems = []
// v46 S2.3 (finding T7-08): the browser halves come from the ONE rule (manifest `dsh.client`),
// not from a hand-copied list. A declaration without a client entry is a promise the build would
// silently skip (build-client.mjs requires both halves of the pair), so the agreement between
// the two is checked here, and an empty discovery is a failure rather than a quiet pass.
const discovered = clientHalfDirs(root)
for (const entry of discovered.unreadable) problems.push('manifest unreadable — a browser half may be hidden: ' + entry)
const targets = discovered.dirs
if (targets.length === 0) {
  console.error('verify-client-tokens: no package under ' + root + ' declares dsh.client — the browser halves cannot be discovered')
  process.exit(1)
}
for (const pkg of targets) {
  if (!existsSync(join(root, pkg, 'src', 'client', 'index.ts'))) {
    problems.push(pkg + ': declares dsh.client but carries no src/client/index.ts — the platform would mount a loader for a package with no browser half')
  }
}
const { groups, flat } = readTokens()

const declared = Object.keys(groups)
for (const group of GROUPS) {
  if (!declared.includes(group)) problems.push('client-tokens.json: group ' + group + ' is missing')
}
for (const group of declared) {
  if (!GROUPS.includes(group)) problems.push('client-tokens.json: group ' + group + ' is not one of the nine')
  const entries = Object.keys(groups[group] ?? {})
  if (entries.length === 0) problems.push('client-tokens.json: group ' + group + ' is empty')
}
const seen = new Set()
for (const [name, value] of flat) {
  if (!NAME.test(name)) problems.push('client-tokens.json: ' + name + ' is not a --evo-* property name')
  if (seen.has(name)) problems.push('client-tokens.json: ' + name + ' is declared twice')
  seen.add(name)
  if (String(value).trim() === '') problems.push('client-tokens.json: ' + name + ' has no value')
  if (FORBIDDEN.test(String(value))) problems.push('client-tokens.json: ' + name + ' carries a forbidden character: ' + value)
}

const wanted = renderModule()
const copies = []
for (const pkg of targets) {
  const file = join(root, pkg, 'src/client/tokens.ts')
  let current = null
  try {
    current = readFileSync(file, 'utf8')
  } catch {
    problems.push(file + ' is missing - run node packages/scripts/gen-client-tokens.mjs ' + (rootArg ?? 'packages'))
    continue
  }
  copies.push([file, current])
  if (current !== wanted) {
    problems.push(file + ' does not match client-tokens.json - regenerate with node packages/scripts/gen-client-tokens.mjs ' + (rootArg ?? 'packages'))
  }
}
if (copies.length === targets.length && copies[0][1] !== copies[1][1]) {
  problems.push('the two copies differ from each other: ' + copies.map(pair => pair[0]).join(' vs '))
}

// A reference that the scale does not declare is a silent bug: the browser drops the declaration and
// the rule falls back to its initial value, which is how the aside column lost its width once already.
const declaredNames = new Set(flat.map(pair => pair[0]))
const referenced = new Set()
for (const pkg of targets) {
  for (const file of clientSources(join(root, pkg))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(REFERENCE)) {
      referenced.add(match[1])
      if (!declaredNames.has(match[1])) problems.push(file + ' reads ' + match[1] + ', which client-tokens.json does not declare')
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('verify-client-tokens: ' + problem)
  console.error('verify-client-tokens: ' + problems.length + ' problem(s)')
  process.exit(1)
}
console.log('verify-client-tokens: ok (' + GROUPS.length + ' groups, ' + flat.length + ' properties, '
  + referenced.size + ' referenced, ' + copies.length + ' identical copies)')
if (strict) {
  const unused = [...declaredNames].filter(name => !referenced.has(name))
  // The scale is a contract, not a wish list: a declared token nobody reads is either a
  // leftover (delete it) or a promise the browser halves never took (use it). Warn mode
  // reports it; --strict fails, the way every other guard in the family does.
  if (unused.length > 0) {
    console.error('verify-client-tokens: strict — ' + unused.length + ' declared token(s) nobody references: ' + unused.join(', '))
    process.exit(1)
  }
  console.log('verify-client-tokens: strict pass')
}
