#!/usr/bin/env node
/**
 * G7-S1/S2: verify the probe registry (probes.json is the hand-authored source;
 * gate-manifest.probes is the generated artifact every consumer reads).
 *
 * Checks: schema (id/kind/owner/files/mutation/evidence/note), unique ids, existing spec files,
 * existing mutation fixtures, generated==hand-authored, and an EMPTY registry fails loud (exit 2).
 * Usage: node packages/scripts/verify-probes.mjs <packages-root> [--json]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { probeProblems, readProbes } from './lib-probes.mjs'

const root = process.argv[2] ?? 'packages'
const asJson = process.argv.includes('--json')
const problems = []
let probes = []
try { probes = readProbes(root) } catch (error) { problems.push(error.message) }
if (probes.length === 0) {
  console.error('verify-probes: the registry is EMPTY or unreadable — a probe table with nothing in it is a silent gate (exit 2)')
  process.exit(2)
}
problems.push(...probeProblems(root, probes))
// generated artifact must carry the same registry (one hand-authored source).
try {
  const manifest = JSON.parse(readFileSync(join(root, 'scripts', 'gate-manifest.json'), 'utf8'))
  const generated = Array.isArray(manifest.probes) ? manifest.probes : []
  if (JSON.stringify(generated.map((probe) => probe.id).sort()) !== JSON.stringify(probes.map((probe) => probe.id).sort())) {
    problems.push('gate-manifest.probes is out of sync with probes.json — run gen-gate-manifest.mjs')
  }
} catch (error) { problems.push('cannot read gate-manifest.json: ' + (error instanceof Error ? error.message : String(error))) }

if (problems.length > 0) {
  console.error('verify-probes: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
const kinds = { decl: probes.filter((probe) => probe.kind === 'decl').length, beh: probes.filter((probe) => probe.kind === 'beh').length }
if (asJson) console.log(JSON.stringify({ ok: true, probes: probes.length, kinds }, null, 2))
else console.log('verify-probes: OK — ' + probes.length + ' probe(s) (' + kinds.decl + ' decl / ' + kinds.beh + ' beh), each with an existing spec set and mutation fixture')
