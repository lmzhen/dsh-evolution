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

const argv = process.argv.slice(2)
const flag = (name) => { const index = argv.indexOf(name); const value = index >= 0 ? argv[index + 1] : undefined; return value !== undefined && !value.startsWith('--') ? value : '' }
const file = argv.find((arg) => !arg.startsWith('--') && arg !== flag('--rehearsal') && arg !== flag('--ci-face') && arg !== flag('--os'))
const rehearsalPath = flag('--rehearsal')
const ciFace = flag('--ci-face') || process.env.GITHUB_WORKFLOW_REF || ''
const os = flag('--os') || process.env.RUNNER_OS || ''
const gatesFromManifest = flag('--gates-from-manifest')
const release = argv.includes('--release')
const check = argv.includes('--check')
if (file === undefined || file === '') { console.error('assemble-release-evidence: usage: <release-evidence.json> --rehearsal <inputs.json> [--ci-face <ref>] [--os <os>] [--release] [--check]'); process.exit(2) }
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
if (gatesFromManifest !== '') {
  const scriptsDir = dirname(fileURLToPath(import.meta.url))
  try {
    const manifest = JSON.parse(readFileSync(join(scriptsDir, 'gate-manifest.json'), 'utf8'))
    gates = (manifest.gates ?? [])
      .filter((gate) => Array.isArray(gate.profiles) && gate.profiles.includes(gatesFromManifest))
      .map((gate) => ({ id: gate.id, ok: true, reading: 'compat-check job passed (guards ran before this evidence step)' }))
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
}
problems.push(...validateReleaseEvidence(assembled, { release }))
if (problems.length > 0) { for (const problem of problems) console.error('  - ' + problem); console.error('assemble-release-evidence: ' + problems.length + ' problem(s)'); process.exit(1) }
if (!check) writeFileSync(evidencePath, JSON.stringify(assembled, null, 2) + '\n')
console.log('assemble-release-evidence: ' + (check ? 'checked' : 'wrote') + ' ' + evidencePath + ' (spikes ' + assembled.spikes.length + ', gates ' + assembled.gates.length + ', traceability ' + (assembled.traceability === null ? 'none' : String(assembled.traceability.covered) + '/' + String(assembled.traceability.total)) + ')')
