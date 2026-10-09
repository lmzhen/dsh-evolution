#!/usr/bin/env node
/**
 * verify-gate-manifest — the gate table, the CI job and reality must agree (v46 S1.8).
 *
 * Finding T7-05: the table in CONTRIBUTING.md was hand-copied, so three rows pointed at
 * machine-local absolute paths, row 18 pointed at the PREVIOUS platform line, and the prose
 * counted the steps two different ways. The rule implemented here is deliberately one-way:
 *   every declared in-repo check must be executed somewhere (the CI action, or a register
 *   entry naming why not and when that closes); CI-only extras are reported, not failed.
 *
 * Four checks: (1) row numbering is contiguous and every row is a command; (2) an absolute
 * path in a command is only allowed when the row says machine-local AND the script is in
 * MACHINE_LOCAL with a reason and an expiry; (3) an `--upstream <path>` argument must end in
 * `dsh-upstream-<PLATFORM_VERSION>` read from .github/workflows/release.yml (the single source
 * for the platform line); (4) every step-count word in the docs equals the row count.
 *
 * Usage: node <scripts-dir>/verify-gate-manifest.mjs <evolution-root> [--strict]
 *   --strict  accepted for uniformity; this one always fails loud.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { familyGateRegisters } from './lib-doc-facts.mjs'

const argv = process.argv.slice(2)
const root = resolve(argv.find((arg) => !arg.startsWith('--')) ?? 'packages')
const repo = resolve(root, '..')
const problems = []
const notes = []

// v46 S2.4 (finding T7-05): both exception registers have ONE home — the `gate-set` fact in
// scripts/family-facts.json — and this guard is one of its two check points (the other is the
// fact-table re-derivation in lib-doc-facts). An unreadable table is a hard failure: treating it
// as 「no exceptions」 would make every declared-but-unexecuted step look like a violation and hide
// the real reason the registers exist.
const registers = familyGateRegisters(root)
if (registers === null) {
  console.error('verify-gate-manifest: the gate-set fact (or its machine registers) is missing from scripts/family-facts.json — the exception registers have no home')
  process.exit(2)
}
const MACHINE_LOCAL = registers.machineLocal
const CI_NOT_EXECUTED = registers.localOnly

const contributingPath = join(repo, 'CONTRIBUTING.md')
const actionPath = join(repo, '.github', 'actions', 'evolution-validate', 'action.yml')
const releasePath = join(repo, '.github', 'workflows', 'release.yml')
if (!existsSync(contributingPath)) { console.error('verify-gate-manifest: no CONTRIBUTING.md at ' + contributingPath); process.exit(2) }
if (!existsSync(actionPath)) { console.error('verify-gate-manifest: no composite action at ' + actionPath); process.exit(2) }

const tableRows = []
for (const [index, line] of readFileSync(contributingPath, 'utf8').split('\n').entries()) {
  const match = /^\|\s*([0-9]+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/.exec(line)
  if (match !== null) tableRows.push({ n: Number(match[1]), command: match[2], tree: match[3], line: index + 1 })
}
if (tableRows.length === 0) { console.error('verify-gate-manifest: the gate table parsed empty — refuse to report a pass on an empty parse'); process.exit(1) }
for (const [index, row] of tableRows.entries()) {
  if (row.n !== index + 1) problems.push('table row ' + row.line + ' is numbered ' + row.n + ' but sits at position ' + (index + 1) + ' — renumber the table (a gap hides a retired step)')
}

/** @returns the family script a command runs: `{ name, external }`, or null when the command
 * runs no script (a raw toolchain invocation such as node_modules/typescript/lib/tsc.js is not
 * a family check, and the CI job's build step covers it). */
