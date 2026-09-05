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
 * Usage (CI overlays the flat mirror into the upstream tree):
 *   node packages/scripts/verify-event-pairing.mjs packages/evolution
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'packages/evolution'
const SKIP = new Set(['node_modules', 'lib', 'dist', '.release-staging', '.git', '.next', 'tsdown'])
// Externally owned (README): emitted for platform/user wiring, no in-repo
// production consumer — expected orphans.
const EXEMPT_ORPHANS = new Set(['evolution/review-scheduled', 'evolution/review-error'])
const EMIT_RE = /ctx\.emit\(\s*['"](evolution\/[A-Za-z0-9/-]+)['"]/g
// V4-31 (0.3.26): not every consumer listens on bare `ctx` — activity watches
// plan-applied through `ioCtx.on(...)` (and commandCtx/approvalCtx/toolCtx
// follow the same naming). `\w*ctx` covers every `<x>ctx` receiver without
// widening to generic `.on(` calls.
const ON_RE = /\w*ctx\.on\(\s*['"](evolution\/[A-Za-z0-9/-]+)['"]/g

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
  // reported as a clean "0 orphan" pass.
  console.warn(`verify-event-pairing: no evolution event(s) found under ${root} — check the packages root (a vacuum scan is not a pairing result)`)
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
