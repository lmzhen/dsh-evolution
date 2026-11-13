#!/usr/bin/env node
/**
 * run-gates — the family gate runner.
 *
 * G1/S4: the spawn seam lives in gates/runner.mjs (bounded scheduler + spawn observers); this file
 * wires the real child_process seams, judges each row through gates/report.mjs (the VerdictRecord
 * contract), and renders the summary. It never decides on its own: every verdict is the contract in
 * gates/report.mjs + the observed process result.
 *
 * 用法：node packages/scripts/run-gates.mjs <local|pre-tag|ci> [--list] [--json] [--json-out <path>]
 *       [--lane <name>] [--only <id>] [--drill <id>] [--overlay <path>] [--concurrency <n>] [--fail-fast]
 * 规则：seed = CI ∪ 表；pre-tag = local ∪ ci；runner 只跑 kind=script|toolchain；tree=overlay 的门禁在 overlay 根下跑。
 * M0/M3（W10 §10/§16）：lanes 由 gates/registry.mjs 生成到 manifest；`--lane` 在 profile 选择后过滤，空选择 exit 2。
 * M3b（W10 §16.8）：`--concurrency`（默认 1，最多 32）打开有界并发；`--fail-fast` 在首个 fail 后不启动新行。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { validate, counts, render, actionBlock, exitCodeFor, EXIT } from './gates/report.mjs'
import { createAsyncRunner, decideRequires, clampConcurrency, runTasks } from './gates/runner.mjs'
import { LANES } from './gates/model.mjs'
import { softOverlay } from './lib-env.mjs'
import { familyVersion } from './lib-family-version.mjs'
import { exemptionProblems } from './lib-exemptions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// The runner lives in TWO layouts: the flat mirror (packages/scripts) and the CI overlay
// (packages/evolution/scripts). The tree root is therefore not a fixed ".." — the overlay's parent
// of scripts is `packages`, whose own parent is the checkout root.
const OVERLAY_LAYOUT = basename(dirname(HERE)) === 'evolution'
const MIRROR_ROOT = OVERLAY_LAYOUT ? resolve(HERE, '..', '..', '..') : resolve(HERE, '..', '..')
const MANIFEST = join(HERE, 'gate-manifest.json')
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '') : undefined }
const has = (name) => args.includes(name)
const profile = args.find((a) => ['local', 'pre-tag', 'ci'].includes(a))
// M3 lane selection: lane membership comes from the gate registry, rendered onto each manifest row.
const laneName = flag('--lane')
const jsonOut = flag('--json-out')
const concurrency = clampConcurrency(flag('--concurrency') === undefined ? 1 : flag('--concurrency'))
const failFast = has('--fail-fast')
const KNOWN_LANES = new Set(LANES)
if (laneName !== undefined) {
  if (laneName === '' || !KNOWN_LANES.has(laneName)) { console.error('run-gates: --lane needs one of ' + [...KNOWN_LANES].join('|') + ' (got ' + JSON.stringify(laneName) + ')'); process.exit(2) }
}
// 遗留⑤: the platform tree is a fixture, not a repo fact — resolve it portably (env first).
// In the overlay layout the tree the runner is inside IS the overlay root; locally the bed is elsewhere.
const overlayFlag = flag('--overlay')
const overlayRoot = overlayFlag !== undefined && overlayFlag !== ''
  ? resolve(overlayFlag)
  : (OVERLAY_LAYOUT ? MIRROR_ROOT : softOverlay())

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
// policySha is the keep-list identity: a canonical projection of the facts asset, so the mutation
// prover's own stamps (provenAt/provenSha) cannot churn it - those are data about proofs, not policy.
const VOLATILE = new Set(['provenAt', 'provenSha'])
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE.has(key)) continue
      out[key] = canonical(value[key])
    }
    return out
  }
  return value
}
const policySha8 = (p) => { try { return createHash('sha256').update(JSON.stringify(canonical(JSON.parse(readFileSync(p, 'utf8'))))).digest('hex').slice(0, 8) } catch { return 'unknown' } }
const identityFor = (lane) => ({
  face: 'unknown',
  channel: 'src',
  platformLine: 'unknown',
  adapterSha: sha8(join('D:', 'dsh', '_tools', 'lib-line.mjs')),
  policySha: policySha8(join(HERE, 'family-facts.json')),
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

if (!profile) { console.error('run-gates: usage: run-gates.mjs <local|pre-tag|ci> [--list] [--json] [--json-out <path>] [--lane <name>] [--only <id>] [--drill <id>] [--overlay <path>] [--concurrency <n>] [--fail-fast]'); process.exit(2) }
let list = byProfile[profile]
const only = flag('--only')
if (only !== undefined) { list = list.filter((g) => g.id === only); if (list.length === 0) { console.error('run-gates: --only ' + only + ' not in profile ' + profile); process.exit(2) } }
if (laneName !== undefined) {
  list = list.filter((g) => Array.isArray(g.lanes) && g.lanes.includes(laneName))
  if (list.length === 0) { console.error('run-gates: --lane ' + laneName + ' selects no runnable gate in profile ' + profile + ' — an empty lane is not a pass'); process.exit(2) }
}
if (has('--list')) { emitList(list, laneName === undefined ? profile : profile + ' lane=' + laneName); process.exit(0) }

const runner = createAsyncRunner({ spawn })
// requires (R38/R42): the prerequisites each check declares. The FACT owns them (nothing else
// does), the decision is the pure matrix in lib-run-gates, and this runner only supplies what it
// observed. A prerequisite that does not pass aborts THIS row - no member verdict is invented.
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
const treeRootFor = (tree) => (tree === 'overlay' ? overlayRoot : FAMILY_CHECKOUT)
/**
 * Layout translation (W10 M3b): rows are authored for the OVERLAY layout
 * (`packages/evolution/<pkg>`), while the local mirror is flat (`packages/<pkg>`). The reverse also
 * exists: inside the CI overlay the mirror rows' `packages/scripts/...` has no flat tree, so they
 * resolve to `packages/evolution/scripts/...`. A token is rewritten only when the target exists and
 * the written one does not, so a genuinely absent artifact still reads as absent (G7-e1).
 */
