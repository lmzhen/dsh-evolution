#!/usr/bin/env node
/**
 * run-gates — 门禁清单的唯一执行器（G0-2）。只判不改。
 * G1: every gate now emits a VerdictRecord; the runner renders, it does not decide by exit code alone.
 * G1/S4: the spawn seam lives in lib-run-gates.mjs (createRunner) - this file wires spawnSync and
 * renders what the runner observed; no env/CLI switch reaches the seam.
 * 用法：node packages/scripts/run-gates.mjs <local|pre-tag|ci> [--list] [--json] [--only <id>] [--drill <id>] [--overlay <path>]
 * 规则：seed = CI ∪ 表；pre-tag = local ∪ ci；runner 只跑 kind=script|toolchain；tree=overlay 的门禁在 overlay 根下跑。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { validate, counts, render, actionBlock } from './lib-verdict.mjs'
import { createRunner, decideRequires } from './lib-run-gates.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIRROR_ROOT = resolve(HERE, '..', '..')
const MANIFEST = join(HERE, 'gate-manifest.json')
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '') : undefined }
const has = (name) => args.includes(name)
const profile = args.find((a) => ['local', 'pre-tag', 'ci'].includes(a))
const overlayRoot = flag('--overlay') || process.env.EVOLUTION_OVERLAY_ROOT || resolve(MIRROR_ROOT, '..', 'deepseek-harness')

if (!existsSync(MANIFEST)) { console.error('run-gates: missing gate-manifest.json — run gen-gate-manifest.mjs'); process.exit(2) }
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const RUNNABLE = new Set(['script', 'toolchain'])
const gates = manifest.gates.filter((g) => RUNNABLE.has(g.kind))
const ofProfile = (p) => gates.filter((g) => g.profiles.includes(p))
const union = (a, b) => { const m = new Map(); for (const g of [...a, ...b]) m.set(g.id, g); return [...m.values()] }
const byProfile = { local: ofProfile('local'), ci: ofProfile('ci') }
byProfile['pre-tag'] = union(byProfile.local, byProfile.ci)

const sha8 = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 8) } catch { return 'absent' } }
const gitHead = () => { const r = spawnSync('git', ['-C', MIRROR_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }); return (r.stdout || 'unknown').trim() || 'unknown' }
const identityFor = (lane) => ({
  face: 'unknown',
  channel: 'src',
  platformLine: 'unknown',
  adapterSha: sha8(join('D:', 'dsh', '_tools', 'lib-line.mjs')),
  policySha: sha8(join(HERE, 'family-facts.json')),
  familyVersion: (() => { try { return JSON.parse(readFileSync(join(MIRROR_ROOT, 'package.json'), 'utf8')).version } catch { return 'unknown' } })(),
  readerSha: sha8(join(HERE, 'lib-param-registry.mjs')),
  scope: 'full',
  tree: gitHead(),
  lane,
  ci: process.env.CI ? 'on' : 'off',
})

const parts = (cmd) => (cmd.replace(/^node\s+/, '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [])
const show = (list) => list.map((g) => g.id.padEnd(9) + g.tree.padEnd(8) + g.human)
const emitList = (list, label) => {
  if (has('--json')) { console.log(JSON.stringify({ profile: label, count: list.length, ids: list.map((g) => g.id) }, null, 2)); return }
  console.log('run-gates [' + label + '] ' + list.length + ' gate(s)')
  for (const line of show(list)) console.log('  ' + line)
}

if (has('--drill')) {
  const id = flag('--drill')
  const g = manifest.gates.find((x) => x.id === id)
  if (!g) { console.error('run-gates --drill: unknown gate ' + id); process.exit(2) }
  if (!g.drillCmd) { console.error('run-gates --drill ' + id + ': this gate declares no drillCmd — its criterion source cannot yet be falsified (contract 5c)'); process.exit(2) }
  const dParts = parts(g.drillCmd)
  const [dScript, ...dRest] = dParts
  const r = spawnSync(process.execPath, [dScript, ...dRest], { cwd: g.tree === 'overlay' ? overlayRoot : MIRROR_ROOT, stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

if (!profile) { console.error('run-gates: usage: run-gates.mjs <local|pre-tag|ci> [--list] [--json] [--only <id>] [--drill <id>]'); process.exit(2) }
let list = byProfile[profile]
const only = flag('--only')
if (only !== undefined) { list = list.filter((g) => g.id === only); if (list.length === 0) { console.error('run-gates: --only ' + only + ' not in profile ' + profile); process.exit(2) } }
if (has('--list')) { emitList(list, profile); process.exit(0) }

const runner = createRunner({ spawn: spawnSync })
// requires (R38/R42): the prerequisites each check declares. The FACT owns them (nothing else
// does), the decision is the pure matrix in lib-run-gates, and this runner only supplies what it
// observed. A prerequisite that does not pass aborts THIS row - no member verdict is invented.
// The checks fact owns both the declared criterion (who judges this row) and the prerequisites.
// The executor READS them; it never invents a criterion of its own (the old value was the
// placeholder <id>-criterion, which named nothing a reader could follow).
const declared = (() => {
  try {
    const asset = JSON.parse(readFileSync(join(HERE, 'family-facts.json'), 'utf8'))
    const fact = (asset.facts ?? []).find((entry) => entry?.machine?.kind === 'checks')
    const criteria = new Map()
    const requires = new Map()
    for (const row of fact?.machine?.declarations ?? []) {
      if (typeof row.criterion === 'string' && row.criterion.trim() !== '') criteria.set(row.id, row.criterion)
      if (Array.isArray(row.requires) && row.requires.length > 0) requires.set(row.id, row.requires)
    }
    return { criteria, requires }
  } catch { return { criteria: new Map(), requires: new Map() } }
})()
const declaredRequires = declared.requires
const criterionOf = (id) => declared.criteria.get(id) ?? 'undeclared'
const treeRootFor = (tree) => (tree === 'overlay' ? overlayRoot : MIRROR_ROOT)
const evaluateRequires = (gate) => {
  for (const req of declaredRequires.get(gate.id) ?? []) {
    if (req.mode === 'present') {
      const product = /^[A-Za-z]:[\\/]/.test(req.path) ? req.path : join(treeRootFor(gate.tree), req.path)
      const decision = decideRequires({ present: existsSync(product), path: product }, 'in-repo', 'present')
      if (decision.verdict !== 'pass') return { req, decision }
      continue
    }
    const script = /[\\/]/.test(req.script) ? req.script : join(HERE, req.script)
    if (!existsSync(script)) return { req, decision: decideRequires({ status: null, errorCode: 'ENOENT', path: script }, 'in-repo', 'run') }
    const observed = runner.run([process.execPath, script], { cwd: treeRootFor(gate.tree), stdio: has('--json') ? 'pipe' : 'inherit' })
    const decision = decideRequires({ status: observed.status, errorCode: observed.errorCode, killedBy: observed.killedBy, signal: observed.signal, ms: observed.ms, path: script }, 'in-repo', 'run')
    if (decision.verdict !== 'pass') return { req, decision }
  }
  return null
}
const identity = identityFor(profile)
const records = []
const base = (g, extra) => ({ id: g.id, check: g.human, criterion: criterionOf(g.id), identity, subject: { kind: 'paths', count: 0 }, ...extra })

for (const g of list) {
  // 1) static executability: a placeholder token or a non-command argv[0] cannot run a criterion at all
  // M2: the executable form is the declared argv; the human cell is prose and may carry
  // placeholders. A row that declares no single command (a composite table cell) is
  // cannot-decide with its reason named - never "run the first thing that looks like a command".
  const argv = Array.isArray(g.argv) ? g.argv : null
  // the placeholder is read from the JOINED argv (the executable form): a multi-word one
  // (<platform tree>) stays whole (R124), and a placeholder that lives only in the human
  // annotation is prose about usage - the table row 24 annotates a <path> it never passes.
  const executable = argv === null ? '' : argv.join(' ')
  const placeholder = (executable.match(/<[^>]*>/) || [])[0]
  if (argv === null || argv.length === 0) {
    records.push(base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'field-absent' }, missing: [g.argvProblem === undefined ? 'argv' : g.argvProblem], path: 'UNRESOLVED', next: 'declare ONE executable command for this row (split the prose cell, or give the row an argv with a value source for every placeholder)', evidence: MANIFEST + ':' + g.id + ' declares no argv' + (g.argvProblem === undefined ? '' : ' (' + g.argvProblem + ')') }))
    continue
  }
  if (placeholder !== undefined) {
    records.push(base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'field-absent' }, missing: [placeholder], path: 'UNRESOLVED', next: 'declare the placeholder value in the gate table (or register an args[] source) so the command is executable', evidence: MANIFEST + ':' + g.id + ' cmd contains ' + placeholder }))
    continue
  }
  if (argv[0].startsWith('-')) {
    records.push(base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'field-absent' }, missing: ['argv[0]'], path: 'UNRESOLVED', next: 'name a script as argv[0] (a bare flag is not a command) or register the step explicitly', evidence: MANIFEST + ':' + g.id + ' argv[0]=' + String(argv[0]) }))
    continue
  }
  const blocked = evaluateRequires(g)
  if (blocked !== null) {
    if (!has('--json')) console.log('           requires: ' + blocked.req.script + ' (mode=' + blocked.req.mode + ', verdict=' + blocked.decision.verdict + ')')
    records.push(base(g, { verdict: blocked.decision.verdict, criterionEvaluated: blocked.decision.criterionEvaluated, cause: blocked.decision.cause, missing: blocked.decision.missing, path: String(blocked.req.path ?? blocked.req.script), next: blocked.decision.next, evidence: blocked.decision.evidence }))
    continue
  }
  if (g.localSafe === false && !process.env.CI) {
    records.push(base(g, { verdict: 'skipped', criterionEvaluated: false, cause: { kind: 'field-absent' }, missing: [g.localSafeReason || 'CI-shaped command'], path: 'UNRESOLVED' }))
    continue
  }
  if (g.tree === 'overlay' && !existsSync(overlayRoot)) {
    records.push(base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'artifact-absent' }, missing: [overlayRoot], path: overlayRoot, next: 'clone the overlay tree or pass --overlay <path>', evidence: 'overlay root missing: ' + overlayRoot }))
    continue
  }
  const cwd = g.tree === 'overlay' ? overlayRoot : MIRROR_ROOT
  // the declared argv names the command as the table writes it (`node <script> ...`); the runner
  // always spawns through process.execPath, so the leading token is dropped here - keeping it
  // would spawn `node node script` and every spawning gate would read as a broken check.
  const declared = argv[0] === 'node' ? argv.slice(1) : argv
  const [script, ...rest] = declared
  // the seam owns the spawn and reports killedBy explicitly; this file never infers it
  const observed = runner.run([process.execPath, script, ...rest], { cwd, stdio: has('--json') ? 'pipe' : 'inherit' })
  const ms = observed.ms
  const status = observed.status ?? 1
  if (status === 0) records.push(base(g, { verdict: 'pass', criterionEvaluated: true, subject: { kind: 'paths', count: 1 }, path: cwd, ms }))
  else records.push(base(g, { verdict: 'fail', criterionEvaluated: true, cause: { kind: 'non-zero-exit' }, subject: { kind: 'paths', count: 1 }, path: cwd, ms, next: 'read the failing script output above, then fix the gate or the tree it judges', evidence: script + ' exit=' + status }))
}

// A profile that selects nothing is NOT a pass (plan step 3's vacuum fixture): the run would
// otherwise print pass=0 fail=0 and exit 0, which is exactly the F=0 shape this redesign hunts.
if (records.length === 0) {
  records.push({
    id: 'profile:' + profile,
    check: 'run-gates ' + profile,
    criterion: 'profiles',
    identity,
    subject: { kind: 'paths', count: 0 },
    path: MIRROR_ROOT,
    verdict: 'cannot-decide',
    criterionEvaluated: false,
    cause: { kind: 'filter-no-match' },
    missing: ['gates'],
    next: 'the profile selects no runnable gate - register the rows or fix their profiles (an empty run is not a pass)',
    evidence: MANIFEST + ' carries ' + manifest.gates.length + ' row(s), 0 runnable for profile ' + profile,
  })
}

const c = counts(records)
const violations = records.flatMap((r) => validate(r, r.id))
if (has('--json')) {
  console.log(JSON.stringify({ schema: 1, profile, counts: c, gates: records, violations }, null, 2))
} else {
  for (const r of records) { console.log(render(r)); for (const l of actionBlock(r)) console.log(l) }
  console.log('run-gates [' + profile + '] counts: pass=' + c.pass + ' fail=' + c.fail + ' cannotDecide=' + c.cannotDecide + ' skipped=' + c.skipped)
}
if (violations.length > 0) { console.error('run-gates: record contract violations: ' + violations.slice(0, 3).join(' | ')); process.exit(2) }
process.exit(c.fail > 0 ? 1 : c.cannotDecide > 0 ? 2 : 0)
