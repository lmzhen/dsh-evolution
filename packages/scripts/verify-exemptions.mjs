#!/usr/bin/env node
/**
 * verify-exemptions.mjs (G7-b): an exemption is only honoured when it has an owner, a plan and a
 * version it expires at, and that version has not been reached.
 *
 * Why it exists: the audit measured 32 mutation exemptions whose `expiry` was prose and 4 pending
 * axes renewed across three releases without a row ever closing. Nothing compared those strings to
 * the family version, so the mechanism meant to retire debt carried it forever. This gate turns the
 * registry into data that can fail.
 *
 * Usage: node packages/scripts/verify-exemptions.mjs <family-packages-root>
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { familyVersion } from './lib-family-version.mjs'
import { evaluateExemptions } from './lib-exemptions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const familyRoot = resolve(process.argv[2] ?? join(HERE, '..'))
const factsPath = join(HERE, 'family-facts.json')
if (!existsSync(factsPath)) {
  console.error('verify-exemptions: CANNOT DECIDE - ' + factsPath + ' does not exist')
  process.exit(2)
}
const version = familyVersion(familyRoot, familyRoot)
if (version === undefined) {
  console.error('verify-exemptions: CANNOT DECIDE - no family version in ' + familyRoot)
  process.exit(2)
}
const facts = JSON.parse(readFileSync(factsPath, 'utf8'))
const machine = (facts.facts ?? []).find((fact) => fact !== null && typeof fact === 'object' && fact.machine?.kind === 'checks')?.machine
if (machine === undefined) {
  console.error('verify-exemptions: CANNOT DECIDE - no checks fact in family-facts.json')
  process.exit(2)
}

const registries = {
  mutationExempt: machine.mutationExempt ?? {},
  pendingAxes: Object.fromEntries((machine.pendingAxes ?? []).map((axis) => [String(axis.axis), axis])),
  cannotDecideRegistered: machine.cannotDecideRegistered ?? {},
  paramConsumerExempt: machine.paramConsumerExempt ?? {},
}
let failures = 0
let checked = 0
for (const [name, registry] of Object.entries(registries)) {
  const rows = evaluateExemptions(registry, version)
  checked += rows.length
  const bad = rows.filter((row) => row.problems.length > 0)
  failures += bad.length
  console.log('verify-exemptions: ' + name + ': ' + rows.length + ' entr(ies), ' + bad.length + ' invalid, family ' + version)
  for (const row of bad) console.log('  - ' + row.id + ': ' + row.problems.join('; '))
}
if (checked === 0) {
  console.error('verify-exemptions: CANNOT DECIDE - both registries are empty; the gate would be vacuum')
  process.exit(2)
}
if (failures > 0) {
  console.error('verify-exemptions: ' + failures + ' exemption(s) are invalid or expired; renew with an owner, a version and a reduction plan, or close the debt')
  process.exit(1)
}
console.log('verify-exemptions: OK - ' + checked + ' exemption(s) carry an owner, a plan and an unevaluated-away version')