const flatLayout = !existsSync(join(MIRROR_ROOT, 'packages', 'evolution'))
const nestedLayout = !flatLayout
/**
 * Translate a registry token for the TREE THE ROW RUNS IN (not the runner's own tree):
 *   - flat family checkout: `packages/evolution/x` -> `packages/x` when the flat copy exists;
 *   - nested overlay tree: family-root `packages` and `packages/x` -> `packages/evolution/...`.
 * Tokens are rewritten only when the target exists and the written one does not.
 */
const resolveLayoutToken = (token, tree, treeRoot) => {
  if (tree !== 'mirror') return token
  const flat = !existsSync(join(treeRoot, 'packages', 'evolution'))
  if (flat && token.startsWith('packages/evolution/')) {
    const mapped = 'packages/' + token.slice('packages/evolution/'.length)
    return !existsSync(join(treeRoot, token)) && existsSync(join(treeRoot, mapped)) ? mapped : token
  }
  if (!flat) {
    if (token === 'packages') return existsSync(join(treeRoot, 'packages', 'evolution')) ? 'packages/evolution' : token
    if (token.startsWith('packages/') && !token.startsWith('packages/evolution/') && existsSync(join(treeRoot, 'packages', 'evolution', token.slice('packages/'.length)))) {
      return 'packages/evolution/' + token.slice('packages/'.length)
    }
  }
  return token
}
/** Expand ${NAME}/$NAME from the environment (CI override argv only; local argv stays literal). */
const expandEnv = (token) => token.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, braced, bare) => {
  const name = braced === undefined ? bare : braced
  return process.env[name] === undefined ? whole : process.env[name]
})
const evaluateRequires = async (gate) => {
  const gateRoot = treeRootFor(gate.tree)
  for (const req of declaredRequires.get(gate.id) ?? []) {
    if (req.mode === 'present') {
      const product = /^[A-Za-z]:[\\/]/.test(req.path) ? req.path : join(gateRoot, resolveLayoutToken(req.path, gate.tree, gateRoot))
      const decision = decideRequires({ present: existsSync(product), path: product }, 'in-repo', 'present')
      if (decision.verdict !== 'pass') return { req, decision }
      continue
    }
    const script = /[\\/]/.test(req.script) ? req.script : join(HERE, req.script)
    if (!existsSync(script)) return { req, decision: decideRequires({ status: null, errorCode: 'ENOENT', path: script }, 'in-repo', 'run') }
    const observed = await runner.run([process.execPath, script], { cwd: treeRootFor(gate.tree) })
    const decision = decideRequires({ status: observed.status, errorCode: observed.errorCode, killedBy: observed.killedBy, signal: observed.signal, ms: observed.ms, path: script }, 'in-repo', 'run')
    if (decision.verdict !== 'pass') return { req, decision }
  }
  return null
}
const identity = identityFor(profile)
// In CI the runner executes from the OVERLAY checkout (upstream/), while mirror-tree rows read the
// FAMILY checkout (workspace root: .github + CONTRIBUTING + flat packages). Local runs have no
// workspace root, so mirror rows fall back to the tree the runner is inside.
const FAMILY_CHECKOUT = (() => {
  const workspace = process.env.GITHUB_WORKSPACE
  if (typeof workspace === 'string' && workspace !== '' && existsSync(join(workspace, '.github', 'actions', 'evolution-validate', 'action.yml'))) return workspace
  return MIRROR_ROOT
})()
const base = (g, extra) => ({ id: g.id, check: g.human, criterion: criterionOf(g.id), lanes: Array.isArray(g.lanes) ? g.lanes : [], identity, subject: { kind: 'paths', count: 0 }, ...extra })

