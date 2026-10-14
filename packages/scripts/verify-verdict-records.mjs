#!/usr/bin/env node
/**
 * verify-verdict-records.mjs (G2/M4b): the VACUUM fixture for the executor.
 *
 * Why it exists: a gate that cannot fail is not a gate, and an executor that reports
 * pass=0 fail=0 exit 0 on an EMPTY input is the F=0 shape this whole redesign hunts. This
 * fixture drives the real CLI in a probe tree (a copy of the few files it needs) with inputs
 * that are empty or unusable, and asserts the contract the plan states:
 *
 *   input emptied  =>  every check is cannot-decide, every missing is non-empty, exit == 2
 *
 * It also carries a HEALTHY control: a one-row manifest whose command exits 0 must produce
 * pass=1 and exit 0 - a fixture that can only go red would prove nothing about the green path.
 *
 * Shape-first (M4-12): the first assertion of every case is the SHAPE of the JSON envelope
 * (schema, four count keys, gates array, violations array).
 *
 * Usage: node <scripts-dir>/verify-verdict-records.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const NEEDED = ['run-gates.mjs', 'lib-verdict.mjs', 'lib-run-gates.mjs', 'lib-family-version.mjs', 'family-facts.json', 'gate-manifest.json']
const failures = []
const note = (message) => failures.push(message)

/** Read the JSON envelope the executor prints; the shape assertion comes first, always. */
function envelope(stdout) {
  let parsed = null
  try { parsed = JSON.parse(stdout) } catch { return { error: 'stdout is not JSON: ' + stdout.slice(-200) } }
  const problems = []
  if (parsed.schema !== 1) problems.push('schema')
  for (const key of ['pass', 'fail', 'cannotDecide', 'skipped']) if (typeof parsed.counts?.[key] !== 'number') problems.push('counts.' + key)
  if (!Array.isArray(parsed.gates)) problems.push('gates')
  if (!Array.isArray(parsed.violations)) problems.push('violations')
  if (problems.length > 0) return { error: 'envelope shape missing ' + problems.join(', ') }
  return { parsed }
}

/** Every record of a case that must not read as a verdict: cannot-decide with a named gap. */
function assertVacuum(label, parsed, exitCode) {
  if (exitCode !== 2) note(label + ': exit=' + String(exitCode) + ' (an emptied input must exit 2)')
  if (parsed.gates.length === 0) note(label + ': no record at all - silence is not a judgement')
  for (const record of parsed.gates) {
    if (record.verdict !== 'cannot-decide') note(label + ': ' + record.id + ' verdict=' + String(record.verdict) + ' (expected cannot-decide)')
    if (!Array.isArray(record.missing) || record.missing.length === 0) note(label + ': ' + record.id + ' carries no missing reason (a cannot-decide must name what is missing)')
    if (typeof record.evidence !== 'string' || record.evidence.trim() === '') note(label + ': ' + record.id + ' carries no evidence')
  }
  if (parsed.counts.cannotDecide !== parsed.gates.length) note(label + ': counts.cannotDecide=' + String(parsed.counts.cannotDecide) + ' but there are ' + parsed.gates.length + ' record(s)')
  if (parsed.counts.pass !== 0 || parsed.counts.fail !== 0) note(label + ': an emptied input reported pass=' + String(parsed.counts.pass) + ' fail=' + String(parsed.counts.fail))
  if (parsed.violations.length > 0) note(label + ': the records themselves violate the contract: ' + parsed.violations.slice(0, 2).join(' | '))
}

