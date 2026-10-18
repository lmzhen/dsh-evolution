#!/usr/bin/env node
/**
 * W11 traceability ledger gate: the 52-item universe (A-01..A-22, B-01..B-18, C-01..C-12) must be
 * COMPLETELY and CONSISTENTLY accounted for, and the concept budget must match the tree.
 *
 * Default (strict): schema + coverage + order + cited files exist + probes/gates registered in
 * gate-manifest + the budget re-derived from the tree (packages/scripts/exports/error codes).
 * --planned: only schema/coverage/order, for the phase before W9 registers the remaining probes
 * (exit 1 still for a missing/duplicate/unknown row; a warning lists the unregistered citations).
 *
 * Usage: node packages/scripts/verify-traceability.mjs <root> [--planned] [--json]
 *   root: 'packages' (mirror) or 'packages/evolution' (overlay)
 * Exit: 0 pass · 1 violation · 2 cannot decide (no ledger / empty portfolio / universe incomplete).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const root = resolve(argv.find((arg) => !arg.startsWith('--')) ?? 'packages')
const PLANNED = argv.includes('--planned')
const JSON_OUT = argv.includes('--json')

const UNIVERSE = {
  A: 22,
  B: 18,
  C: 12,
}
const DISPOSITIONS = new Set(['adopted', 'adopted-min', 'deferred', 'rejected', 'no-action'])
const BASELINE = { packages: 32, coreExports: 4 }

const problems = []
const warnings = []
const universeIds = []
for (const [group, count] of Object.entries(UNIVERSE)) {
  for (let index = 1; index <= count; index += 1) universeIds.push(group + '-' + String(index).padStart(2, '0'))
}
const universeSet = new Set(universeIds)

const ledgerPath = join(root, 'scripts', 'traceability.json')
if (!existsSync(ledgerPath)) {
  console.error('verify-traceability: no ledger at ' + ledgerPath + ' — the coverage matrix cannot be decided (exit 2)')
  process.exit(2)
}
let ledger
try {
  ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
} catch (error) {
  console.error('verify-traceability: unreadable ledger (' + (error instanceof Error ? error.message : String(error)) + ') — exit 2')
  process.exit(2)
}
const items = Array.isArray(ledger.items) ? ledger.items : []
if (items.length === 0) {
  console.error('verify-traceability: the ledger carries zero items — an empty matrix is not a pass (exit 2)')
  process.exit(2)
}

const seen = new Set()
let previousIndex = -1
for (const item of items) {
  const id = typeof item?.id === 'string' ? item.id : '(no id)'
  if (!universeSet.has(id)) problems.push(FACTS + ': unknown id "' + id + '" — the 52-item universe is closed (A-22/B-18/C-12)')
  if (seen.has(id)) problems.push('traceability.json: duplicate id "' + id + '"')
  seen.add(id)
  const index = universeIds.indexOf(id)
  if (index >= 0 && index < previousIndex) problems.push('traceability.json: "' + id + '" is out of the canonical order — sort A→B→C, numeric inside each group')
  if (index >= 0) previousIndex = index
  const disposition = item?.disposition
  if (!DISPOSITIONS.has(disposition)) {
    problems.push('traceability.json: "' + id + '" has disposition "' + String(disposition) + '" — one of ' + [...DISPOSITIONS].join('/'))
    continue
  }
  const needsCoverage = disposition === 'adopted' || disposition === 'adopted-min'
  for (const field of ['design', 'files', 'probes', 'gates']) {
    if (needsCoverage && (!Array.isArray(item[field]) || item[field].length === 0)) {
      problems.push('traceability.json: "' + id + '" is ' + disposition + ' but names no ' + field + ' — an adopted item must say where it landed and what proves it')
    }
  }
  if ((disposition === 'deferred' || disposition === 'rejected') && typeof item.trigger !== 'string' && typeof item.note !== 'string') {
    problems.push('traceability.json: "' + id + '" is ' + disposition + ' without a trigger or note — a silent skip is not a disposition')
  }
  if (disposition === 'no-action' && typeof item.note !== 'string') {
    problems.push('traceability.json: "' + id + '" is no-action without a note — the record needs a reason')
  }
  if (typeof item.evidence !== 'string' || !['A', 'B', 'C'].includes(item.evidence)) {
    problems.push('traceability.json: "' + id + '" carries no valid evidence grade (A/B/C)')
  }
}
for (const id of universeIds) {
  if (!seen.has(id)) problems.push('traceability.json: the universe item "' + id + '" is missing — 52/52 required')
}

// The ledger's own file names are relative to the REPO root; the scan root is the packages dir (or the
// overlay's packages/evolution), so resolve against root and one level up.
const resolveFile = (rel) => {
  for (const base of [root, resolve(root, '..')]) {
    const path = join(base, rel)
    if (existsSync(path)) return path
  }
  return undefined
}
const manifestPath = join(root, 'scripts', 'gate-manifest.json')
let manifest = { gates: [], probes: [] }
if (existsSync(manifestPath)) {
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { /* reported below in strict mode */ }
}
const gateIds = new Set((manifest.gates ?? []).map((gate) => gate.id))
const probeIds = new Set((manifest.probes ?? []).map((probe) => probe.id))

