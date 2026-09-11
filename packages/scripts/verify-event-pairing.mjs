#!/usr/bin/env node
/**
 * G7.3 event pairing: every `evolution/<event>` a producer emits must have an
 * in-repo consumer listening, and every listener must target an event that is
 * actually emitted — otherwise the wiring is a dead contract or a dangling
 * hook. Events are single-sourced by name (README declares the external-owner
 * exceptions below), so a silent orphan/dangle is a drift that a review would
 * otherwise miss.
 *
 * This is a WARN + summary report, not a fail: the README explicitly declares
 * `evolution/review-scheduled` and `evolution/review-error` as externally owned
 * (consumed by platform/user wiring, not an in-repo `ctx.on`), so those two are
 * expected orphans and are listed as exempt rather than flagged.
 *
 * Production (src/) only — test fixtures that listen for a side effect don't
 * count as a consumer, and tests that emit into a spy don't count as a
 * producer of the product contract.
 *
 * V27 G3.3 — persisted-log coverage: the durable event log
 * (`evolution-core/src/evolution-events.ts`, `$DSH_HOME/evolution/events.json`)
 * declares a `type` union, and the bus check above cannot see it. Every member
 * of that union must have a production READER — a fold that discriminates the
 * type — or an explicit entry in EXEMPT_PERSISTED_TYPES stating why the record
 * is an external-contract observation (a user, script or UI reads the timeline)
 * instead. The check also pins two declaration/implementation pairs: the union
 * must equal the payload validator's case set (an append the validator does not
 * know), and no reader may discriminate a type the union does not declare.
 * Reader detection is scoped to production files that consume the persisted
 * record type (`EvolutionEvent` in the text), because a session-bus
 * discriminant such as `event.type !== 'tool/call'` judges a different union.
 *
 * Usage (works from BOTH layouts: dev `packages/evolution/scripts/…`, flat
 * mirror `packages/scripts/…`; the packages root argument is the evolution
 * tree regardless of layout):
 *   node <scripts-dir>/verify-event-pairing.mjs <packages/evolution-root> [--strict]
 * `--strict` (CI) fails on a vacuum scan or any orphan/dangling listener —
 * the same posture as verify-arch-guards; without it the run is the
 * WARN + summary report described above.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'packages/evolution'
// R-03: a missing root used to surface as a raw ENOENT from readdirSync —
// report the usage line instead (same posture as verify-dependency-closure).
if (!existsSync(root)) {
  console.error(`usage: verify-event-pairing.mjs <packages/evolution-root> [--strict] (root not found: ${root})`)
  process.exit(2)
}
const strict = process.argv.includes('--strict')
const SKIP = new Set(['node_modules', 'lib', 'dist', 'dist.next', 'dist.previous', '.release-staging', '.git', '.next', '.release-staging.next', '.release-staging.previous', 'tsdown'])
// Externally owned (README): emitted for platform/user wiring, no in-repo
// production consumer — expected orphans.
const EXEMPT_ORPHANS = new Set(['evolution/review-scheduled', 'evolution/review-error'])
const EMIT_RE = /\w*[Cc]tx\.emit\(\s*['"](evolution\/[A-Za-z0-9/-]+)['"]/g
// P3 (v15) known boundary: these regexes match LITERAL single/double-quoted
// event names only. `ctx.emit('evolution/' + variable)` and template-literal
// names are invisible to this gate — any future dynamic event name must come
// with a literal registration in evolution-core/src/events.ts AND an updated
// regex here (fail loud rather than silently zero-counting).
// V4-31 (0.3.26) + V5-01 (0.3.30): receivers follow the camelCase `<x>ctx`
// naming (ioCtx/commandCtx/approvalCtx/toolCtx — activity listens on
// `ioCtx.on(...)`), and `\w*ctx` is case-SENSITIVE — it matched only bare
// `ctx` and lowercase `…xctx`, so the very receivers the comment claimed
// were covered were never counted. `(\w*[Cc]tx)` covers both spellings.
const ON_RE = /\w*[Cc]tx\.on\(\s*['"](evolution\/[A-Za-z0-9/-]+)['"]/g

/** File declaring the persisted event log's record type. */
const PERSISTED_EVENT_FILE = 'evolution-core/src/evolution-events.ts'

/**
 * Persisted types with no in-repo fold, declared here WITH the reason the
 * record still earns its place. Both are durable observation records of the
 * self-improvement timeline: `events.json` is documented for users, scripts and
 * the UI (feedback before/after a learn on one target), which is an external
 * contract this gate cannot verify from the source tree.
 */
