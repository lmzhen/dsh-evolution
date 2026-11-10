#!/usr/bin/env node
/**
 * Assemble the release-evidence acceptance planes (W2/W3/W10/W11).
 *
 * prepare-release writes the schema-2 skeleton; this script merges the REHEARSAL readings that
 * belong to the run that produced them:
 *   --rehearsal <json>  { spikes[], gates[], traceability } recorded by the pre-tag rehearsal
 *   --ci-face / --os CI identity injected by the workflow (never guessed here)
 * then validates the result. `--release` applies the publish-time gate, so a tagging run fails
 * BEFORE the publish job when any plane is missing or a spike is not a pass.
 *
 * Usage:
 *   node packages/evolution/scripts/assemble-release-evidence.mjs <dist/release-evidence.json>
 *     --rehearsal <release-evidence-inputs.json> [--ci-face <ref>] [--os <os>] [--release] [--check]
 * Exit: 0 written/valid · 1 violation · 2 cannot decide (missing/unreadable inputs).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { validateReleaseEvidence } from './lib-release-evidence.mjs'
import { familyVersion } from './lib-family-version.mjs'

const argv = process.argv.slice(2)
const flag = (name) => { const index = argv.indexOf(name); const value = index >= 0 ? argv[index + 1] : undefined; return value !== undefined && !value.startsWith('--') ? value : '' }
// P2-39: a positional is any token that is neither a flag nor the VALUE of a
// value-taking flag. The previous list missed --gates-from-manifest, so a
// flags-first invocation read its profile ("ci") as the evidence path.
const VALUE_FLAGS = new Set(['--rehearsal', '--ci-face', '--os', '--gates-from-manifest', '--gates-report', '--commit', '--tag', '--version'])
const file = argv.find((arg, index) => !arg.startsWith('--') && !VALUE_FLAGS.has(argv[index - 1]))
const rehearsalPath = flag('--rehearsal')
const ciFace = flag('--ci-face') || process.env.GITHUB_WORKFLOW_REF || ''
const os = flag('--os') || process.env.RUNNER_OS || ''
const gatesFromManifest = flag('--gates-from-manifest')
const gatesReport = flag('--gates-report')
const commit = flag('--commit')
const tag = flag('--tag')
const version = (flag('--version') || process.env.RELEASE_VERSION || '').replace(/^v/, '')
const release = argv.includes('--release')
const check = argv.includes('--check')
if (file === undefined || file === '') { console.error('assemble-release-evidence: usage: <release-evidence.json> --rehearsal <inputs.json> [--ci-face <ref>] [--os <os>] [--gates-report <run-gates.json>] [--commit <sha>] [--tag <v...>] [--release] [--check]'); process.exit(2) }
const evidencePath = resolve(file)
if (!existsSync(evidencePath)) { console.error('assemble-release-evidence: no staging evidence at ' + evidencePath + ' (cannot decide)'); process.exit(2) }
let evidence
try { evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) } catch (error) { console.error('assemble-release-evidence: unreadable evidence (' + (error instanceof Error ? error.message : String(error)) + ')'); process.exit(2) }
let rehearsal = { spikes: [], gates: [], traceability: null }
if (rehearsalPath !== '') {
  if (!existsSync(resolve(rehearsalPath))) { console.error('assemble-release-evidence: no rehearsal snapshot at ' + resolve(rehearsalPath) + ' (cannot decide)'); process.exit(2) }
  try { rehearsal = JSON.parse(readFileSync(resolve(rehearsalPath), 'utf8')) } catch (error) { console.error('assemble-release-evidence: unreadable inputs (' + (error instanceof Error ? error.message : String(error)) + ')'); process.exit(2) }
}
const problems = []
let gates = Array.isArray(rehearsal.gates) ? rehearsal.gates : []
// W3: the CI gate ledger is the set of manifest rows this run's compat-check job executed — the
// step that writes the evidence runs only after the whole guard chain passed, so each row's
// reading names the producing job instead of inventing a per-command transcript.
if (gatesReport !== '') {
  try {
    const report = JSON.parse(readFileSync(resolve(gatesReport), 'utf8'))
    const rows = Array.isArray(report) ? report : Array.isArray(report.gates) ? report.gates : []
    gates = rows.map((row) => ({ id: String(row.id ?? row.subject ?? 'unknown'), ok: row.verdict === undefined ? row.ok === true : row.verdict === 'pass', reading: String(row.reading ?? row.detail ?? row.verdict ?? ''), ...(row.criterionEvaluated === true ? { criterionEvaluated: true } : {}) }))
  } catch (error) {
    problems.push('gate report could not be read for --gates-report: ' + (error instanceof Error ? error.message : String(error)))
  }
} else if (gatesFromManifest !== '') {
  const scriptsDir = dirname(fileURLToPath(import.meta.url))
  try {
    const manifest = JSON.parse(readFileSync(join(scriptsDir, 'gate-manifest.json'), 'utf8'))
    gates = (manifest.gates ?? [])
      .filter((gate) => Array.isArray(gate.profiles) && gate.profiles.includes(gatesFromManifest))
      .map((gate) => ({ id: gate.id, ok: true, synthetic: true, reading: 'compat-check job passed (guards ran before this evidence step)' }))
  } catch (error) {
    problems.push('gate-manifest.json could not be read for --gates-from-manifest: ' + (error instanceof Error ? error.message : String(error)))
  }
}
if (!Array.isArray(rehearsal.spikes) || rehearsal.spikes.length === 0) problems.push('rehearsal.spikes must carry the S1-S4 rehearsal evidence')
if (gates.length === 0 && gatesFromManifest === '') problems.push('rehearsal.gates must carry the rehearsal gate readings (or pass --gates-from-manifest <profile>)')
if (rehearsal.traceability === undefined || rehearsal.traceability === null) problems.push('rehearsal.traceability must carry the W11 reading')
const assembled = {
  ...evidence,
  spikes: Array.isArray(rehearsal.spikes) ? rehearsal.spikes : evidence.spikes,
  gates: gates.length > 0 ? gates : evidence.gates,
  traceability: rehearsal.traceability ?? evidence.traceability,
  faces: rehearsal.faces ?? evidence.faces,
  ciFace: ciFace === '' ? evidence.ciFace : { os: os === '' ? 'unknown' : os, workflowRef: ciFace },
  ...(commit === '' ? {} : { commit }),
  ...(tag === '' ? {} : { tag }),
  ...(release ? { evidenceStatus: 'measured', generatedAt: new Date().toISOString() } : {}),
}
const expectedFamilyVersion = release ? (version !== '' ? version : familyVersion(resolve(dirname(fileURLToPath(import.meta.url)), '..'))) : null
problems.push(...validateReleaseEvidence(assembled, { release, ...(expectedFamilyVersion === null ? {} : { expectedFamilyVersion }), ...(release ? { maxAgeMs: 7 * 24 * 60 * 60 * 1000 } : {}), ...(commit === '' ? {} : { expectedCommit: commit }), ...(tag === '' ? {} : { expectedTag: tag }) }))
if (release && (expectedFamilyVersion === null || expectedFamilyVersion === undefined || expectedFamilyVersion === '')) problems.push('release: --version (or a readable family tree) is required')
if (problems.length > 0) { for (const problem of problems) console.error('  - ' + problem); console.error('assemble-release-evidence: ' + problems.length + ' problem(s)'); process.exit(1) }
if (!check) writeFileSync(evidencePath, JSON.stringify(assembled, null, 2) + '\n')
console.log('assemble-release-evidence: ' + (check ? 'checked' : 'wrote') + ' ' + evidencePath + ' (spikes ' + assembled.spikes.length + ', gates ' + assembled.gates.length + ', traceability ' + (assembled.traceability === null ? 'none' : String(assembled.traceability.covered) + '/' + String(assembled.traceability.total)) + ')')
