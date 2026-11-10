#!/usr/bin/env node
/**
 * Guard the product surface: one install bundle, one row-config surface per
 * parameter namespace, and a command registry that no longer carries the
 * setup/config commands migrated to the platform.
 *
 * This is a data/code consistency gate. It does not change runtime behavior;
 * S1/S2 consume the same catalog and the final S4 docs gate adds the prose
 * checks that are intentionally absent while the old UI still exists.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.argv[2] ?? process.cwd()
const here = dirname(fileURLToPath(import.meta.url))
const catalogPath = join(here, 'surface-catalog.json')
const problems = []
const notes = []

if (!existsSync(catalogPath)) {
  console.error('verify-surface-convergence: CANNOT DECIDE - missing ' + catalogPath)
  process.exit(2)
}
let catalog
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
} catch (error) {
  console.error('verify-surface-convergence: CANNOT DECIDE - unreadable catalog: ' + (error instanceof Error ? error.message : String(error)))
  process.exit(2)
}

const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
const unique = (values) => new Set(values).size === values.length

// 1. Exactly one product bundle.
if (!strings(catalog.installBundles) || catalog.installBundles.length !== 1) {
  problems.push('installBundles must name exactly one product bundle')
} else if (catalog.installBundles[0] !== '@lmzhen/dsh-evolution-all') {
  problems.push('the product bundle must be @lmzhen/dsh-evolution-all, got ' + catalog.installBundles[0])
}

// 2. The all bundle is the only bundle carrying a row's config page.
const allPatch = join(root, 'evolution-all', 'cordis.patch.yml')
const allRows = existsSync(allPatch)
  ? [...readFileSync(allPatch, 'utf8').matchAll(/^\s*- id:\s*(\S+)\s*$/gm)].map((match) => match[1])
  : []
if (allRows.length === 0) problems.push('cannot read the evolution-all bundle rows at ' + allPatch)

const rows = Array.isArray(catalog.rowConfigs) ? catalog.rowConfigs : []
if (rows.length === 0) problems.push('rowConfigs must name the parameter rows')
if (!unique(rows.map((row) => row?.rowId))) problems.push('rowConfigs contains a duplicate rowId')
for (const row of rows) {
  if (typeof row?.rowId !== 'string' || row.rowId === '') problems.push('rowConfigs entry has no rowId')
  else if (!allRows.includes(row.rowId)) problems.push('rowConfig ' + row.rowId + ' is not mounted by the all bundle')
  if (!strings(row?.namespaces) || row.namespaces.length === 0) problems.push('rowConfig ' + String(row?.rowId) + ' has no namespace')
  if (!strings(row?.bundles) || !row.bundles.includes('@lmzhen/dsh-evolution-all')) problems.push('rowConfig ' + String(row?.rowId) + ' must be exposed on the all bundle')
  if (typeof row?.order !== 'number' || !Number.isFinite(row.order)) problems.push('rowConfig ' + String(row?.rowId) + ' has no numeric order')
}

// 3. Every generated parameter namespace is covered, and no extra one is invented.
const paramsPath = join(root, 'evolution-ui', 'src', 'panels', 'settings', 'generated-params.ts')
if (!existsSync(paramsPath)) problems.push('cannot read the generated parameter namespaces at ' + paramsPath)
else {
  const namespaces = [...readFileSync(paramsPath, 'utf8').matchAll(/namespace:\s*'([^']+)'/g)].map((match) => match[1])
  const registered = new Set(rows.flatMap((row) => row?.namespaces ?? []))
  const missing = namespaces.filter((namespace) => !registered.has(namespace))
  const extra = [...registered].filter((namespace) => !namespaces.includes(namespace))
  if (missing.length > 0) problems.push('rowConfigs is missing namespace(s): ' + missing.join(', '))
  if (extra.length > 0) problems.push('rowConfigs names unknown namespace(s): ' + extra.join(', '))
  notes.push(namespaces.length + ' generated parameter namespace(s) covered')
}

// 4. The removed setup/config commands must not remain in the ONE registry.
const registryRel = catalog.commands?.registry
if (typeof registryRel !== 'string' || registryRel === '') problems.push('commands.registry must name the command registry source')
const removed = catalog.commands?.removed
if (!strings(removed) || removed.length === 0) problems.push('commands.removed must name the migrated commands')
else {
  const registryPath = join(root, registryRel)
  if (!existsSync(registryPath)) problems.push('cannot read the command registry at ' + registryPath)
  else {
    const usages = [...readFileSync(registryPath, 'utf8').matchAll(/usage:\s*'([^']+)'/g)].map((match) => match[1])
    if (usages.length === 0) problems.push('the command registry exposes no usage entries')
    const names = usages.map((usage) => {
      const [head = '', second = ''] = usage.split(' ')
      return /^[a-z][a-z-]*$/.test(second) && !second.startsWith('--') ? head.split('|')[0] + ' ' + second : head.split('|')[0]
    })
    if (catalog.commands?.enforced === true) {
      for (const command of removed) if (names.includes(command)) problems.push('removed command is still in the registry: ' + command)
    } else {
      notes.push('command migration is planned, not yet enforced (S2 flips commands.enforced)')
    }
    const operations = names.filter((name) => !removed.includes(name))
    if (operations.length === 0) problems.push('the registry has no operation commands left')
    notes.push(operations.length + ' operation command(s)')
  }
}

if (typeof catalog.docs?.install !== 'string' || catalog.docs.install === '') problems.push('docs.install must name the one install section')

if (problems.length > 0) {
  console.error('verify-surface-convergence: FAIL (' + problems.length + ')')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('verify-surface-convergence: OK — ' + catalog.installBundles.length + ' product bundle(s), ' + rows.length + ' row config(s), ' + notes.join('; '))
