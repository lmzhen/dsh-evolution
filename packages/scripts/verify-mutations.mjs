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
const entries = []
for (const gate of gates) {
  const list = Array.isArray(records[gate.id]) ? records[gate.id] : []
  const complete = list.length > 0 && list.every((entry) => typeof entry?.expect === 'string' && ['red', 'cannot-decide', 'green'].includes(entry.expect) && typeof entry?.mutate?.file === 'string' && typeof entry?.mutate?.find === 'string' && typeof entry?.mutate?.replace === 'string')
  entries.push({ id: gate.id, records: list.length, status: complete ? 'recorded' : 'cannot-decide', why: complete ? '' : (list.length === 0 ? 'no mutation record' : 'a record is missing expect|mutate.file|mutate.find|mutate.replace') })
}
const counts = {
  recorded: entries.filter((e) => e.status === 'recorded').length,
  cannotDecide: entries.filter((e) => e.status === 'cannot-decide').length,
  redProven: entries.filter((e) => e.status === 'recorded' && (records[e.id] ?? []).some((r) => r.expect === 'red')).length,
}
const accountWanted = process.argv.includes('--coverage') || (!process.argv.includes('--only') && !process.argv.includes('--self-test'))
if (json && accountWanted) console.log(JSON.stringify({ schema: 1, gates: gates.length, counts, entries }, null, 2))
else if (accountWanted) {
  console.log('verify-mutations --coverage: ' + gates.length + ' gate(s): recorded=' + counts.recorded + ' cannotDecide=' + counts.cannotDecide + ' redProven=' + counts.redProven)
  const missing = entries.filter((e) => e.status === 'cannot-decide')
  for (const entry of missing.slice(0, 8)) console.log('  - ' + entry.id + ': ' + entry.why)
  if (missing.length > 8) console.log('  ... ' + (missing.length - 8) + ' more')
  console.log('verify-mutations: a red-proven count of 0 means NOBODY has proven a check can fail - not that the checks are weak. Fill checkMutations in the checks fact, then prove each record with --only <id>')
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
  const occurrences = before.split(record.mutate.find).length - 1
  if (occurrences !== 1) return { status: 'PATCH NOT UNIQUE', detail: record.mutate.file + ': find occurs ' + occurrences + ' time(s)' }
  const equalValue = record.mutate.find === record.mutate.replace
  const cwd = gate.tree === 'overlay' ? resolvePath(HERE, '..', '..', '..', 'deepseek-harness') : resolvePath(HERE, '..', '..')
  try {
    writeBytes(file, before.replace(record.mutate.find, record.mutate.replace))
    const child = spawnSync(process.execPath, argv[0] === 'node' ? argv.slice(1) : argv, { cwd, encoding: 'utf8' })
    const actual = VERDICT_OF_EXIT[child.status ?? 1] ?? 'red'
    const expected = record.expect
    if (equalValue) return { status: 'NOT PROVEN RED', detail: id + ': the mutation is an EQUAL-VALUE patch, so nothing changed and nothing can be proven' }
    if (actual !== expected) return { status: expected === 'green' ? 'UNEXPECTEDLY-' + actual.toUpperCase() : 'NOT PROVEN ' + expected.toUpperCase(), detail: id + ': expected ' + expected + ', the check returned ' + actual }
    return { status: 'PROVEN ' + expected.toUpperCase(), detail: id + ': expected ' + expected + ' and got it' }
  } finally {
    writeBytes(file, before)
    const afterSha = sha256(readBytes(file, 'utf8'))
    if (afterSha !== beforeSha) {
      results.push({ id, status: 'RESTORE FAILED', detail: record.mutate.file + ' was not restored byte-for-byte' })
    }
  }
}
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
  const failed = results.filter((r) => !r.status.startsWith('PROVEN'))
  console.log('verify-mutations --only: ' + results.length + ' record(s), ' + (results.length - failed.length) + ' proven, ' + failed.length + ' not')
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
