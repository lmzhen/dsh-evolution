#!/usr/bin/env node
/**
 * gen-check-taxonomy.mjs (G2/M3): the MEMBERSHIP view - which check runs in which lane.
 *
 * Why a view and not a home (R22'): membership is derivable from two homes that already
 * exist - a gate's row profiles in scripts/gate-manifest.json, and a spec's @tier header
 * (R28's window rule) - plus the lane chain in the testing-policy fact. This file only
 * PROJECTS them; it owns no policy. The projection is committed as reports/check-taxonomy.json
 * so a hand edit drifts and --check says so.
 *
 * Report half (plan step 3): the @tier marker is a NEW convention - no spec carries it today -
 * so everything that is not yet true is printed as an observation, and the empty spec lanes are
 * registered with the contract's requiredFrom instead of failing the tree. Once the family
 * version reaches requiredFrom, a spec without a marker is RED here (R28: an empty REQUIRED
 * tier is red; an unrequired one prints requiredFrom and is skipped).
 *
 * Usage: node <scripts-dir>/gen-check-taxonomy.mjs [--check] [--report]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { familyVersion, versionReached } from './lib-family-version.mjs'
import { runnable, supersetPreTag, declaredPreTag, unknownProfiles } from './lib-gate-projection.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TREE = resolve(HERE, '..')
const FACTS = join(HERE, 'family-facts.json')
const MANIFEST = join(HERE, 'gate-manifest.json')
const OUT = join(HERE, 'reports', 'check-taxonomy.json')
const check = process.argv.includes('--check')
const report = process.argv.includes('--report')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const policyFact = (() => { try { return (readJson(FACTS).facts ?? []).find((f) => f?.machine?.kind === 'testing-policy') } catch { return undefined } })()
if (policyFact === undefined) { console.error('gen-check-taxonomy: the testing-policy fact is missing - the lane chain has no home'); process.exit(2) }
const chain = Array.isArray(policyFact.machine.cumulative) ? policyFact.machine.cumulative : []
if (chain.length === 0) { console.error('gen-check-taxonomy: the policy states no cumulative lane chain'); process.exit(2) }
const tiers = Object.keys(policyFact.machine.tiers ?? {})
const contract = policyFact.machine.headerContract ?? {}
const current = familyVersion(TREE)

// --- source 1: the gate rows, by their profiles -------------------------------------------
const manifest = existsSync(MANIFEST) ? readJson(MANIFEST) : { gates: [] }
const __badProfiles = unknownProfiles(manifest.gates)
if (__badProfiles.length > 0) {
  console.error('profile literal outside the vocabulary (local/pre-tag/ci): ' + __badProfiles.map((e) => e.id + '=' + e.bad.join(',')).join(' '))
  process.exit(2)
}
const gatesWith = (predicate) => manifest.gates.filter(predicate).map((gate) => gate.id).sort()
// gates are keyed by the TIER their profiles express (R22': the manifest is the membership home)
const laneGates = {
  fast: gatesWith((gate) => (gate.profiles ?? []).includes('local')),
  'pre-tag': declaredPreTag(manifest.gates).map((gate) => gate.id).sort(),
  'ci-only': gatesWith((gate) => (gate.profiles ?? []).includes('ci') && !(gate.profiles ?? []).includes('local')),
}

// --- source 2: the spec headers (R28 window rule) ------------------------------------------
const WINDOW = /^\s*(\/\/|\/\*|\*|import\b|$)/
const specFiles = []
const visit = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { visit(full); continue }
    if (entry.name.endsWith('.spec.ts') && dir.endsWith('tests')) specFiles.push(full)
  }
}
visit(TREE)
const specMembers = { }
for (const tier of tiers) specMembers[tier] = []
const observations = []
const note = (kind, detail) => observations.push({ kind, detail })
const markerRe = new RegExp('@' + String(contract.marker ?? '@tier').replace(/^@/, '') + '\\s+([A-Za-z0-9_-]+)', 'g')
let unmarked = 0
for (const file of specFiles) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  let end = 0
  while (end < lines.length && WINDOW.test(lines[end])) end += 1
  const inWindow = []
  for (let i = 0; i < end; i += 1) for (const hit of lines[i].matchAll(markerRe)) inWindow.push({ tier: hit[1], line: i + 1 })
  const outside = []
  for (let i = end; i < lines.length; i += 1) for (const hit of lines[i].matchAll(markerRe)) outside.push({ tier: hit[1], line: i + 1 })
  const pkg = relative(TREE, file).split(/[\\/]/)[0]
  const key = pkg + '::' + relative(join(TREE, pkg), file).split('\\').join('/')
  for (const hit of outside) note('header-outside-window', key + ':' + hit.line + ' carries ' + hit.tier + ' after the header window - the marker must be in the leading comment/import run')
  if (inWindow.length === 0) { unmarked += 1; continue }
  if (inWindow.length > 1) { note('header-ambiguous', key + ' declares ' + inWindow.length + ' markers (' + inWindow.map((hit) => hit.tier).join(', ') + ') - exactly one is required'); continue }
  const tier = inWindow[0].tier
  if (!tiers.includes(tier)) { note('header-unknown-tier', key + ' declares ' + tier + ', which is not one of ' + tiers.join('|')); continue }
  specMembers[tier].push(key)
}
for (const tier of tiers) specMembers[tier].sort()

// --- the contract's dated requirement ------------------------------------------------------
const requiredFrom = typeof contract.requiredFrom === 'string' ? contract.requiredFrom : undefined
const markerRequired = requiredFrom === undefined ? null : (current === undefined ? null : versionReached(current, requiredFrom))
// The lane composition is the contract's, not an invention: a declared tier runs alone, the
// local chain is cumulative (pre-tag = fast + pre-tag), ci-only is ORTHOGONAL (R71: it joins the
// full lane only when ci is on), and the bare name 'full' is never a lane identity - a reading
// must say full(ci=on|off) because those are two different member sets.
const LANE_TIERS = {
  fast: ['fast'],
  'pre-tag': ['fast', 'pre-tag'],
  'ci-only': ['ci-only'],
  'full(ci=off)': ['fast', 'pre-tag'],
  'full(ci=on)': ['fast', 'pre-tag', 'ci-only'],
}
const lanes = {}
for (const [lane, memberTiers] of Object.entries(LANE_TIERS)) {
  const declared = memberTiers.filter((tier) => tiers.includes(tier))
  if (declared.length === 0) continue
  const localLane = declared.filter((tier) => tier !== 'ci-only')
  const gates = [...new Set(declared.flatMap((tier) => laneGates[tier] ?? []))].sort()
  const specs = [...new Set(declared.flatMap((tier) => specMembers[tier] ?? []))].sort()
  lanes[lane] = { tiers: declared, gates, specs, gatesLocal: [...new Set(localLane.flatMap((tier) => laneGates[tier] ?? []))].sort() }
}
if (unmarked > 0) {
  note('header-missing', unmarked + ' of ' + specFiles.length + ' spec(s) carry no ' + String(contract.marker ?? '@tier') + ' marker'
    + (requiredFrom === undefined ? ' (the contract names no requiredFrom - an unregistered gap)' : ' (required from ' + requiredFrom + ', family version ' + String(current) + ')'))
}
const out = {
  version: 1,
  generatedBy: 'packages/scripts/gen-check-taxonomy.mjs',
  sources: ['scripts/gate-manifest.json (row profiles)', String(contract.specGlob ?? '*/tests/**/*.spec.ts') + ' (@tier header contract)', 'family-facts.json testing-policy (lane chain + tier policy)'],
  lanes,
  counts: Object.fromEntries(Object.entries(lanes).map(([lane, members]) => [lane, { gates: members.gates.length, specs: members.specs.length }])),
  // the census is NOT a lane: it sits beside counts so every consumer that iterates counts stays
  // a lane loop (a mixed-key object is how a report loop starts reading a number as a lane).
  specs: { total: specFiles.length, marked: new Set(Object.values(lanes).flatMap((lane) => lane.specs)).size, unmarked: specFiles.length - new Set(Object.values(lanes).flatMap((lane) => lane.specs)).size },
}
const text = JSON.stringify(out, null, 2) + '\n'