const EXEMPT_PERSISTED_TYPES = new Map([
  ['learn', 'timeline record of a `/evolution learn` start (request + source); read by users/scripts/UI from events.json, no in-repo fold'],
  ['usage', 'observation-window anchor; the curator\'s usageObserved() gate reads the usage SIDECAR (view_count > 0), so this event is the durable timeline record of the same moment rather than an in-repo input'],
  ['maintain', 'one record per maintenance scan (verdict + recommendation count + runId) for the timeline; no in-repo fold'],
])

const emitted = new Map()
const listened = new Map()
/** Production files that consume the persisted record type, by relative path. */
const eventConsumers = new Map()

/**
 * Read the persisted log's declared type union and the payload validator's case
 * set from the declaration file.
 * @returns `{ declared, cases }`, or `null` when the file or union is unreadable.
 */
function persistedEventTypes() {
  const file = join(root, PERSISTED_EVENT_FILE)
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const body = /export interface EvolutionEvent \{([\s\S]*?)\n\}/.exec(text)?.[1]
  if (body === undefined) return null
  const unionLine = /^\s*type:\s*(.+)$/m.exec(body)?.[1] ?? ''
  const declared = new Set([...unionLine.matchAll(/'([a-z_]+)'/g)].map(match => match[1]))
  const switchAt = text.indexOf('switch (type) {')
  const cases = new Set(switchAt < 0 ? [] : [...text.slice(switchAt).matchAll(/case '([a-z_]+)':/g)].map(match => match[1]))
  return { declared, cases }
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue
      walk(path)
    } else if (entry.name.endsWith('.ts')) {
      const rel = relative(root, path).split('\\').join('/')
      if (!rel.includes('/src/')) continue
      const text = readFileSync(path, 'utf8')
      if (text.includes('EvolutionEvent')) eventConsumers.set(rel, text)
      for (const match of text.matchAll(EMIT_RE)) {
        const name = match[1]
        if (!emitted.has(name)) emitted.set(name, [])
        emitted.get(name).push(rel)
      }
      for (const match of text.matchAll(ON_RE)) {
        const name = match[1]
        if (!listened.has(name)) listened.set(name, [])
        listened.get(name).push(rel)
      }
    }
  }
}

walk(root)

if (emitted.size === 0 && listened.size === 0) {
  // V4-30 (0.3.26): a zero-event scan is either a truly empty tree or a wrong
  // root — the vacuum pass says nothing about pairing, so it must not be
  // reported as a clean "0 orphan" pass. V5-15 (0.3.30): strict mode fails
  // like verify-arch-guards instead of warn-and-exit-0.
  console.warn(`verify-event-pairing: no evolution event(s) found under ${root} — check the packages root (a vacuum scan is not a pairing result)`)
  if (strict) {
    console.error('verify-event-pairing [strict]: a vacuum scan is not a pairing result — check the packages root')
    process.exit(1)
  }
}

const orphans = [...emitted.keys()].filter(name => !listened.has(name) && !EXEMPT_ORPHANS.has(name))
const exemptOrphans = [...emitted.keys()].filter(name => !listened.has(name) && EXEMPT_ORPHANS.has(name))
const dangling = [...listened.keys()].filter(name => !emitted.has(name))

console.log(`verify-event-pairing: ${emitted.size} evolution event(s) emitted, ${listened.size} listened (production src/)`)
if (orphans.length > 0) {
  console.warn(`verify-event-pairing: orphan emitter(s) with no in-repo listener:`)
  for (const name of orphans.sort()) console.warn(`  - ${name}  (${(emitted.get(name) ?? []).join(', ')})`)
}
if (dangling.length > 0) {
  console.warn(`verify-event-pairing: listener(s) with no producer:`)
  for (const name of dangling.sort()) console.warn(`  - ${name}  (${(listened.get(name) ?? []).join(', ')})`)
}
if (exemptOrphans.length > 0) {
  console.log(`verify-event-pairing: exempt external-owner orphan(s) (README): ${exemptOrphans.sort().join(', ')}`)
}

