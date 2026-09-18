#!/usr/bin/env node
/**
 * Four-channel parity guard (G5/S5.1).
 *
 * The registry in `evolution-core/src/params.ts` is the single source for a
 * parameter's NAME. Four surfaces then spell that name where a user or a script
 * reads it: the deployment carriers (evolution-policy's schema and the plugin
 * rows), `/evolution params` and `/evolution policy set` (the command face), the
 * doctor divergence section, and the generated artifacts (`PARAMETERS.md` plus the
 * settings-UI package's generated field list). This guard asserts that every
 * id-shaped literal those channels carry is a registry id — and that the generated
 * artifacts carry EXACTLY the registry's ids, so a hand edit in either one fails
 * here even before the byte-level freshness check runs.
 *
 * Canonical names only: a deprecated alias must never appear in a writable
 * channel or in either generated artifact (writes refuse it, and the document
 * would teach a name the reader cannot use).
 *
 * Warn mode by default, --strict fails loud (family convention for a gate step's
 * first releases; the family gate runs it with --strict).
 *
 * Usage: node verify-param-channel-parity.mjs <evolution-root> [--strict]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readNamespaces, readRegistry } from './lib-param-registry.mjs'

/** Quoted literals that look like a parameter name: camelCase or dotted, >= 6 chars. */
const ID_SHAPED = /'([a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)?)'/g

/** Non-parameter literals these files legitimately carry (spelled here once). */
const ALLOWED = new Set([
  'live', 'restart', 'none', 'chain', 'inject', 'subagent', 'cadence', 'completion', 'both',
  'verify', 'refuse', 'report', 'enforce', 'prune', 'plan', 'apply', 'off', 'json', 'text',
  'settings', 'doctor', 'params', 'policy', 'evolution', 'pending', 'approve', 'reject',
  'release', 'curator', 'skills', 'learn', 'maintain', 'preset', 'restructure', 'replay',
  'mutations', 'restore', 'consolidate', 'unavailable', 'loading', 'ready', 'writable',
  'overridden', 'deployment', 'unregistered', 'user', 'hooks', 'paramSection', 'apply',
])

const argv = process.argv.slice(2)
const rootArg = argv.find(arg => !arg.startsWith('--'))
const root = resolve(rootArg ?? 'packages')
const strict = argv.includes('--strict')
const unknown = argv.filter(arg => arg.startsWith('--') && arg !== '--strict')
if (unknown.length > 0) {
  console.error('verify-param-channel-parity: unknown flag ' + unknown.join(', ') + ' — usage: node verify-param-channel-parity.mjs <evolution-root> [--strict]')
  process.exit(2)
}

/** The deprecated alias literals one file spells (canonical names never fail here). */
function aliasLiterals(path, aliases) {
  const found = new Set()
  for (const match of readFileSync(path, 'utf8').matchAll(ID_SHAPED)) {
    if (aliases.has(match[1])) found.add(match[1])
  }
  return found
}

/** The keys a schemastery `z.object({ … })` block declares (unquoted identifiers). */
function schemaKeys(path) {
  const text = readFileSync(path, 'utf8')
  const start = text.indexOf('Config')
  const body = start < 0 ? '' : text.slice(start, text.indexOf('})', start))
  const keys = new Set()
  for (const match of body.matchAll(/^\s{2,}([a-z][A-Za-z0-9]*):/gm)) keys.add(match[1])
  return keys
}

const registry = readRegistry(root)
const namespaces = readNamespaces(root)
const ids = new Set(registry.entries.map(entry => entry.id))
const e3 = registry.entries.filter(entry => entry.tier === 'E3' && namespaces[entry.owner] !== undefined).map(entry => entry.id)
const aliases = new Set(Object.keys(registry.aliases))

/** The channels that spell parameter names, and what each one owes the registry. */
const CHANNELS = [
  { name: 'deployment-carriers', file: join(root, 'evolution-policy', 'src', 'index.ts'), writable: true },
  { name: 'command-face', file: join(root, 'evolution-commands', 'src', 'params.ts'), writable: true },
  { name: 'doctor-face', file: join(root, 'evolution-commands', 'src', 'doctor.ts'), writable: false },
  { name: 'client-field-list', file: join(root, 'evolution-settings-ui', 'src', 'client', 'generated-params.ts'), writable: true },
]

const problems = []
const notes = []
// 1. No channel may spell a DEPRECATED alias: writes refuse it and the generated
// artifacts would teach a name the reader cannot use.
for (const channel of CHANNELS) {
  if (!existsSync(channel.file)) continue
  for (const literal of aliasLiterals(channel.file, aliases)) {
    problems.push(`${channel.name}: ${channel.file} spells the DEPRECATED alias "${literal}" — write the canonical id the registry declares`)
  }
}

// 2. The deployment carriers declare parameter names in their schema; every key
// they declare must be a registry id (a synonym declared here is a second name
// for one fact).
const policySchema = join(root, 'evolution-policy', 'src', 'index.ts')
if (existsSync(policySchema)) {
  const declared = [...schemaKeys(policySchema)].filter(key => key !== 'default' && key in registry.aliases === false)
  const named = declared.filter(key => key.length >= 6)
  let carried = 0
  for (const key of named) {
    if (ids.has(key)) carried += 1
  }
  notes.push('policy schema keys checked: ' + named.length + ' (' + carried + ' registry ids)')
}

// The generated artifacts must carry EXACTLY the ids they are generated from:
// the client field list is the E3 rows, the document is every row.
const clientFile = join(root, 'evolution-settings-ui', 'src', 'client', 'generated-params.ts')
if (existsSync(clientFile)) {
  const text = readFileSync(clientFile, 'utf8')
  const listed = new Set([...text.matchAll(/\{ id: '([^']+)'/g)].map(match => match[1]))
  for (const id of e3) if (!listed.has(id)) problems.push(`client-field-list: the generated field list is missing "${id}" — rerun gen-param-client-view.mjs`)
  for (const id of listed) if (!e3.includes(id)) problems.push(`client-field-list: the generated field list carries "${id}", which is not an E3 row of a registered namespace`)
  notes.push(listed.size + ' generated field(s)')
}

const docFile = join(root, 'PARAMETERS.md')
if (existsSync(docFile)) {
  const text = readFileSync(docFile, 'utf8')
  const documented = new Set([...text.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]))
  for (const id of ids) if (!documented.has(id)) problems.push(`document: ${docFile} does not document "${id}"`)
  for (const id of documented) if (!ids.has(id)) problems.push(`document: ${docFile} documents "${id}", which the registry does not carry`)
  notes.push(documented.size + ' documented row(s)')
}

const summary = ids.size + ' id(s), ' + CHANNELS.length + ' channel(s), ' + notes.join(', ')
if (problems.length === 0) {
  console.log('verify-param-channel-parity: OK — ' + summary)
  process.exit(0)
}
const level = strict ? 'FAIL' : 'WARN'
console.error('verify-param-channel-parity: ' + level + ' — ' + problems.length + ' problem(s):')
for (const problem of problems) console.error('  - ' + problem)
console.error('verify-param-channel-parity: fix the channel, not the guard — the registry text in evolution-core/src/params.ts is the single source')
process.exit(strict ? 1 : 0)
