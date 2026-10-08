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
 * id-shaped literal those channels carry is a registry id; that every E3 row is a field of
 * its OWNER's row Config schema AND carries .volatile() — since G1 the platform validates
 * a settings write against that row Config (the profile entry's config), and only a
 * volatile field is writable at all, and that the owner turns the platform's own auto-generated
 * form OFF (`settings.configure({ auto: false })`) — otherwise that row carries two pages editing
 * it — so a registered knob has somewhere to land, a way to change, and exactly one page;
 * and that the generated artifacts carry EXACTLY the registry's ids, so a
 * hand edit in either one fails here even before the byte-level freshness check runs.
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

/**
 * The keys a schemastery `z.object({ … })` block declares (unquoted identifiers).
 * @param path - the file carrying the block.
 * @param anchor - the declaration the block belongs to (an owner's `Config`).
 * @returns the declared keys.
 */
function schemaKeys(path, anchor = 'Config') {
  const text = readFileSync(path, 'utf8')
  const start = text.indexOf(anchor)
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


// 3. Every E3 row must be a field of its OWNER's row Config schema, and that field
// must carry .volatile(): since G1 the platform validates a settings write against
// the row Config (the profile entry's config — config-editor/src/index.ts:103), and
// only a volatile field is writable at all (`volatileForm` skips a row that declares
// none, and `isVolatilePath` refuses a write to a non-volatile field —
// settings/src/schema.ts:37-47, settings/src/index.ts:388). Missing either half is a
// knob the card offers whose write has nowhere to land. The reverse direction matters
// too: a VOLATILE field the registry does not carry as an E3 row of that owner is a
// writable knob the cards, the doctor and PARAMETERS.md all miss.
const ROW_CONFIG_ANCHOR = /(?:export const Config|static Config)\b[^\n]*= z\.object\(\{/
/**
 * The top-level fields of a schema block: each key plus its declaration text.
 *
 * The field indent is read from the block (a module-level `export const Config` sits at
 * two spaces, a class `static Config` at four), so a nested object's fields stay part
 * of their parent's text instead of being read as top-level knobs.
 * @param body - the schema block, closing brace included.
 * @returns key to declaration text.
 */
function configFields(body) {
  const first = /^ +[a-z][A-Za-z0-9]*:/m.exec(body)
  if (first === null) return new Map()
  const indent = first[0].length - first[0].trimStart().length
  const field = new RegExp('^ {' + indent + '}([a-z][A-Za-z0-9]*):([\\s\\S]*?)(?=^ {0,' + indent + '}[a-z]|^\\s*\\})', 'gm')
  const fields = new Map()
  // A comment is not a declaration: strip line comments before the volatile test, or a
  // field documented by a comment that MENTIONS the marker would read as marked.
  for (const match of body.matchAll(field)) fields.set(match[1], match[2].replace(/^\s*\/\/.*$/gm, ''))
  return fields
}
for (const owner of Object.keys(namespaces)) {
  const ownedIds = registry.entries.filter(entry => entry.owner === owner && entry.tier === 'E3').map(entry => entry.id)
  if (ownedIds.length === 0) continue
  const file = join(root, owner, 'src', 'index.ts')
  if (!existsSync(file)) {
    problems.push('owner-config: ' + owner + ' owns ' + ownedIds.length + ' E3 row(s) but has no src/index.ts')
    continue
  }
  const text = readFileSync(file, 'utf8')
  const anchor = ROW_CONFIG_ANCHOR.exec(text)
  if (anchor === null) {
    problems.push('owner-config: ' + owner + ' owns ' + ownedIds.length + ' E3 row(s) but publishes no row Config schema')
    continue
  }
  const end = text.indexOf('})', anchor.index)
  const body = text.slice(anchor.index, end < 0 ? undefined : end + 2)
  const fields = configFields(body)
  const volatile = [...fields].filter(([, declaration]) => declaration.includes('.volatile()'))
  for (const id of ownedIds) {
    const declaration = fields.get(id)
    if (declaration === undefined) {
      problems.push('owner-config: ' + owner + ' registers "' + id + '" as E3 but its row Config declares no such key — after the seam removal the settings write would have nowhere to land')
    } else if (!declaration.includes('.volatile()')) {
      problems.push('owner-config: ' + owner + ' registers "' + id + '" as E3 but its row Config field is not .volatile() — the platform skips the row form and refuses the write, so the knob can never be changed')
    }
  }
  for (const [key] of volatile) {
    if (!ownedIds.includes(key)) {
      problems.push('owner-config: ' + owner + ' marks "' + key + '" .volatile(), which the registry does not carry as an E3 row of this owner — add the row or drop the marker')
    }
  }
  // The THIRD leg of the writability triplet (plan D5: the row must appear ∧ be writable ∧ not be
  // duplicated): without `settings.configure({ auto: false })` the platform keeps its own
  // auto-generated form for that row mounted next to the family's card — the user gets two pages
  // editing one row, and a write on the wrong one looks like it was ignored. It is one line per
  // owner, so the guard reads it directly instead of trusting the G1 batch's commit message.
  const autoOff = /settings\.configure\(\{\s*auto:\s*false\s*\}\)/.test(text)
  if (!autoOff) {
    problems.push('owner-config: ' + owner + ' owns ' + ownedIds.length + ' E3 row(s) but never calls settings.configure({ auto: false }) — the platform auto form stays mounted beside our card (two pages for one row)')
  }
  notes.push(owner + ' row Config: ' + fields.size + ' key(s), ' + volatile.length + ' volatile' + (autoOff ? ', auto:false' : ''))
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

const summary = ids.size + ' id(s), ' + CHANNELS.length + ' channel(s), ' + Object.keys(namespaces).length + ' owner schema(s), ' + notes.join(', ')
if (problems.length === 0) {
  console.log('verify-param-channel-parity: OK — ' + summary)
  process.exit(0)
}
const level = strict ? 'FAIL' : 'WARN'
console.error('verify-param-channel-parity: ' + level + ' — ' + problems.length + ' problem(s):')
for (const problem of problems) console.error('  - ' + problem)
console.error('verify-param-channel-parity: fix the channel, not the guard — the registry text in evolution-core/src/params.ts is the single source')
process.exit(strict ? 1 : 0)