if (report) {
  const totalSpecs = specFiles.length
  console.log('gen-check-taxonomy [report] ' + manifest.gates.length + ' gate row(s), ' + totalSpecs + ' spec(s) (' + out.specs.marked + ' marked, ' + out.specs.unmarked + ' unmarked), lanes ' + Object.keys(lanes).join('/'))
  for (const [lane, counts] of Object.entries(out.counts)) console.log('  lane ' + lane + ': gates=' + counts.gates + ' specs=' + counts.specs + ' (tiers ' + (lanes[lane].tiers).join('+') + ')')
  for (const observation of observations) console.log('  - ' + observation.kind + ': ' + observation.detail)
  if (observations.length === 0) console.log('  (no observation)')
}
if (check) {
  const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (old !== text) {
    console.error('gen-check-taxonomy --check: reports/check-taxonomy.json is stale - the membership view drifted from the data (rerun without --check)')
    process.exit(1)
  }
  console.log('gen-check-taxonomy --check: OK (' + Object.keys(lanes).length + ' lane(s))')
} else if (!report) {
  // a bare run writes the view; --report only OBSERVES (a report that silently rewrote the view
  // would hide exactly the drift it is meant to surface), and --check only compares.
  if (!existsSync(join(HERE, 'reports'))) console.error('gen-check-taxonomy: reports/ does not exist next to this script')
  else writeFileSync(OUT, text)
  console.log('gen-check-taxonomy: wrote ' + OUT + ' (' + Object.keys(lanes).length + ' lane(s)' + (observations.length > 0 ? ', ' + observations.length + ' observation(s), run --report' : '') + ')')
}
// R28: once the marker is REQUIRED, a spec without one is red - and that is a verdict, not an
// observation. Before requiredFrom it is registered (the observation above carries the numbers).
if (markerRequired === true && unmarked > 0) {
  console.error('gen-check-taxonomy: ' + unmarked + ' spec(s) carry no ' + String(contract.marker ?? '@tier') + ' marker although the contract requires it from ' + String(requiredFrom) + ' (family version ' + String(current) + ')')
  process.exit(1)
}
