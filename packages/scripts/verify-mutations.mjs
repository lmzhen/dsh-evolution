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
if (json) console.log(JSON.stringify({ schema: 1, gates: gates.length, counts, entries }, null, 2))
else {
  console.log('verify-mutations --coverage: ' + gates.length + ' gate(s): recorded=' + counts.recorded + ' cannotDecide=' + counts.cannotDecide + ' redProven=' + counts.redProven)
  const missing = entries.filter((e) => e.status === 'cannot-decide')
  for (const entry of missing.slice(0, 8)) console.log('  - ' + entry.id + ': ' + entry.why)
  if (missing.length > 8) console.log('  ... ' + (missing.length - 8) + ' more')
  console.log('verify-mutations: the --only (patch/run/assert/restore) and --self-test halves are NOT built yet - this run only accounts, so a red-proven count of 0 means NOBODY has proven a check can fail, not that the checks are weak')
}
process.exit(counts.cannotDecide > 0 ? 2 : 0)
