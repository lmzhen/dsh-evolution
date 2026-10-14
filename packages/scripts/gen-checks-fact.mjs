#!/usr/bin/env node
/**
 * G0 S0.3: the DECLARATION face of the family's checks.
 *
 * Why this exists: the gate table says what RUNS (and CONTRIBUTING.md is its one
 * home), but nothing said what each check ASSERTS, which lane the policy
 * requires it at, or which criterion judges it. That made every check a
 * shape-only step: green meant "the process exited 0", never "the claim holds".
 * This generator derives the rows from the table transcription
 * (scripts/gate-manifest.json, byte-identical in both layouts) and writes the
 * 'checks' fact, which owns exactly the three columns nothing else owns:
 *
 *   tier      - the EARLIEST lane the manifest requires the check at
 *               (local => fast, pre-tag => pre-tag, ci => ci-only,
 *                a row the table gives no profile => unmapped, registered)
 *   criterion - the basename of the first .mjs/.cjs the row runs; a row that
 *               runs no family script => unknown, registered
 *   claim     - human-written; while the column is unwritten the fact carries a
 *               pendingColumns register (reason, expiry, owner, and the measured
 *               count of rows still without it) - never a silent blank
 *
 * The columns the carrier owns are NOT copied here (that would be the second
 * source this whole round exists to remove); verify-doc-facts re-derives the
 * id set, the criterion-vs-command join, the tier closed set and the duplicate
 * command groups from the carrier on every gate run.
 *
 * Usage: node packages/scripts/gen-checks-fact.mjs [--check]
 *   --check  exit 1 when the asset differs from the derived form (drift gate)
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSET = join(HERE, 'family-facts.json')
const CARRIER = join(HERE, 'gate-manifest.json')
const CARRIER_REL = 'scripts/gate-manifest.json'
const EXPIRY = '0.26.0'
const OWNER = 'scripts'
const SENTINEL_TIER = 'unmapped'
const SENTINEL_CRITERION = 'unknown'

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** tier: the earliest lane the manifest requires the check at. */
function tierOf(gate) {
  const profiles = Array.isArray(gate.profiles) ? gate.profiles : []
  if (profiles.includes('local')) return 'fast'
  if (profiles.includes('pre-tag')) return 'pre-tag'
  if (profiles.includes('ci')) return 'ci-only'
  return SENTINEL_TIER
}

/** criterion: the script the row runs, by basename; no script => unknown. */
function criterionOf(gate) {
  // M2: the executable form is argv (human is prose); the criterion is the script the row runs
  // a row with no single executable command has no criterion either: reading one out of the
  // prose would invent a judge (gate-34's composite cell names six scripts)
  const text = Array.isArray(gate.argv) ? gate.argv.join(' ') : ''
  const match = text.match(/([A-Za-z0-9._-]+)\.(?:mjs|cjs)/)
  return match === null ? SENTINEL_CRITERION : match[1]
}

/** Normalized command: the collision key (whitespace is not an identity). */
function commandKey(gate) {
  const text = Array.isArray(gate.argv) ? gate.argv.join(' ') : String(gate.human === undefined ? '' : gate.human)
  return text.trim().replace(/\s+/g, ' ')
}

function collisionGroups(gates) {
  const byKey = new Map()
  for (const gate of gates) {
    const key = commandKey(gate)
    if (key === '') continue
    const ids = byKey.get(key)
    if (ids === undefined) byKey.set(key, [gate.id])
    else ids.push(gate.id)
  }
  return [...byKey.entries()].filter((entry) => entry[1].length > 1).map((entry) => ({ key: entry[0], ids: entry[1] }))
}

function entryFor(id, extra) {
  const entry = { id, reasonRef: CARRIER_REL + '#' + id, expiry: EXPIRY, owner: OWNER }
  return Object.assign(entry, extra === undefined ? {} : extra)
}