/** Judge ONE gate. Every branch returns a record (never throws); the scheduler owns the order. */
async function executeGate(g) {
  // 1) static executability: a placeholder token or a non-command argv[0] cannot run a criterion at all
  // CI override (W10 §16.8.2): only on a runner, only for rows that declare one. It replaces the
  // argv/env/cwd the table form carries (machine paths, $RUNNER_TEMP homes, the probe baseline).
  const ciOverride = process.env.CI && g.ci !== undefined && g.ci !== null ? g.ci : null
  const argv = ciOverride !== null && Array.isArray(ciOverride.argv) ? ciOverride.argv : (Array.isArray(g.argv) ? g.argv : null)
  const executable = argv === null ? '' : argv.join(' ')
  const placeholder = (executable.match(/<[^>]*>/) || [])[0]
  if (argv === null || argv.length === 0) {
    return base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'field-absent' }, missing: [g.argvProblem === undefined ? 'argv' : g.argvProblem], path: 'UNRESOLVED', next: 'declare ONE executable command for this row (split the prose cell, or give the row an argv with a value source for every placeholder)', evidence: MANIFEST + ':' + g.id + ' declares no argv' + (g.argvProblem === undefined ? '' : ' (' + g.argvProblem + ')') })
  }
  if (placeholder !== undefined) {
    return base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'field-absent' }, missing: [placeholder], path: 'UNRESOLVED', next: 'declare the placeholder value in the gate table (or register an args[] source) so the command is executable', evidence: MANIFEST + ':' + g.id + ' cmd contains ' + placeholder })
  }
  if (argv[0].startsWith('-')) {
    return base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'field-absent' }, missing: ['argv[0]'], path: 'UNRESOLVED', next: 'name a script as argv[0] (a bare flag is not a command) or register the step explicitly', evidence: MANIFEST + ':' + g.id + ' argv[0]=' + String(argv[0]) })
  }
  const blocked = await evaluateRequires(g)
  if (blocked !== null) {
    return base(g, { verdict: blocked.decision.verdict, criterionEvaluated: blocked.decision.criterionEvaluated, cause: blocked.decision.cause, missing: blocked.decision.missing, path: String(blocked.req.path ?? blocked.req.script), next: blocked.decision.next, evidence: blocked.decision.evidence })
  }
  if (g.localSafe === false && !process.env.CI) {
    return base(g, { verdict: 'skipped', criterionEvaluated: false, cause: { kind: 'field-absent' }, missing: [g.localSafeReason || 'CI-shaped command'], path: 'UNRESOLVED' })
  }
  if (g.tree === 'overlay' && !existsSync(overlayRoot)) {
    return base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'artifact-absent' }, missing: [overlayRoot], path: overlayRoot, next: 'clone the overlay tree or pass --overlay <path>', evidence: 'overlay root missing: ' + overlayRoot })
  }
  const cwd = ciOverride !== null && typeof ciOverride.cwd === 'string'
    ? resolve(g.tree === 'overlay' ? overlayRoot : FAMILY_CHECKOUT, ciOverride.cwd)
    : (g.tree === 'overlay' ? overlayRoot : FAMILY_CHECKOUT)
  const gateEnv = ciOverride !== null && ciOverride.env !== undefined
    ? Object.fromEntries(Object.entries(ciOverride.env).map(([key, value]) => [key, expandEnv(value)]))
    : undefined
  // the declared argv names the command as the table writes it (`node <script> ...`); the runner
  // always spawns through process.execPath, so the leading token is dropped here.
  const declaredArgv = argv[0] === 'node' ? argv.slice(1) : argv
  const [script, ...rest] = declaredArgv.map((token) => resolveLayoutToken(ciOverride === null ? token : expandEnv(token), g.tree, cwd))
  // A gate that never returns must not stop the whole local chain: budget it, and let the verdict
  // read cannot-decide (killedBy=budget) instead of hanging the runner forever. The row may declare
  // its own budget (`timeoutMs`) because a full suite and a linter do not share one number.
  const budgetMs = g.timeoutMs === undefined ? 180000 : g.timeoutMs
  const observed = await runner.run([process.execPath, script, ...rest], { cwd, timeoutMs: budgetMs, env: gateEnv === undefined ? process.env : { ...process.env, ...gateEnv } })
  const ms = observed.ms
  const status = observed.status === undefined ? null : observed.status
  if (observed.stdout !== undefined && observed.stdout !== '' && (status !== 0 || status === null)) process.stdout.write(observed.stdout)
  if (observed.stderr !== undefined && observed.stderr !== '' && (status !== 0 || status === null)) process.stderr.write(observed.stderr)
  const scriptPath = script.startsWith('-') ? null : resolve(cwd, script)
  if (scriptPath !== null && !existsSync(scriptPath)) return base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'artifact-absent' }, subject: { kind: 'paths', count: 1 }, path: cwd, ms, missing: [script], next: 'the declared script is not on disk - fix the row, or register this check as cannot-decide on this machine', evidence: script + ' absent' })
  if (observed.killedBy === 'budget' || observed.errorCode === 'ETIMEDOUT') return base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'timeout' }, subject: { kind: 'paths', count: 1 }, path: cwd, ms, missing: [], next: 'the gate ran past its ' + String(budgetMs) + ' ms budget - run it on the build line, or register it as cannot-decide on this machine', evidence: script + ' killed at the ' + String(budgetMs) + ' ms budget' })
  if (status === 0) return base(g, { verdict: 'pass', criterionEvaluated: true, subject: { kind: 'paths', count: 1 }, path: cwd, ms })
  if (status === 2) {
    // The family's CLI convention is 0 = pass / 1 = fail / 2 = CANNOT DECIDE. Collapsing 2 into
    // fail makes a missing input read as a violated invariant.
    const childLine = String(observed.stderr ?? '') + String(observed.stdout ?? '')
    const line = childLine.split('\n').map((entry) => entry.trim()).find((entry) => /CANNOT DECIDE|cannot decide/i.test(entry))
    return base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'artifact-absent' }, subject: { kind: 'paths', count: 1 }, path: cwd, ms, missing: [], next: 'the check reported CANNOT DECIDE: read its own line above (it names the input that is not there) - supply that input or register the check as cannot-decide on this machine', evidence: script + ' exit=2' + (line === undefined ? '' : ' :: ' + line) })
  }
  return base(g, { verdict: 'fail', criterionEvaluated: true, cause: { kind: 'non-zero-exit' }, subject: { kind: 'paths', count: 1 }, path: cwd, ms, next: 'read the failing script output above, then fix the gate or the tree it judges', evidence: script + ' exit=' + status })
}

