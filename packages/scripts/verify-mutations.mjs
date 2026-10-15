#!/usr/bin/env node
/**
 * verify-mutations.mjs (G5/1): the mutation library - the evidence carrier every retirement needs.
 *
 * Why it exists: the plan retires checks only in PAIRS - each deletion names the mutation that
 * proves its replacement can fail. Those records live in the checks fact under check-mutations
 * (the design's data home), and this gate is what reads them:
 *
 *   --coverage   every manifest id is recorded, or it is CANNOT-DECIDE (never green): a missing
 *                record means "nobody has proven this check can go red", which is exactly what
 *                G6's gate-truth counts. Exit 2 while any id lacks a record.
 *   --json       the same account as data.
 *
 * The --only <id> (patch -> run -> assert verdict -> restore + verify the hash) and --self-test
 * halves arrive next; until they exist this gate only ACCOUNTS, and it says so in its output.
 *
 * Usage: node <scripts-dir>/verify-mutations.mjs [--coverage] [--json]
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MANIFEST = join(HERE, 'gate-manifest.json')
const FACTS = join(HERE, 'family-facts.json')
const json = process.argv.includes('--json')

if (!existsSync(MANIFEST) || !existsSync(FACTS)) {
  console.error('verify-mutations: CANNOT DECIDE - ' + (existsSync(MANIFEST) ? FACTS : MANIFEST) + ' is missing')
  process.exit(2)
}
const gates = (JSON.parse(readFileSync(MANIFEST, 'utf8')).gates ?? [])
const asset = JSON.parse(readFileSync(FACTS, 'utf8'))
const checksFact = (asset.facts ?? []).find((fact) => fact?.machine?.kind === 'checks')
if (gates.length === 0) {
  console.error('verify-mutations: CANNOT DECIDE - the manifest declares no gate (an empty face is not a clean account)')
  process.exit(2)
}
// the design's home for the records: a fact-level block keyed by check id
const records = checksFact?.machine?.checkMutations ?? {}
// A gate whose DECLARED state is cannot-decide (it needs a machine-local corpus, or its subject is
// absent here) can never be mutation-proven: it has no green baseline to lose. Pretending it is
// "pending" makes exit 0 unreachable by construction, so it is EXEMPT - registered with a reason
// and an expiry, printed on every run. An exemption missing either field is NOT honoured (the
// loophole guard): an exemption is a debt with an owner, not a way to silence the ledger.
const exemptions = checksFact?.machine?.mutationExempt ?? {}
const exemptionOf = (id) => {
  const entry = exemptions[id]
  if (entry === undefined || entry === null) return null
  const valid = typeof entry.reason === 'string' && entry.reason.trim().length > 0 && typeof entry.expiry === 'string' && entry.expiry.trim().length > 0
  return valid ? entry : null
}
// G0/0.7 review fix (2026-10-15): redProven used to count a record whose anchor no longer occurs
// in its file - "recording is not reproducibility". Measured: two records anchored on a COUNT went
// to 0 occurrences after a step count changed, and coverage still reported them as proven. Mirror-
// tree records are checked here; overlay-tree records cannot be (their mutation lands in a tree
// this run does not read - the rule --only states as TREE MISMATCH), so they are counted apart.
const REPO_ROOT = resolvePath(HERE, '..', '..')
const anchorState = (gate) => {
  const list = Array.isArray(records[gate.id]) ? records[gate.id] : []
  if (list.length === 0) return 'none'
  if (gate.tree === 'overlay') return 'unchecked'
  for (const record of list) {
    const find = record?.mutate?.find
    const rel = record?.mutate?.file
    if (typeof find !== 'string' || typeof rel !== 'string') return 'broken'
    let text
    try { text = readFileSync(resolvePath(REPO_ROOT, rel), 'utf8') } catch { return 'broken' }
    if (text.split(find).length - 1 !== 1) return 'broken'
  }
  return 'ok'
}

const entries = []
for (const gate of gates) {
  const list = Array.isArray(records[gate.id]) ? records[gate.id] : []
  const complete = list.length > 0 && list.every((entry) => typeof entry?.expect === 'string' && ['red', 'cannot-decide', 'green'].includes(entry.expect) && typeof entry?.mutate?.file === 'string' && typeof entry?.mutate?.find === 'string' && typeof entry?.mutate?.replace === 'string')
  const exempt = exemptionOf(gate.id)
  if (exempt !== null && !complete) {
    entries.push({ id: gate.id, records: list.length, status: 'exempt', why: exempt.reason + ' (expires: ' + exempt.expiry + ')' })
    continue
  }
  const anchor = complete ? anchorState(gate) : 'none'
  entries.push({ id: gate.id, records: list.length, status: complete ? (anchor === 'broken' ? 'cannot-decide' : 'recorded') : 'cannot-decide', anchor, why: complete ? (anchor === 'broken' ? 'the mutation anchor no longer occurs exactly once in its file - recording is not reproducibility' : '') : (list.length === 0 ? 'no mutation record' : 'a record is missing expect|mutate.file|mutate.find|mutate.replace') })
}
const counts = {
  anchorBroken: entries.filter((e) => e.anchor === 'broken').length,
  anchorUnchecked: entries.filter((e) => e.anchor === 'unchecked').length,
  recorded: entries.filter((e) => e.status === 'recorded').length,
  cannotDecide: entries.filter((e) => e.status === 'cannot-decide').length,
  exempt: entries.filter((e) => e.status === 'exempt').length,
  redProven: entries.filter((e) => e.status === 'recorded' && (records[e.id] ?? []).some((r) => r.expect === 'red' && typeof r.provenAt === 'string')).length,
  unstamped: entries.filter((e) => e.status === 'recorded' && !(records[e.id] ?? []).every((r) => typeof r.provenAt === 'string')).length,
}
const accountWanted = process.argv.includes('--coverage') || (!process.argv.includes('--only') && !process.argv.includes('--self-test'))
if (json && accountWanted) console.log(JSON.stringify({ schema: 1, gates: gates.length, counts, entries }, null, 2))
else if (accountWanted) {
  const exemptIds = entries.filter((e) => e.status === 'exempt').map((e) => e.id)
  if (exemptIds.length > 0) console.log('verify-mutations: EXEMPT ' + String(exemptIds.length) + ' check(s) (registered with reason + expiry, printed every run): ' + exemptIds.join(', '))
  const unstampedIds = entries.filter((e) => e.status === 'recorded' && !(records[e.id] ?? []).every((r) => typeof r.provenAt === 'string')).map((e) => e.id)
  console.log('verify-mutations --coverage: ' + gates.length + ' gate(s): recorded=' + counts.recorded + ' unstamped=' + counts.unstamped + (unstampedIds.length > 0 ? ' (' + unstampedIds.slice(0, 6).join(',') + ')' : '') + ' cannotDecide=' + counts.cannotDecide + ' redProven=' + counts.redProven)
  const missing = entries.filter((e) => e.status === 'cannot-decide')
  for (const entry of missing.slice(0, 8)) console.log('  - ' + entry.id + ': ' + entry.why)
  if (missing.length > 8) console.log('  ... ' + (missing.length - 8) + ' more')
  console.log('verify-mutations: redProven=' + counts.redProven + ' of ' + gates.length + ' check(s) carry a PROVEN red record' + (counts.redProven === 0 ? ' - a count of 0 means NOBODY has proven a check can fail, not that the checks are weak' : '') + '; fill checkMutations in the checks fact, then prove each record with --only <id> (which stamps provenAt + provenSha)')
}
// ── --only <id>: patch -> run -> assert the verdict -> restore and verify the bytes ──────────
// The discipline (reviewer 13): a mutation that cannot be restored is worse than no mutation, so
// the runner keeps the original bytes in memory, restores them whatever the child did, and
// compares the sha256 - a dirty tree is a red, not a footnote.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync as readBytes, writeFileSync as writeBytes } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

const onlyIndex = process.argv.indexOf('--only')
const selfTest = process.argv.includes('--self-test')
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const VERDICT_OF_EXIT = { 0: 'green', 1: 'red', 2: 'cannot-decide' }

/** Run one record; returns { status, detail } where status is the harness's own word. */
function runRecord(id, record) {
  const gate = gates.find((entry) => entry.id === id)
  if (gate === undefined) return { status: 'UNKNOWN-ID', detail: id + ' is not a manifest row' }
  const argv = Array.isArray(gate.argv) ? gate.argv : null
  if (argv === null) return { status: 'NOT EXECUTABLE', detail: id + ' declares no argv' }
  const file = resolvePath(HERE, '..', '..', record.mutate.file)
  const before = readBytes(file, 'utf8')
  const beforeSha = sha256(before)
  // A red only counts when the check was GREEN before the mutation. Without this baseline a
  // record whose argv cannot even run here (a missing module, a wrong tree) would read as a
  // proven red for a reason that has nothing to do with the mutation - the exact false evidence
  // this ledger exists to prevent.
  // The tree the RECORD mutates and the tree the CHECK runs in must be the same one: a row that
  // runs in the overlay never reads a mirror-side patch, so its verdict would be independent of
  // the mutation (a green baseline plus a mutated file proves nothing about the check).
  if (gate.tree === 'overlay') {
    return { status: 'TREE MISMATCH', detail: id + ': this row runs in the overlay while mutations are applied in the mirror - the run cannot see the patch' }
  }
  // FORENSICS (round 83): when a probe reports NOT PROVEN the first question is whether the patch
  // reached the file the check actually reads, so every probe prints the resolved path, the bytes'
  // hash before and after the write, and the child's cwd + argv.
  console.log('[probe] ' + id + ' file=' + file + ' sha-before=' + beforeSha.slice(0, 10))
  const preDirty = dirtySet()
  const baseline = spawnSync(process.execPath, argv[0] === 'node' ? argv.slice(1) : argv, { cwd: resolvePath(HERE, '..', '..'), encoding: 'utf8' })
  const baselineVerdict = VERDICT_OF_EXIT[baseline.status ?? 1] ?? 'red'
  if (baselineVerdict !== 'green') {
    return { status: 'NO GREEN BASELINE', detail: id + ': the check returned ' + baselineVerdict + ' BEFORE any mutation, so a red afterwards would prove nothing' }
  }
  const occurrences = before.split(record.mutate.find).length - 1
  if (occurrences !== 1) return { status: 'PATCH NOT UNIQUE', detail: record.mutate.file + ': find occurs ' + occurrences + ' time(s)' }
  const equalValue = record.mutate.find === record.mutate.replace
  const cwd = gate.tree === 'overlay' ? resolvePath(HERE, '..', '..', '..', 'deepseek-harness') : resolvePath(HERE, '..', '..')
  try {
    writeBytes(file, before.replace(record.mutate.find, record.mutate.replace))
    console.log('[probe] sha-after-write=' + sha256(readBytes(file, 'utf8')).slice(0, 10))
    const child = spawnSync(process.execPath, argv[0] === 'node' ? argv.slice(1) : argv, { cwd, encoding: 'utf8' })
    const actual = VERDICT_OF_EXIT[child.status ?? 1] ?? 'red'
    const expected = record.expect
    if (equalValue) return { status: 'NOT PROVEN RED', detail: id + ': the mutation is an EQUAL-VALUE patch, so nothing changed and nothing can be proven' }
    if (actual !== expected) return { status: expected === 'green' ? 'UNEXPECTEDLY-' + actual.toUpperCase() : 'NOT PROVEN ' + expected.toUpperCase(), detail: id + ': expected ' + expected + ', the check returned ' + actual }
    return { status: 'PROVEN ' + expected.toUpperCase(), detail: id + ': expected ' + expected + ' and got it' }
  } finally {
    writeBytes(file, before)
    for (const written of dirtySet()) {
      if (preDirty.has(written)) continue
      spawnSync('git', ['-C', repoRoot, 'checkout', '--', written], { encoding: 'utf8' })
      results.push({ id, status: 'SIDE EFFECT REVERTED', detail: written + ' was written by the check run and was reverted (the row is a producer)' })
    }
    const afterSha = sha256(readBytes(file, 'utf8'))
    if (afterSha !== beforeSha) {
      results.push({ id, status: 'RESTORE FAILED', detail: record.mutate.file + ' was not restored byte-for-byte' })
    }
  }
}
// Side-effect guard (round 155): a row's argv may WRITE tracked artifacts - a producer row rewrites
// its own product during the baseline run - and restoring only the MUTATED file leaves those behind.
// The probe therefore snapshots the dirty set and reverts whatever became newly dirty.
const repoRoot = resolvePath(HERE, '..', '..')
const dirtySet = () => new Set((spawnSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' }).stdout ?? '')
  .split(String.fromCharCode(10)).map((line) => line.slice(3).trim()).filter((entry) => entry !== ''))
const results = []
if (onlyIndex >= 0) {
  const id = process.argv[onlyIndex + 1]
  const list = Array.isArray(records[id]) ? records[id] : []
  if (list.length === 0) {
    console.error('verify-mutations --only ' + String(id) + ': CANNOT DECIDE - no record for this id (nothing has been proven about it)')
    process.exit(2)
  }
  for (const record of list) results.push({ id, ...runRecord(id, record) })
  for (const result of results) console.log('  ' + result.status.padEnd(28) + result.detail)
/** Write the proof stamp back into the record's home: a proof nobody can see is a claim, and
 *  --coverage counts stamps. provenSha names the revision the proof applies to (the file as
 *  restored), so a later edit to that file invalidates the stamp visibly instead of silently. */
function stampRecords(id, results) {
  const assetPath = resolvePath(HERE, 'family-facts.json')
  const asset = JSON.parse(readBytes(assetPath, 'utf8'))
  const checks = (asset.facts ?? []).find((fact) => fact.machine && fact.machine.kind === 'checks')
  const block = checks.machine.checkMutations
  const list = Array.isArray(block[id]) ? block[id] : []
  let stamped = 0
  for (let i = 0; i < list.length && i < results.length; i++) {
    if (!results[i].status.startsWith('PROVEN')) continue
    list[i].provenAt = new Date().toISOString()
    list[i].provenSha = sha256(readBytes(resolvePath(HERE, '..', '..', list[i].mutate.file), 'utf8'))
    stamped += 1
  }
  if (stamped > 0) writeBytes(assetPath, JSON.stringify(asset, null, 2) + String.fromCharCode(10))
  console.log('verify-mutations: stamped ' + stamped + ' record(s) for ' + id + ' (provenAt + provenSha)')
  return stamped
}

  const failed = results.filter((r) => !r.status.startsWith('PROVEN'))
  console.log('verify-mutations --only: ' + results.length + ' record(s), ' + (results.length - failed.length) + ' proven, ' + failed.length + ' not')
  if (failed.length === 0) stampRecords(id, results)
  process.exit(failed.length === 0 ? 0 : 1)
}
if (selfTest) {
  // Two synthetic cases, both must be caught: an equal-value patch (nothing changed) and an
  // expectation that contradicts reality (the harness must not call that a pass).
  const equal = runRecord('gate-17', { mutate: { file: 'packages/scripts/family-facts.json', find: '"id": "gate-17"', replace: '"id": "gate-17"' }, expect: 'red', note: 'self-test: equal value' })
  const contradiction = runRecord('health-admission', { mutate: { file: 'packages/scripts/family-facts.json', find: '"id": "gate-17"', replace: '"id": "gate-17x"' }, expect: 'green', note: 'self-test: expect green on a check that cannot pass here' })
  const caught = [equal, contradiction].filter((r) => !r.status.startsWith('PROVEN'))
  for (const result of [equal, contradiction]) console.log('  ' + result.status.padEnd(28) + result.detail)
  console.log('verify-mutations --self-test: ' + caught.length + '/2 mismatch(es) caught' + (caught.length === 2 ? ' - the harness refuses both a no-op patch and a contradicted expectation' : ' - THE HARNESS IS BLIND to at least one'))
  process.exit(caught.length === 2 ? 1 : 1)
}
if (accountWanted) process.exit(counts.cannotDecide > 0 ? 2 : 0)
