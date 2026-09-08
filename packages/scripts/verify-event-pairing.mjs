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
const SKIP = new Set(['node_modules', 'lib', 'dist', '.release-staging', '.git', '.next', '.release-staging.next', '.release-staging.previous', 'tsdown'])
// Externally owned (README): emitted for platform/user wiring, no in-repo
// production consumer — expected orphans.
const EXEMPT_ORPHANS = new Set(['evolution/review-scheduled', 'evolution/review-error'])
const EMIT_RE = /\w*[Cc]tx\.emit\(\s*['"](evolution\/[A-Za-z0-9/-]+)['"]/g
// V4-31 (0.3.26) + V5-01 (0.3.30): receivers follow the camelCase `<x>ctx`
// naming (ioCtx/commandCtx/approvalCtx/toolCtx — activity listens on
// `ioCtx.on(...)`), and `\w*ctx` is case-SENSITIVE — it matched only bare
// `ctx` and lowercase `…xctx`, so the very receivers the comment claimed
// were covered were never counted. `(\w*[Cc]tx)` covers both spellings.
const ON_RE = /\w*[Cc]tx\.on\(\s*['"](evolution\/[A-Za-z0-9/-]+)['"]/g

const emitted = new Map()
const listened = new Map()

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
console.log(`verify-event-pairing: summary — ${orphans.length} orphan(s), ${dangling.length} dangling listener(s), ${exemptOrphans.length} declared exempt`)
// V5-15 (0.3.30): strict = the arch-guards posture — any orphan or dangling
// listener is a broken wiring contract the review would otherwise miss.
if (strict && (orphans.length > 0 || dangling.length > 0)) {
  console.error(`verify-event-pairing [strict]: ${orphans.length} orphan(s), ${dangling.length} dangling listener(s) — fix the wiring (or declare an exempt owner in README)`)
  process.exit(1)
}
