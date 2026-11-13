#!/usr/bin/env node
/**
 * gen-gate-manifest — render the generated views from the ONE gate registry (W10 M3).
 *
 * Views (both are generated; neither is a source):
 *   packages/scripts/gate-manifest.json   the machine artifact every consumer reads
 *   CONTRIBUTING.md gate table            the human appendix
 *
 * The dependency direction is now one-way: registry -> views. Nothing parses the table back into
 * the registry, and no row id depends on a table row number or on action.yml ordering.
 *
 * Usage: node packages/scripts/gen-gate-manifest.mjs [--check]
 *   --check exits 1 when either view is stale.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registry } from './gates/registry.mjs'
import { validateRegistry } from './gates/helpers.mjs'
import { renderContributing, renderManifestGates, renderTableBlock, renderTableRows } from './lib-gate-views.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MANIFEST = join(HERE, 'gate-manifest.json')
const CONTRIBUTING = join(ROOT, 'CONTRIBUTING.md')
const check = process.argv.includes('--check')

const problems = validateRegistry(registry)
if (problems.length > 0) {
  console.error('gen-gate-manifest: the registry cannot be rendered - ' + problems.length + ' problem(s):')
  for (const problem of problems.slice(0, 12)) console.error('  - ' + problem)
  if (problems.length > 12) console.error('  … ' + (problems.length - 12) + ' more')
  process.exit(1)
}

const gates = renderManifestGates(registry)

// Probes stay a separate authored registry until M5; the manifest carries them for the consumers
// that already read gate-manifest.probes (verify-probes / verify-mutations / traceability).
let probes = []
try {
  const parsed = JSON.parse(readFileSync(join(HERE, 'probes.json'), 'utf8'))
  probes = Array.isArray(parsed.probes) ? parsed.probes : []
} catch { probes = [] }
if (probes.length === 0) {
  console.error('gen-gate-manifest: probes.json is missing or empty - a probe registry with nothing in it is a silent gate')
  process.exit(1)
}

const manifest = {
  version: 1,
  generatedBy: 'packages/scripts/gen-gate-manifest.mjs',
  sources: ['packages/scripts/gates/registry.mjs (gate registry, W10 M3)', 'packages/scripts/probes.json (probe registry)'],
  gates,
  probes,
}
const manifestText = JSON.stringify(manifest, null, 2) + '\n'

// The table is the table-origin half (`gate-NN`); CI-only and named rows live in the manifest, not
// the human appendix, because they have no numbered table row.
const tableRows = renderTableRows(gates)
for (const [index, row] of tableRows.entries()) {
  if (row.n !== index + 1) {
    console.error('gen-gate-manifest: table-origin ids are not contiguous at position ' + (index + 1) + ' (found gate-' + String(row.n).padStart(2, '0') + ') - a gap hides a retired step')
    process.exit(1)
  }
}
const block = renderTableBlock(tableRows)
let contributingText
try { contributingText = renderContributing(readFileSync(CONTRIBUTING, 'utf8'), block) } catch (error) {
  console.error('gen-gate-manifest: cannot render the CONTRIBUTING table - ' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
}

if (check) {
  const stale = []
  if (!existsSync(MANIFEST) || readFileSync(MANIFEST, 'utf8') !== manifestText) stale.push('gate-manifest.json')
  if (!existsSync(CONTRIBUTING) || readFileSync(CONTRIBUTING, 'utf8') !== contributingText) stale.push('CONTRIBUTING gate table')
  if (stale.length > 0) {
    console.error('gen-gate-manifest --check: stale view(s): ' + stale.join(', ') + ' — rerun without --check, then gen-checks-fact.mjs')
    process.exit(1)
  }
  console.log('gen-gate-manifest --check: OK (' + gates.length + ' gates, ' + tableRows.length + ' table rows)')
  process.exit(0)
}
writeFileSync(MANIFEST, manifestText)
writeFileSync(CONTRIBUTING, contributingText)

const undeclared = gates.filter((gate) => gate.kind === 'script' && gate.drillCmd === undefined && gate.noDrillReason === undefined)
if (undeclared.length > 0) console.error('gen-gate-manifest: hint - ' + undeclared.length + ' script row(s) declare no drillCmd/noDrillReason yet (migration, not enforced): ' + undeclared.slice(0, 6).map((gate) => gate.id).join(', ') + (undeclared.length > 6 ? ' …' : ''))
const counts = gates.reduce((all, gate) => (all[gate.kind] = (all[gate.kind] || 0) + 1, all), {})
console.log('gen-gate-manifest: wrote ' + gates.length + ' gates ' + JSON.stringify(counts) + ' and ' + tableRows.length + ' table row(s)')