if (!PLANNED) {
  if (!existsSync(manifestPath)) problems.push('scripts/gate-manifest.json: missing — probes/gates citations cannot be checked')
  for (const item of items) {
    for (const rel of item.files ?? []) {
      if (resolveFile(rel) === undefined) problems.push('traceability.json: "' + item.id + '" cites a file that does not exist: ' + rel)
    }
    for (const probe of item.probes ?? []) {
      if (!probeIds.has(probe)) problems.push('traceability.json: "' + item.id + '" cites probe "' + probe + '", which is not in gate-manifest.probes')
    }
    for (const gate of item.gates ?? []) {
      if (!gateIds.has(gate)) problems.push('traceability.json: "' + item.id + '" cites gate "' + gate + '", which is not in gate-manifest.gates')
    }
  }
  const budget = ledger.budget ?? {}
  const measured = measureBudget(root)
  if (budget.newPackages !== measured.newPackages) problems.push('budget.newPackages=' + String(budget.newPackages) + ' but the tree carries ' + String(measured.newPackages) + ' new package(s) over the 32 baseline')
  if (budget.newSubpaths !== measured.newSubpaths) problems.push('budget.newSubpaths=' + String(budget.newSubpaths) + ' but the core exports surface carries ' + String(measured.newSubpaths) + ' new subpath(s)')
  if (!Array.isArray(budget.newErrorCodes) || budget.newErrorCodes.length !== 3) problems.push('budget.newErrorCodes must name exactly three codes (E-323/E-324/E-325)')
  for (const code of budget.newErrorCodes ?? []) {
    if (!measured.errorCodes.has(code)) problems.push('budget.newErrorCodes names ' + code + ', which the error table does not carry')
  }
  for (const script of budget.newScripts ?? []) {
    if (!existsSync(join(root, 'scripts', script))) problems.push('budget.newScripts names ' + script + ', which is not in scripts/')
  }
  if (!Array.isArray(measured.scripts) || measured.scripts.length === 0) problems.push('the scripts directory is empty — the budget cannot be re-derived')
} else {
  for (const item of items) {
    for (const probe of item.probes ?? []) if (!probeIds.has(probe)) warnings.push(item.id + ' cites planned probe ' + probe + ' (not registered yet)')
    for (const gate of item.gates ?? []) if (!gateIds.has(gate)) warnings.push(item.id + ' cites gate ' + gate + ' (not in the manifest)')
  }
}

function measureBudget(packagesRoot) {
  const packageDirs = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packagesRoot, entry.name, 'package.json')))
    .map((entry) => entry.name)
  const scripts = existsSync(join(packagesRoot, 'scripts'))
    ? readdirSync(join(packagesRoot, 'scripts')).filter((name) => name.endsWith('.mjs'))
    : []
  const coreManifest = join(packagesRoot, 'evolution-core', 'package.json')
  const coreExports = existsSync(coreManifest) ? Object.keys(JSON.parse(readFileSync(coreManifest, 'utf8')).exports ?? {}).length : 0
  const errorsPath = join(packagesRoot, 'evolution-core', 'src', 'errors.ts')
  const errorCodes = new Set()
  if (existsSync(errorsPath)) {
    for (const match of readFileSync(errorsPath, 'utf8').matchAll(/'E-(3\d\d):/g)) errorCodes.add('E-' + match[1])
  }
  return {
    packages: packageDirs.length,
    scripts,
    errorCodes,
    newPackages: Math.max(0, packageDirs.length - BASELINE.packages),
    newSubpaths: Math.max(0, coreExports - BASELINE.coreExports),
  }
}
const FACTS = 'scripts/traceability.json'

if (problems.length > 0) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, planned: PLANNED, problems, warnings }, null, 2))
  else {
    console.error('verify-traceability: ' + problems.length + ' problem(s):')
    for (const problem of problems) console.error('  - ' + problem)
  }
  process.exit(1)
}
const measured = measureBudget(root)
if (JSON_OUT) console.log(JSON.stringify({ ok: true, planned: PLANNED, items: items.length, universe: UNIVERSE, measured: { packages: measured.packages, scripts: measured.scripts.length, errorCodes: measured.errorCodes.size, newSubpaths: measured.newSubpaths }, warnings }, null, 2))
else {
  if (warnings.length > 0) console.log('verify-traceability: ' + warnings.length + ' planned-citation warning(s); run without --planned once W9 registers them')
  console.log('verify-traceability: OK — ' + items.length + '/52 item(s) accounted (' + (PLANNED ? 'planned mode: citations not existence-checked' : 'strict: files/probes/gates/budget re-derived') + ')')
}
