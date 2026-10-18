#!/usr/bin/env node
/**
 * Release-evidence guard (W2/W3/W10/W11): one release-evidence.json must be readable, match the
 * ONE platform line, and — at the release gate — carry all four spike verdicts, the CI face, the
 * gate readings and the complete 52-item traceability reading.
 *
 * Usage:
 *   node packages/scripts/verify-release-evidence.mjs <release-evidence.json>
 *     [--release] [--json]
 * Exit: 0 pass · 1 violation · 2 cannot decide (missing/unreadable/unsupported file).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { EVIDENCE_SCHEMA_VERSION, validateReleaseEvidence } from './lib-release-evidence.mjs'
import { readPlatformLine, resolvePlatformLineRoot } from './lib-platform-line.mjs'

const argv = process.argv.slice(2)
const file = argv.find((arg) => !arg.startsWith('--'))
const release = argv.includes('--release')
const json = argv.includes('--json')
if (file === undefined) { console.error('verify-release-evidence: usage: <release-evidence.json> [--release] [--json]'); process.exit(2) }
const path = resolve(file)
if (!existsSync(path)) { console.error('verify-release-evidence: no evidence at ' + path + ' (cannot decide)'); process.exit(2) }
let evidence
try { evidence = JSON.parse(readFileSync(path, 'utf8')) } catch (error) { console.error('verify-release-evidence: unreadable evidence (' + (error instanceof Error ? error.message : String(error)) + ')'); process.exit(2) }
const problems = validateReleaseEvidence(evidence, { release })
// W3: the evidence's platform line must agree with the ONE platform-line.json, never a hand copy.
// In the publish job there is no checkout (only the dist/scripts artifacts), so prepare-release ships
// platform-line.json next to the evidence — prefer that sibling and fall back to resolving the tree.
try {
  const sibling = join(dirname(path), 'platform-line.json')
  const line = existsSync(sibling) ? JSON.parse(readFileSync(sibling, 'utf8')) : readPlatformLine(resolvePlatformLineRoot(import.meta.url))
  for (const key of ['version', 'floor', 'peersRange', 'enginesRange', 'upstreamRef']) {
    if (evidence?.platformLine?.[key] !== line[key]) problems.push('platformLine.' + key + ' differs from platform-line.json')
  }
} catch (error) {
  problems.push('platform-line.json could not be read: ' + (error instanceof Error ? error.message : String(error)))
}
if (problems.length > 0) {
  if (json) console.log(JSON.stringify({ ok: false, release, problems }, null, 2))
  else { console.error('verify-release-evidence: ' + problems.length + ' problem(s):'); for (const problem of problems) console.error('  - ' + problem) }
  process.exit(1)
}
const summary = { ok: true, release, schemaVersion: EVIDENCE_SCHEMA_VERSION, familyVersion: evidence.familyVersion, spikes: (evidence.spikes ?? []).map((spike) => spike.spike + ':' + spike.verdict), gates: (evidence.gates ?? []).length, traceability: evidence.traceability ?? null }
if (json) console.log(JSON.stringify(summary, null, 2))
else console.log('verify-release-evidence: OK — ' + (release ? 'release gate' : 'staging') + ' evidence (schema v' + String(EVIDENCE_SCHEMA_VERSION) + ', spikes ' + (summary.spikes.join(',') || '(pending)') + ')')