const root = mkdtempSync(join(tmpdir(), 'dsh-verdict-probe-'))
const scripts = join(root, 'scripts')
mkdirSync(scripts)
let copied = 0
for (const name of NEEDED) {
  const from = join(HERE, name)
  if (!existsSync(from)) { console.error('verify-verdict-records: CANNOT DECIDE - ' + name + ' is not next to this fixture'); process.exit(2) }
  writeFileSync(join(scripts, name), readFileSync(from))
  copied += 1
}
const run = (label, gates) => {
  writeFileSync(join(scripts, 'gate-manifest.json'), JSON.stringify({ version: 1, generatedBy: 'probe', sources: ['probe'], gates }, null, 2) + '\n')
  const result = spawnSync(process.execPath, [join(scripts, 'run-gates.mjs'), 'local', '--json'], { cwd: root, encoding: 'utf8' })
  const envelopeResult = envelope(result.stdout === null ? '' : result.stdout)
  if (envelopeResult.error !== undefined) { note(label + ': ' + envelopeResult.error); return null }
  return { parsed: envelopeResult.parsed, exitCode: result.status }
}

// (1) the manifest is EMPTY
const empty = run('empty-manifest', [])
if (empty !== null) assertVacuum('empty-manifest', empty.parsed, empty.exitCode)

// (2) no row matches the profile
const mismatch = run('profile-mismatch', [{ id: 'probe-ci', kind: 'script', human: 'node x.mjs', argv: ['node', 'x.mjs'], tree: 'mirror', profiles: ['ci'] }])
if (mismatch !== null) assertVacuum('profile-mismatch', mismatch.parsed, mismatch.exitCode)

// (3) rows whose executable form is unusable: a placeholder argument and no argv at all
const unusable = run('unusable-argv', [
  { id: 'probe-placeholder', kind: 'script', human: 'node x.mjs <plane home>', argv: ['node', 'x.mjs', '<plane home>'], tree: 'mirror', profiles: ['local'] },
  { id: 'probe-no-argv', kind: 'script', human: 'prose cell with no command', argv: null, argvProblem: 'composite-cell: 2 commands in one table row', tree: 'mirror', profiles: ['local'] },
])
if (unusable !== null) {
  assertVacuum('unusable-argv', unusable.parsed, unusable.exitCode)
  const placeholder = unusable.parsed.gates.find((record) => record.id === 'probe-placeholder')
  if (placeholder === undefined) note('unusable-argv: the placeholder row produced no record')
  else if (!(placeholder.missing ?? []).some((token) => String(token).includes('<plane home>'))) note('unusable-argv: missing does not name the WHOLE placeholder (got ' + JSON.stringify(placeholder.missing) + ')')
  const noArgv = unusable.parsed.gates.find((record) => record.id === 'probe-no-argv')
  if (noArgv === undefined) note('unusable-argv: the argv-less row produced no record')
  else if (!(noArgv.missing ?? []).some((token) => String(token).includes('composite-cell'))) note('unusable-argv: the argv-less row does not name its argvProblem (got ' + JSON.stringify(noArgv.missing) + ')')
}

// (4) HEALTHY control: one runnable row that exits 0 must be a pass with exit 0
const healthy = run('healthy-control', [{ id: 'probe-healthy', kind: 'script', human: 'node -e 0', argv: ['node', '-e', '0'], tree: 'mirror', profiles: ['local'] }])
if (healthy !== null) {
  if (healthy.exitCode !== 0) note('healthy-control: exit=' + String(healthy.exitCode) + ' (a row that exits 0 must be a pass)')
  if (healthy.parsed.counts.pass !== 1) note('healthy-control: pass=' + String(healthy.parsed.counts.pass) + ' (expected 1)')
  if (healthy.parsed.counts.cannotDecide !== 0) note('healthy-control: cannotDecide=' + String(healthy.parsed.counts.cannotDecide) + ' (expected 0)')
  if (healthy.parsed.violations.length > 0) note('healthy-control: record contract violations: ' + healthy.parsed.violations.slice(0, 2).join(' | '))
}

if (failures.length > 0) {
  console.error('verify-verdict-records: ' + failures.length + ' failed assertion(s) - the probe tree is kept at ' + root)
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}
rmSync(root, { recursive: true, force: true })
console.log('verify-verdict-records: OK - ' + copied + ' file(s) copied, 4 case(s): empty-manifest / profile-mismatch / unusable-argv => cannot-decide + missing + exit 2; healthy-control => pass + exit 0')
