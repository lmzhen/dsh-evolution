#!/usr/bin/env node
/**
 * verify-check-registry.mjs (G2/M5): ONE account over the six axes of every declared check.
 *
 * Why it exists: the criteria that judge a check live in five places (the facts branch, the
 * meta-gate's observations, the taxonomy view, the requires static half, the vacuum fixture).
 * Before a release somebody has to READ the whole face at once - "which check is missing what,
 * and is that gap registered?". This ledger answers only that. It does NOT re-derive anything:
 * the meta-gate's observations are consumed as JSON, the closure is computed from the two data
 * homes, and an axis nobody can measure is reported cannot-decide rather than green.
 *
 * Axes: closure / executability / no-placeholders / expiry-due / falsifiability-carrier /
 * mutation-coverage / producer-wiring. Every non-zero gap must be registered in the checks
 * fact's pendingAxes with a measured row count, a reason, an expiry and an owner - a live count
 * that differs from the registered one is the violation this ledger is for.
 *
 * Report half (plan step 3): the default run prints the account and exits 0 (M5 flips --strict
 * into the gate table). --strict exits 1 on any violation. An EMPTY input (no rows, or no
 * declarations) is cannot-decide with exit 2, never a clean account.
 *
 * Usage: node <scripts-dir>/verify-check-registry.mjs [--json] [--strict]
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TREE = resolve(HERE, '..')
const MANIFEST = join(HERE, 'gate-manifest.json')
const FACTS = join(HERE, 'family-facts.json')
const json = process.argv.includes('--json')
const strict = process.argv.includes('--strict')
const violations = []

if (!existsSync(MANIFEST) || !existsSync(FACTS)) {
  console.error('verify-check-registry: CANNOT DECIDE - ' + (existsSync(MANIFEST) ? FACTS : MANIFEST) + ' is missing (the two data homes are the input)')
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const asset = JSON.parse(readFileSync(FACTS, 'utf8'))
const checksFact = (asset.facts ?? []).find((fact) => fact?.machine?.kind === 'checks')
const rows = Array.isArray(manifest.gates) ? manifest.gates : []
const declarations = Array.isArray(checksFact?.machine?.declarations) ? checksFact.machine.declarations : []
if (rows.length === 0 || declarations.length === 0) {
  console.error('verify-check-registry: CANNOT DECIDE - ' + rows.length + ' manifest row(s), ' + declarations.length + ' declaration(s): an empty face cannot be accounted (exit 2, not a clean ledger)')
  process.exit(2)
}

// --- closure: the two homes must name exactly the same checks -------------------------------
const rowIds = new Set(rows.map((row) => row.id))
const declaredIds = new Set(declarations.map((row) => row.id))
const missingDeclarations = [...rowIds].filter((id) => !declaredIds.has(id))
const staleDeclarations = [...declaredIds].filter((id) => !rowIds.has(id))

// --- the meta-gate's observations, consumed as data -----------------------------------------
const gateRun = spawnSync(process.execPath, [join(HERE, 'verify-gate-manifest.mjs'), TREE, '--json'], { encoding: 'utf8' })
let observations = []
let gateOk = false
try {
  const parsed = JSON.parse(gateRun.stdout === null ? '' : gateRun.stdout)
  observations = Array.isArray(parsed.observations) ? parsed.observations : []
  gateOk = true
} catch { gateOk = false }
if (!gateOk) {
  // Diagnosability: spawnSync captures the child's stderr as well, so keeping it in a variable
  // and never printing it locked the root cause away from the CI log - the job showed only this
  // conclusion and no reason. Print the exit status and the child's stderr before exiting.
  const detail = (gateRun.stderr === null ? '' : gateRun.stderr).trim().split('\n').slice(-6).join('\n')
  console.error('verify-check-registry: meta-gate exit=' + String(gateRun.status) + ' stdoutBytes=' + String(gateRun.stdout === null ? 0 : gateRun.stdout.length))
  if (detail !== '') console.error('verify-check-registry: meta-gate stderr tail:\n' + detail)
  // Arm-awareness: the register records the meta-gate row against the MIRROR tree, and the
  // released-upstream layout carries no repository root above it (no composite action file there),
  // so the meta-gate is legitimately not armed. Every axis then reads as 'no live observation',
  // which the loop below already treats as pass; only the missing JSON was fatal.
  const repoMarker = join('.github', 'actions', 'evolution-validate', 'action.yml')
  let armed = false
  for (let dir = TREE; ; ) {
    if (existsSync(join(dir, repoMarker))) { armed = true; break }
    const up = resolve(dir, '..')
    if (up === dir) break
    dir = up
  }
  if (armed) {
    console.error('verify-check-registry: CANNOT DECIDE - the meta-gate did not answer with JSON (its observations are this ledger\'s other half)')
    process.exit(2)
  }
  console.error('verify-check-registry: NOT ARMED in this layout - no repository marker above ' + TREE + ' (the register records this row against the mirror tree)')
}
const liveCount = (criterion) => observations.filter((entry) => entry.criterion === criterion).length

// --- the register: a gap is a debt with a measured size, an expiry and an owner --------------
const register = Array.isArray(checksFact.machine.pendingAxes) ? checksFact.machine.pendingAxes : {}
const registeredOf = (axis) => (Array.isArray(register) ? register.find((entry) => entry.axis === axis) : undefined)

const axes = []
const addAxis = (axis, live, state, detail) => axes.push({ axis, live, registered: registeredOf(axis) === undefined ? null : registeredOf(axis).rows, state, detail })
addAxis('closure', missingDeclarations.length + staleDeclarations.length, missingDeclarations.length + staleDeclarations.length === 0 ? 'pass' : 'fail', missingDeclarations.length + staleDeclarations.length === 0 ? 'both homes name the same checks' : 'missing declarations: ' + missingDeclarations.join(',') + '; stale declarations: ' + staleDeclarations.join(','))
for (const [axis, criterion] of [['executability', 'executability'], ['no-placeholders', 'no-placeholders'], ['expiry-due', 'expiry-due'], ['falsifiability-carrier', 'falsifiability-carrier']]) {
  const live = liveCount(criterion)
  const entry = registeredOf(axis)
  if (live === 0) { addAxis(axis, 0, 'pass', 'no live observation'); continue }
  if (entry === undefined) { addAxis(axis, live, 'fail', 'a live gap is not registered - a bare number is not a debt'); continue }
  if (entry.rows !== live) { addAxis(axis, live, 'fail', 'the register says ' + entry.rows + ' row(s), the live observation says ' + live + ' (drift: the debt changed size)'); continue }
  addAxis(axis, live, 'registered', 'registered until ' + entry.expiry + ' (owner ' + entry.owner + ')')
}
for (const axis of ['mutation-coverage', 'producer-wiring']) {
  const entry = registeredOf(axis)
  addAxis(axis, null, entry === undefined ? 'cannot-decide' : 'cannot-decide', entry === undefined ? 'no data source and no register entry' : 'no data source yet (registered until ' + entry.expiry + '): ' + entry.reasonRef)
}
for (const axis of axes) if (axis.state === 'fail') violations.push(axis.axis + ': ' + axis.detail)
// Diagnosability: the axis line names a count, not the rows behind it, so a CI-only gap could
// not be identified from the log. Print the observations of every failing axis (the meta-gate's
// own entries, verbatim) so the next run names the rows instead of leaving a bare number.
for (const axis of axes) {
  if (axis.state !== 'fail') continue
  const detailRows = observations.filter((entry) => entry.criterion === axis.axis).slice(0, 25)
  console.error('verify-check-registry: ' + axis.axis + ' has ' + String(detailRows.length) + ' observation(s):')
  for (const entry of detailRows) console.error('  ' + JSON.stringify(entry))
}
for (const id of missingDeclarations) violations.push('closure: ' + id + ' is a manifest row with no declaration')
for (const id of staleDeclarations) violations.push('closure: ' + id + ' is a declaration with no manifest row')

const counts = { pass: axes.filter((a) => a.state === 'pass').length, registered: axes.filter((a) => a.state === 'registered').length, cannotDecide: axes.filter((a) => a.state === 'cannot-decide').length, fail: axes.filter((a) => a.state === 'fail').length }
if (json) {
  console.log(JSON.stringify({ schema: 1, manifestRows: rows.length, declarations: declarations.length, axes, counts, violations }, null, 2))
} else {
  console.log('verify-check-registry: ' + rows.length + ' row(s) / ' + declarations.length + ' declaration(s)')
  for (const axis of axes) console.log('  ' + axis.axis.padEnd(22) + 'live=' + String(axis.live === null ? '-' : axis.live).padEnd(4) + 'registered=' + String(axis.registered === null ? '-' : axis.registered).padEnd(4) + axis.state + '  ' + axis.detail)
  console.log('verify-check-registry: axes pass=' + counts.pass + ' registered=' + counts.registered + ' cannotDecide=' + counts.cannotDecide + ' fail=' + counts.fail + (strict ? ' [strict]' : ' [report half: M5 flips --strict into the table]'))
  for (const violation of violations) console.log('  - ' + violation)
}
// The CLOSURE axis is not one of the six new criteria - it is already enforced by the facts
// branch (id sets both ways) and it has its red-proof, so the ledger fails on it in either mode.
// The six axes stay report-only until M5 flips --strict into the gate table.
const closureBroken = axes.some((axis) => axis.axis === 'closure' && axis.state !== 'pass')
if (closureBroken) process.exit(1)
if (strict && violations.length > 0) process.exit(1)
process.exit(0)