function buildFact(carrier, asset) {
  const previous = (asset.facts === undefined ? [] : asset.facts).find((fact) => fact && fact.machine && fact.machine.kind === 'checks')
  // the axis register is AUTHORED (each entry is a debt with a measured size, an expiry and an
  // owner) - regeneration must carry it, exactly like a written claim or a requires list.
  const pendingAxes = previous && previous.machine && Array.isArray(previous.machine.pendingAxes) ? previous.machine.pendingAxes : []
  const written = new Map()
  const requiresOf = new Map()
  const rows = previous && previous.machine && Array.isArray(previous.machine.declarations) ? previous.machine.declarations : []
  for (const row of rows) {
    if (row && typeof row.claim === 'string' && row.claim.trim() !== '') written.set(row.id, row.claim)
    // a prerequisite list is AUTHORED data (nothing else owns it) - regeneration must not drop it
    if (row && Array.isArray(row.requires) && row.requires.length > 0) requiresOf.set(row.id, row.requires)
  }
  const gates = Array.isArray(carrier.gates) ? carrier.gates : []
  const declarations = gates.map((gate) => {
    const row = { id: gate.id, tier: tierOf(gate), criterion: criterionOf(gate) }
    if (written.has(gate.id)) row.claim = written.get(gate.id)
    if (requiresOf.has(gate.id)) row.requires = requiresOf.get(gate.id)
    return row
  })
  const unwrittenClaims = declarations.filter((row) => row.claim === undefined).length
  const pendingColumns = unwrittenClaims === 0 ? [] : [{ column: 'claim', rowsWithoutIt: unwrittenClaims, reasonRef: CARRIER_REL + ' (the per-row reason field is the material a claim is written from)', expiry: EXPIRY, owner: OWNER }]
  const unmappedTier = declarations.filter((row) => row.tier === SENTINEL_TIER).map((row) => entryFor(row.id))
  const unknownCriterion = declarations.filter((row) => row.criterion === SENTINEL_CRITERION).map((row) => entryFor(row.id))
  const duplicateGroups = collisionGroups(gates).map((group) => ({
    key: group.key,
    ids: group.ids,
    reasonRef: 'G5: retire one of the pair, the survivor keeps the coverage',
    expiry: EXPIRY,
    owner: OWNER
  }))
  return {
    id: 'checks',
    title: 'the declaration face of every check: its claim, its tier and its criterion',
    home: 'README.md',
    must: [{ text: 'A column nobody has written yet is not a pass', unique: true }],
    machine: {
      kind: 'checks',
      file: CARRIER_REL,
      sha256: createHash('sha256').update(readFileSync(CARRIER)).digest('hex'),
      tierSource: 'testing-policy',
      sentinel: { tier: SENTINEL_TIER, criterion: SENTINEL_CRITERION },
      rule: {
        tier: 'the earliest lane the manifest requires the check at: local => fast, pre-tag => pre-tag, ci => ci-only, no profile => unmapped (registered)',
        criterion: 'the basename of the first .mjs/.cjs the row runs; a row that runs no script => unknown (registered)',
        claim: 'human-written; a row without one sits in pendingHuman with a reason, an expiry and an owner'
      },
      declarations: declarations,
      pendingColumns: pendingColumns,
      pendingAxes: pendingAxes,
      unmappedTier: unmappedTier,
      unknownCriterion: unknownCriterion,
      duplicateGroups: duplicateGroups
    }
  }
}

if (!existsSync(CARRIER)) {
  console.log('gen-checks-fact: carrier missing at ' + CARRIER + ' - nothing can be derived')
  process.exit(2)
}
const asset = readJson(ASSET)
const fact = buildFact(readJson(CARRIER), asset)
const kept = (asset.facts === undefined ? [] : asset.facts).filter((entry) => entry && entry.id !== 'checks')
const next = Object.assign({}, asset, { facts: kept.concat([fact]) })
const text = JSON.stringify(next, null, 2) + '\n'
const check = process.argv.includes('--check')
const here = HERE.split('\\').join('/')
const face = here.includes('/packages/evolution/') ? 'overlay' : 'mirror'
const stamp = 'gen-checks-fact: face=' + face + ' tree=' + here + ' carrier=' + fact.machine.sha256.slice(0, 8) + ' rows=' + fact.machine.declarations.length + ' unwrittenClaims=' + fact.machine.pendingColumns.reduce((sum, entry) => sum + entry.rowsWithoutIt, 0) + ' pendingColumns=' + fact.machine.pendingColumns.length + ' unmappedTier=' + fact.machine.unmappedTier.length + ' unknownCriterion=' + fact.machine.unknownCriterion.length + ' duplicateGroups=' + fact.machine.duplicateGroups.length
if (check) {
  const current = readFileSync(ASSET, 'utf8')
  if (current !== text) {
    console.log(stamp)
    console.log('gen-checks-fact: the checks fact in family-facts.json differs from the derived form - run without --check to refresh it')
    process.exit(1)
  }
  console.log(stamp + ' -> in sync (facts=' + next.facts.length + ')')
  process.exit(0)
}
writeFileSync(ASSET, text)
console.log(stamp + ' -> wrote ' + ASSET + ' (facts=' + next.facts.length + ')')
