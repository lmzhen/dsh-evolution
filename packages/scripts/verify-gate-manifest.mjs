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
import { familyVersion, versionReached } from './lib-family-version.mjs'

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
  // G0-5: strip backticks — a command cell whose code span ends the cell (`…mjs`) used to fail
  // scriptOf's trailing-delimiter rule, silently dropping that row from declaredScripts.
  if (match !== null) tableRows.push({ n: Number(match[1]), command: match[2].replace(/`/g, ' '), tree: match[3], line: index + 1 })
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

// G0-5: the manifest is the register both halves read (direction 2 + toolchain exceptions).
const manifestPath = join(root, 'scripts', 'gate-manifest.json')
const manifestGates = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')).gates ?? []) : []

// (4c) G0-5: toolchain rows used to be judged on NEITHER side — scriptOf() returns null for node_modules
// paths, so tsc/oxlint/vitest never reached the containment loop, and deleting the lint step turned
// nothing red (0.24.0 shipped 18 lint errors past every gate this way). Judge them by TOOL NAME, and let
// a manifest entry with a reason stand in for a check this action deliberately does not run.
for (const tool of ['typescript/lib/tsc.js', 'oxlint/bin/oxlint', 'vitest/vitest.mjs']) {
  const row = tableRows.find((entry) => entry.command.includes(tool))
  if (row === undefined) continue
  if (actionText.includes(tool)) continue
  const registered = manifestGates.find((gate) => typeof gate.cmd === 'string' && gate.cmd.includes(tool) && typeof gate.reason === 'string')
  if (registered !== undefined) { notes.push(tool + ' is registered as a declared local check: ' + registered.reason); continue }
  problems.push('row ' + row.n + ' declares ' + tool + ' but neither this action nor a manifest entry with a reason covers it — a deleted step would go unnoticed (G0-5)')
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

// (4b) G0-5 direction 2: CI-only scripts are allowed ONLY when the manifest registers them (with a reason
// where they are not gates). This is the missing half that used to be a note — a wild check could run in CI
// while nothing on either side named it. The old unexplained `verify-client*` filter is gone with it: those
// entries are registered like every other one.
const ciOnly = [...new Set([...actionText.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)].map((match) => match[1]))]
  .filter((script) => !declaredScripts.has(script))
  .sort()
for (const script of ciOnly) {
  const registered = manifestGates.find((gate) => typeof gate.cmd === 'string' && gate.cmd.includes(script))
  if (registered === undefined) problems.push('the CI action runs ' + script + ' but neither the table nor the manifest registers it — a wild check (G0-5 direction 2)')
}
if (ciOnly.length > 0) notes.push('CI-only (registered in the manifest): ' + ciOnly.join(', '))

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

// P0-prime (R146/工具链席缺口 ③)：表格编号必须唯一 —— 编号即 id 来源，
// 撞号会让 --check 报 stale、并让 --only/--drill <id> 目标不唯一（实测 gate-42 撞号）。
const seenNumbers = new Map()
for (const row of tableRows) {
  if (seenNumbers.has(row.n)) problems.push('table row ' + row.line + ' reuses number ' + row.n + ' (already used at line ' + seenNumbers.get(row.n) + ') — a duplicate number makes --only/--drill <id> ambiguous and the generated manifest stale')
  else seenNumbers.set(row.n, row.line)
}
// P0-prime（迁移角）：不可证伪必须显式声明 —— 每条 script 要么有 drillCmd，要么写明 noDrillReason，
// 两者皆无就是"忘了加"，不得沉默通过（与「没有对象名的绿＝红」同构）。
// ── G2/M1 (report half): four meta-criteria over the MANIFEST (the execution surface).
// They are computed and printed here, but they do NOT decide yet: step ① of the plan keeps this
// gate's verdict unchanged through the observation period, and each criterion earns its enforcing
// flip by its own mutation record at M5. This block is REAL CODE and not a comment precisely
// because the previous revision of this spot was a comment: the rule above was stated in prose
// and its loop body was empty, so `drillCmd-or-noDrillReason` had never been checked once.
const report = argv.includes('--report')
const overlayArg = (argv.find((entry) => entry.startsWith('--overlay=')) ?? '').slice('--overlay='.length)
const overlayRoot = overlayArg === '' ? resolve(repo, '..', 'deepseek-harness') : resolve(overlayArg)
const familyVer = familyVersion(root)
const observations = []
const note = (criterion, subject, detail) => observations.push({ criterion, subject, detail })
const tokensOf = (command) => String(command).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
for (const gate of manifestGates) {
  const command = String(gate.cmd ?? '')
  // (R1) executability: the row must name a command, and the script it names must exist in the
  // tree the row declares. gate-34's bare `--check` is the live specimen of a non-command row.
  const argvRow = tokensOf(command)
  if (argvRow.length === 0 || argvRow[0].startsWith('-')) {
    note('executability', gate.id, 'argv[0]=' + JSON.stringify(argvRow[0] ?? '') + ' is not a command - name the script the row runs')
  } else if (argvRow[0] === 'node' && argvRow.length > 1 && !argvRow[1].startsWith('-') && !argvRow[1].startsWith('<')) {
    const target = argvRow[1]
    const base = gate.tree === 'overlay' ? overlayRoot : repo
    const resolved = /^[A-Za-z]:[\\/]/.test(target) ? target : join(base, target)
    if (!existsSync(base)) note('executability', gate.id, 'the ' + String(gate.tree) + ' tree is not present at ' + base + ' - the script cannot be resolved (and that is not a pass)')
    else if (!existsSync(resolved)) note('executability', gate.id, 'runs ' + target + ', which does not exist at ' + resolved)
  }
  // (R2) no placeholders: `<...>` documents a shape and cannot execute a criterion; the WHOLE
  // token is named (R124) so the reader can find the row it belongs to.
  for (const token of String(command).matchAll(/<[^>]*>/g)) {
    note('no-placeholders', gate.id, 'cmd carries ' + token[0] + ' - declare the value (an args source) or register the row as pending')
  }
  // (R3) expiry due: a registered exemption the family version has reached is red, not permanent.
  if (typeof gate.expiry === 'string' && gate.expiry.trim() !== '') {
    const due = familyVer === undefined ? null : versionReached(familyVer, gate.expiry)
    if (due === true) note('expiry-due', gate.id, 'expiry ' + gate.expiry + ' is reached by ' + String(familyVer) + ' - close the exemption or move it with a reason')
  }
  // (R4) falsifiability carrier: every row states how its green can be turned red (drillCmd), or
  // why it cannot be yet (noDrillReason). Neither means somebody forgot, which G6's gate-truth counts.
  if (typeof gate.drillCmd !== 'string' && typeof gate.noDrillReason !== 'string') {
    note('falsifiability-carrier', gate.id, 'declares neither drillCmd nor noDrillReason - a green nobody can turn red is an F=0 candidate')
  }
}
const CRITERIA = ['executability', 'no-placeholders', 'expiry-due', 'falsifiability-carrier']
if (report) {
  console.log('verify-gate-manifest [report] ' + manifestGates.length + ' manifest row(s), family version ' + String(familyVer) + ' - ' + observations.length + ' observation(s)')
  for (const criterion of CRITERIA) {
    const list = observations.filter((entry) => entry.criterion === criterion)
    console.log('  ' + criterion + ': ' + list.length)
    for (const entry of list.slice(0, 8)) console.log('    - ' + entry.subject + ': ' + entry.detail)
    if (list.length > 8) console.log('    ... ' + (list.length - 8) + ' more')
  }
} else if (observations.length > 0) {
  console.log('verify-gate-manifest: observation period - ' + observations.length + ' pending meta-item(s) over ' + CRITERIA.length + ' criterion(s); run --report for the list (the enforcing half lands with M5)')
}
if (problems.length > 0) {
  console.error('verify-gate-manifest: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('verify-gate-manifest: OK — ' + tableRows.length + ' declared step(s), ' + declaredScripts.size + ' in-repo script(s), upstream line ' + platformVersion
  + (notes.length > 0 ? '; ' + notes.join('; ') : ''))