// V27 G3.3: persisted-log type coverage (see the header). A reader is a
// production file that discriminates the type OF A VALUE TYPED AS THE PERSISTED
// RECORD: textual file scoping alone is not enough, because the same file also
// judges session events (`event.type !== 'tool/call'`) and unrelated unions
// (`case 'view':` on a usage action).
const persisted = persistedEventTypes()
const persistedViolations = []
const readers = new Map()
if (persisted === null || persisted.declared.size === 0) {
  persistedViolations.push(`cannot read the persisted event type union from ${PERSISTED_EVENT_FILE} — a vacant scan is not a coverage result`)
} else {
  for (const [rel, text] of eventConsumers) {
    if (rel === PERSISTED_EVENT_FILE) continue
    // Value names statically typed as the record (scalars), plus loop variables
    // over an `EvolutionEvent[]` collection.
    const typedNames = new Set([...text.matchAll(/(\w+)\s*:\s*EvolutionEvent\b/g)].map(match => match[1]))
    for (const arrayMatch of text.matchAll(/(\w+)\s*:\s*EvolutionEvent\[\]/g)) {
      const collection = arrayMatch[1]
      for (const loopMatch of text.matchAll(new RegExp(`for \\(const (\\w+) of ${collection}\\)`, 'g'))) typedNames.add(loopMatch[1])
    }
    for (const name of typedNames) {
      const types = new Set()
      const comparisons = [
        new RegExp(`\\b${name}\\.type\\s*(?:===|!==)\\s*'([a-z_]+)'`, 'g'),
        new RegExp(`'([a-z_]+)'\\s*(?:===|!==)\\s*${name}\\.type`, 'g'),
      ]
      for (const pattern of comparisons) {
        for (const match of text.matchAll(pattern)) if (match[1]) types.add(match[1])
      }
      const switchPattern = new RegExp(`switch \\(${name}\\.type\\)\\s*\\{([^}]*)\\}`, 'g')
      for (const match of text.matchAll(switchPattern)) {
        for (const caseMatch of (match[1] ?? '').matchAll(/case '([a-z_]+)':/g)) if (caseMatch[1]) types.add(caseMatch[1])
      }
      for (const type of types) {
        if (!readers.has(type)) readers.set(type, new Set())
        readers.get(type).add(rel)
      }
    }
  }
  for (const type of [...persisted.declared].sort()) {
    const readBy = readers.get(type)
    if (readBy !== undefined) continue
    if (EXEMPT_PERSISTED_TYPES.has(type)) continue
    persistedViolations.push(`persisted type "${type}" is written but never read in production — attach a reader or add it to EXEMPT_PERSISTED_TYPES with the reason the record is an external contract`)
  }
  for (const type of [...readers.keys()].sort()) {
    if (!persisted.declared.has(type)) {
      persistedViolations.push(`reader discriminates persisted type "${type}", which ${PERSISTED_EVENT_FILE} does not declare (${[...readers.get(type)].join(', ')}) — stale or misspelled discriminant`)
    }
  }
  for (const type of [...EXEMPT_PERSISTED_TYPES.keys()].sort()) {
    if (!persisted.declared.has(type)) persistedViolations.push(`EXEMPT_PERSISTED_TYPES lists "${type}", which is no longer a declared persisted type — drop the stale exemption`)
    else if (readers.has(type)) persistedViolations.push(`EXEMPT_PERSISTED_TYPES lists "${type}", but production now reads it (${[...readers.get(type)].join(', ')}) — drop the exemption`)
  }
  const missingCases = [...persisted.declared].filter(type => !persisted.cases.has(type)).sort()
  const extraCases = [...persisted.cases].filter(type => !persisted.declared.has(type)).sort()
  if (missingCases.length > 0) persistedViolations.push(`evolutionEventPayloadIssue does not validate declared type(s): ${missingCases.join(', ')} — the file boundary would accept a record no consumer can fold`)
  if (extraCases.length > 0) persistedViolations.push(`evolutionEventPayloadIssue validates undeclared type(s): ${extraCases.join(', ')}`)
}

const typeReport = persisted === null
  ? 'unreadable'
  : [...persisted.declared].sort().map(type => {
    const readBy = readers.get(type)
    if (readBy !== undefined) return `${type}=reader(${[...readBy].join(', ')})`
    return EXEMPT_PERSISTED_TYPES.has(type) ? `${type}=exempt(external contract)` : `${type}=ORPHAN`
  }).join(', ')
console.log(`verify-event-pairing: persisted log type(s) in ${PERSISTED_EVENT_FILE}: ${typeReport}`)
for (const violation of persistedViolations) {
  console.warn(`verify-event-pairing: ${strict ? 'FAIL' : 'WARN'} — ${violation}`)
}

console.log(`verify-event-pairing: summary — ${orphans.length} orphan(s), ${dangling.length} dangling listener(s), ${exemptOrphans.length} declared exempt, ${persistedViolations.length} persisted-type violation(s)`)
// V5-15 (0.3.30): strict = the arch-guards posture — any orphan or dangling
// listener is a broken wiring contract the review would otherwise miss.
const failures = orphans.length + dangling.length + persistedViolations.length
if (strict && failures > 0) {
  console.error(`verify-event-pairing [strict]: ${orphans.length} orphan(s), ${dangling.length} dangling listener(s), ${persistedViolations.length} persisted-type violation(s) — fix the wiring (or declare an exempt owner in README / EXEMPT_PERSISTED_TYPES with its reason)`)
  process.exit(1)
}