const tasks = list.map((g) => ({
  id: g.id,
  needs: Array.isArray(g.needs) ? g.needs : [],
  after: Array.isArray(g.after) ? g.after : [],
  execute: () => executeGate(g),
}))
const byId = new Map(list.map((g) => [g.id, g]))
if (concurrency > 1) console.log('run-gates [' + profile + (laneName === undefined ? '' : ' lane=' + laneName) + '] concurrency=' + concurrency + (failFast ? ' fail-fast' : ''))
const outcomes = await runTasks({
  tasks,
  concurrency,
  failFast,
  onStatus: (outcome) => {
    if (concurrency > 1 && outcome.status === 'done') console.log('  [done] ' + outcome.id.padEnd(18) + String(outcome.record.verdict).padEnd(14) + String(outcome.record.ms ?? '-') + 'ms')
  },
})
const records = list.map((g) => {
  const outcome = outcomes.get(g.id)
  if (outcome === undefined) return base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'filter-no-match' }, missing: ['outcome'], path: 'UNRESOLVED' })
  if (outcome.status === 'done') return outcome.record
  if (outcome.status === 'error') return base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'internal-error' }, missing: [String(outcome.error ?? 'error')], path: 'UNRESOLVED', next: 'the gate executor threw before producing a verdict; fix the runner (an exception is not a check failure)', evidence: String(outcome.error ?? 'unknown error') })
  if (outcome.status === 'blocked') return base(g, { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'prerequisite-blocked' }, missing: outcome.deps ?? [], path: 'UNRESOLVED', next: 'a declared prerequisite did not pass; this row was not executed', evidence: 'blocked by ' + String((outcome.deps ?? []).join(', ')) })
  return base(g, { verdict: 'skipped', criterionEvaluated: false, cause: { kind: 'fail-fast' }, missing: ['fail-fast'], path: 'UNRESOLVED', next: 'fail-fast stopped the run before this row started (skipped is not a pass)' })
})