function scriptOf(command) {
  const match = /(?:^|[\s'"(])([^\s'"();]+?([A-Za-z0-9._-]+)\.(?:mjs|cjs|js))(?=\s|$)/.exec(command)
  if (match === null) return null
  const path = match[1]
  if (path.includes('node_modules/')) return null
  if (!path.includes('scripts/')) return null
  return { name: match[2] + '.' + /(mjs|cjs|js)$/.exec(path)[1], external: /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') }
}

const machineLocalNames = new Set(MACHINE_LOCAL.map((entry) => entry.script))
for (const entry of [...MACHINE_LOCAL, ...CI_NOT_EXECUTED]) {
  for (const field of ['script', 'reason', 'expiry']) {
    if (typeof entry[field] !== 'string' || entry[field].trim() === '') problems.push('register entry ' + JSON.stringify(entry.script ?? '?') + ' has no ' + field)
  }
}

const declaredScripts = new Set()
for (const row of tableRows) {
  const script = scriptOf(row.command)
  const isMachineLocal = /machine-local/i.test(row.tree)
  if (script === null) continue
  if (script.external && !isMachineLocal) problems.push('row ' + row.n + ' (' + row.line + ') runs an absolute script path but its working tree does not say machine-local: ' + row.command)
  if (!script.external && isMachineLocal) problems.push('row ' + row.n + ' (' + row.line + ') claims machine-local but runs an in-repo command: ' + row.command)
  if (script.external && !machineLocalNames.has(script.name)) problems.push('row ' + row.n + ' (' + row.line + ') runs ' + script.name + ', which MACHINE_LOCAL does not register (name the reason and the expiry)')
  if (!script.external) declaredScripts.add(script.name)
}

// (3) the upstream target line has ONE source: release.yml's PLATFORM_VERSION.
let platformVersion = null
if (existsSync(releasePath)) {
  const match = /^\s*PLATFORM_VERSION:\s*(\S+)\s*$/m.exec(readFileSync(releasePath, 'utf8'))
  if (match !== null) platformVersion = match[1]
}
if (platformVersion === null) problems.push('release.yml declares no PLATFORM_VERSION — the upstream target line has no single source')
else {
  for (const row of tableRows) {
    for (const match of row.command.matchAll(/--upstream\s+([^\s`]+)/g)) {
      // A `<placeholder>` argument documents the shape without naming a machine path; only a
      // CONCRETE path can be stale, so only a concrete path is judged.
      if (match[1].startsWith('<')) continue
      const expected = 'dsh-upstream-' + platformVersion
      if (!match[1].replace(/\\/g, '/').endsWith(expected)) {
        problems.push('row ' + row.n + ' (' + row.line + ') points --upstream at ' + match[1] + ' but release.yml declares PLATFORM_VERSION ' + platformVersion + ' (the tree must end in ' + expected + ')')
      }
    }
  }
}

// (4) execution containment: declared in-repo scripts are executed by the CI action or registered.
// Comments are inert: a prose mention of an input or a script is not a reference (the N11
// precedent). Block-scalar comments inside `run: |` are line comments too, so one filter covers both.
const actionText = readFileSync(actionPath, 'utf8')
  .split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
for (const script of declaredScripts) {
  if (actionText.includes(script)) continue
  if (CI_NOT_EXECUTED.some((entry) => entry.script === script)) { notes.push(script + ' is local-runner only (registered)'); continue }
  problems.push('the table declares ' + script + ' but the CI action never runs it and no register entry covers it — a declared check nobody executes is not a gate')
}

// (6) composite-action input references must be declared (v46 S1.9, finding T7-01).
// A composite action reads only the inputs its `inputs:` block declares; any other name
// evaluates to the empty string, so an `if:` built on it is false forever and the step is
// dead while the workflow still lists it — the T7-01 failure mode.
const inputsBlock = /^inputs:\n([\s\S]*?)^runs:/m.exec(actionText)
const declaredInputs = new Set([...(inputsBlock === null ? '' : inputsBlock[1]).matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]))
if (declaredInputs.size === 0) problems.push(actionPath + ': the inputs: block parsed empty — the reference check cannot decide (a vacuum pass is not a pass)')
const referencedInputs = new Set([...actionText.matchAll(/\binputs\.([a-z_]+)/g)].map((match) => match[1]))
for (const name of referencedInputs) {
  if (!declaredInputs.has(name)) problems.push(actionPath + ': references inputs.' + name + ', which the inputs: block does not declare — the expression is empty-string false, so that step never runs')
}
notes.push('composite action: ' + declaredInputs.size + ' declared input(s), ' + referencedInputs.size + ' referenced')

// (4b) CI-only scripts are allowed; report them so the table can be completed deliberately.
const ciOnly = [...new Set([...actionText.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)].map((match) => match[1]))]
  .filter((script) => !declaredScripts.has(script) && !script.startsWith('verify-client') )
  .sort()
if (ciOnly.length > 0) notes.push('CI-only (not in the table): ' + ciOnly.join(', '))

// (5) every count word in the docs equals the row count.
const countFiles = [contributingPath, join(repo, 'README.md'), join(root, 'scripts', 'verify-client-tokens.mjs')]
const words = { eighteen: 18, twenty: 20, 'twenty-one': 21, 'twenty-two': 22 }
for (const file of countFiles) {
  if (!existsSync(file)) continue
  for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    // Both spellings the docs use: "22-step gate" and "all 22 steps".
    for (const match of line.matchAll(/([0-9]+)[- ]steps?\b|\b(eighteen|twenty|twenty-one|twenty-two)\b/g)) {
      const value = match[1] !== undefined ? Number(match[1]) : words[match[2]]
      if (value !== tableRows.length) problems.push(file + ':' + (index + 1) + ' says "' + match[0] + '" but the gate table has ' + tableRows.length + ' rows')
    }
  }
}

if (problems.length > 0) {
  console.error('verify-gate-manifest: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('verify-gate-manifest: OK — ' + tableRows.length + ' declared step(s), ' + declaredScripts.size + ' in-repo script(s), upstream line ' + platformVersion
  + (notes.length > 0 ? '; ' + notes.join('; ') : ''))