#!/usr/bin/env node
/**
 * verify-param-consumers.mjs (G4): every declared parameter must have a reader, or a registered
 * reason why its reader is outside this repository.
 *
 * Why it exists: the audit's 05-P1.1 found five review knobs declared in the registry, documented
 * as a safety surface and passed by every bundle, while no code read them — schemastery silently
 * dropped them. A declaration without a consumer is the I4 violation this family keeps paying for,
 * so it becomes mechanical: the registry entry names its owner, and the gate looks for the id (or
 * its terminal key, which is how namespaced config is actually read) in that owner's sources. A
 * parameter whose reader genuinely lives outside the repo (the installer contract) is registered
 * with an owner, a plan and a version — never a free-text excuse.
 *
 * Usage: node packages/scripts/verify-param-consumers.mjs <evolutions-root> [--json]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRegistry } from './lib-param-registry.mjs'
import { familyVersion } from './lib-family-version.mjs'
import { exemptionProblems } from './lib-exemptions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.argv[2] ?? join(HERE, '..'))
const jsonMode = process.argv.includes('--json')

/** Owners that live under `scripts/` rather than a package directory. */
const OWNER_DIRS = { scripts: join(root, 'scripts') }

/** Source files of one owner, excluding the registry itself and build output. */
function sourcesOf(owner) {
  const base = OWNER_DIRS[owner] ?? join(root, owner, 'src')
  if (!existsSync(base)) return null
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name !== 'node_modules' && name !== 'lib' && name !== 'dist') walk(full)
        continue
      }
      if (/\.(?:ts|mjs|cjs|js)$/.test(name) && !name.endsWith('.d.ts')) files.push(full)
    }
  }
  walk(base)
  return files.filter((file) => !file.replace(/\\/g, '/').endsWith('/params.ts')).map((file) => readFileSync(file, 'utf8'))
}

/** The ways code names a config key; the terminal segment covers namespaced ids. */
function readsKey(sources, id) {
  const terminal = id.split('.').pop() ?? id
  const escaped = terminal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const word = new RegExp('\\b' + escaped + '\\b')
  return sources.some((text) => text.includes(id)
    || text.includes("'" + terminal + "'")
    || text.includes('"' + terminal + '"')
    || text.includes('.' + terminal)
    || word.test(text))
}

let registry
try {
  registry = readRegistry(root)
} catch (error) {
  console.error('verify-param-consumers: CANNOT DECIDE - cannot read the registry: ' + (error instanceof Error ? error.message : String(error)))
  process.exit(2)
}
if (registry.entries.length === 0) {
  console.error('verify-param-consumers: CANNOT DECIDE - the registry has no entries')
  process.exit(2)
}

const facts = JSON.parse(readFileSync(join(HERE, 'family-facts.json'), 'utf8'))
const machine = (facts.facts ?? []).find((fact) => fact?.machine?.kind === 'checks')?.machine
const exempt = machine?.paramConsumerExempt ?? {}
const version = familyVersion(root, root)

const resolved = []
const exempted = []
const unresolved = []
const badExemptions = []
for (const entry of registry.entries) {
  const sources = sourcesOf(entry.owner)
  // A declaration may NAME its reader when the symbol differs from the id (the ledger's point).
  if (typeof entry.consumer === 'string' && sources !== null && sources.some((text) => text.includes(entry.consumer))) { resolved.push(entry.id); continue }
  if (sources !== null && readsKey(sources, entry.id)) { resolved.push(entry.id); continue }
  const registration = exempt[entry.id]
  if (registration !== undefined) {
    const problems = exemptionProblems(registration, version)
    if (problems.length === 0) { exempted.push(entry.id); continue }
    badExemptions.push(entry.id + ': ' + problems.join('; '))
    continue
  }
  unresolved.push(entry.id + ' (owner ' + entry.owner + (sources === null ? ', no source directory' : '') + ')')
}

const summary = { rows: registry.entries.length, resolved: resolved.length, exempted: exempted.length, unresolved: unresolved.length, badExemptions: badExemptions.length }
if (jsonMode) console.log(JSON.stringify({ ...summary, unresolvedIds: unresolved, badExemptions }, null, 2))
else {
  console.log('verify-param-consumers: ' + summary.rows + ' declaration(s): resolved=' + summary.resolved + ' exempted=' + summary.exempted + ' unresolved=' + summary.unresolved)
  for (const row of unresolved) console.error('  - NO READER: ' + row)
  for (const row of badExemptions) console.error('  - INVALID EXEMPTION: ' + row)
}
if (badExemptions.length > 0) {
  console.error('verify-param-consumers: ' + badExemptions.length + ' exemption(s) are invalid; renew with an owner, a version and a plan, or wire the parameter')
  process.exit(1)
}
if (unresolved.length > 0) {
  console.error('verify-param-consumers: ' + unresolved.length + ' declared parameter(s) have no reader in their owner; wire them, delete them, or register the reader that lives outside this repository')
  process.exit(1)
}
process.exit(0)