// A profile that selects nothing is NOT a pass (plan step 3's vacuum fixture): the run would
// otherwise print pass=0 fail=0 and exit 0, which is exactly the F=0 shape this redesign hunts.
if (records.length === 0) {
  records.push({
    id: 'profile:' + profile,
    check: 'run-gates ' + profile,
    criterion: 'profiles',
    lanes: [],
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

const familyVersionValue = familyVersion(join(HERE, '..'))
// W9-gates §3.1: "cannot decide" is a debt with an owner, not a permanent red.
const unregisteredCannotDecide = records
  .filter((record) => record.verdict === 'cannot-decide')
  .filter((record) => {
    const registration = (manifest.gates.find((row) => row.id === record.id) ?? {}).registration
    return registration === undefined || exemptionProblems(registration, familyVersionValue).length > 0
  })
const c = counts(records)
const violations = records.flatMap((r) => validate(r, r.id))
const payload = { schema: 1, profile, lane: laneName ?? null, concurrency, counts: c, gates: records, violations }
if (jsonOut !== undefined) {
  const target = resolve(jsonOut)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(payload, null, 2) + '\n')
  if (!has('--json')) console.error('run-gates: wrote lane artifact ' + target)
}
if (has('--json')) {
  console.log(JSON.stringify(payload, null, 2))
} else {
  for (const r of records) { console.log(render(r)); for (const l of actionBlock(r)) console.log(l) }
  console.log('run-gates [' + profile + (laneName === undefined ? '' : ' lane=' + laneName) + '] counts: pass=' + c.pass + ' fail=' + c.fail + ' cannotDecide=' + c.cannotDecide + '(registered=' + (c.cannotDecide - unregisteredCannotDecide.length) + ', unregistered=' + unregisteredCannotDecide.length + ')' + ' skipped=' + c.skipped)
  const timed = records.filter((r) => typeof r.ms === 'number' && r.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 10)
  if (timed.length > 0) {
    console.log('run-gates [' + profile + '] slowest gates (ms):')
    for (const r of timed) console.log('  ' + String(r.ms).padStart(7) + 'ms  ' + r.id.padEnd(18) + r.verdict)
  }
}
const contractViolations = violations
if (contractViolations.length > 0) console.error('run-gates: record contract violations (exit ' + EXIT.contract + '): ' + contractViolations.slice(0, 3).join(' | '))
process.exit(exitCodeFor({ counts: c, violations: contractViolations, unregisteredCannotDecide: unregisteredCannotDecide.length }))
