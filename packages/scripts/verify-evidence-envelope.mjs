#!/usr/bin/env node
/**
 * Validate one EvidenceEnvelope, or run the schema self-test.
 *
 * Usage:
 *   node packages/scripts/verify-evidence-envelope.mjs <envelope.json>
 *   node packages/scripts/verify-evidence-envelope.mjs --self-test
 * Exit: 0 pass · 1 violation · 2 cannot decide.
 */
import { existsSync, readFileSync } from 'node:fs'
import { EVIDENCE_ENVELOPE_SCHEMA_VERSION, validateEvidenceEnvelope } from './lib-release-evidence.mjs'

const argv = process.argv.slice(2)
const selfTest = argv.includes('--self-test')
const valid = {
  schemaVersion: EVIDENCE_ENVELOPE_SCHEMA_VERSION,
  kind: 'release',
  familyVersion: '0.0.0-test',
  artifactSha256: 'a'.repeat(64),
  commit: 'abcdef1',
  tag: 'v0.0.0-test',
  host: { os: 'linux', node: '24', dshVersion: '0.2.1', profile: 'web' },
  inputsSha256: 'b'.repeat(64),
  producer: 'selftest',
  command: 'node --test',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  exitCode: 0,
  results: [{ id: 'r1', verdict: 'pass', criterionEvaluated: true, readings: { ok: true } }],
}
if (selfTest) {
  const problems = []
  if (validateEvidenceEnvelope(valid).length !== 0) problems.push('valid envelope was rejected')
  const unchecked = structuredClone(valid)
  unchecked.results[0].criterionEvaluated = false
  if (validateEvidenceEnvelope(unchecked).length === 0) problems.push('pass without evaluation was accepted')
  const badHash = structuredClone(valid)
  badHash.artifactSha256 = 'not-a-sha'
  if (validateEvidenceEnvelope(badHash).length === 0) problems.push('bad artifact hash was accepted')
  const failed = structuredClone(valid)
  failed.results[0].verdict = 'fail'
  if (validateEvidenceEnvelope(failed).length === 0) problems.push('fail without cause was accepted')
  if (problems.length > 0) { for (const problem of problems) console.error('  - ' + problem); process.exit(1) }
  console.log('verify-evidence-envelope --self-test: OK — 4 case(s) judged as expected')
  process.exit(0)
}
const file = argv.find(arg => !arg.startsWith('--'))
if (file === undefined) { console.error('verify-evidence-envelope: usage: <envelope.json> | --self-test'); process.exit(2) }
if (!existsSync(file)) { console.error('verify-evidence-envelope: no envelope at ' + file + ' (cannot decide)'); process.exit(2) }
let envelope
try { envelope = JSON.parse(readFileSync(file, 'utf8')) } catch (error) { console.error('verify-evidence-envelope: unreadable envelope (' + (error instanceof Error ? error.message : String(error)) + ')'); process.exit(2) }
const problems = validateEvidenceEnvelope(envelope)
if (problems.length > 0) { for (const problem of problems) console.error('  - ' + problem); console.error('verify-evidence-envelope: ' + problems.length + ' problem(s)'); process.exit(1) }
console.log('verify-evidence-envelope: OK — ' + file)
