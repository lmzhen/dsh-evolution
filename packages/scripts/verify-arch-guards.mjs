#!/usr/bin/env node
/**
 * G7.1 architecture guards: two zero-tolerance checks that keep the family
 * converging on its single-source contracts.
 *   N1. `process.env.DSH_HOME` may only appear in evolution-core/src — every
 *       other package must route DSH_HOME through core's home resolver, so the
 *       directory never drifts between producers.
 *   N2. `ApprovalPolicyLike` / `effectiveSessionPolicy` are single-sourced in
 *       the approval package (0.3.22 G4.8; previously evolution-core) — a local
 *       copy anywhere else is a drift that will silently diverge from the
 *       contract.
 *
 * The checks are intentionally fail-loud (zero tolerance): until the G3/G4
 * convergence lands, they report the outstanding copies as a TODO list rather
 * than letting a duplicate drift get merged silently.
 *
 * 0.3.21: runs in WARN mode by default (the 5 outstanding copies are the
 * G3.2/G4.8 convergence TODO — blocking CI on them would hold back this
 * release). Pass `--strict` (or set DSH_EVOLUTION_ARCH_STRICT=1) to fail
 * loud; flip the CI invocation to strict once G3/G4 convergence lands.
 * 0.3.22 (G4.8): N2 single-source moved to evolution-approval/src — the
 * exemption list follows the authority.
 *
 * H2 (0.3.58) heuristic boundary (N18, v12): the ghost-service-key probe is
 * textual — it detects `has('evolutionX…')` probes and `super(ctx,'…')` /
 * `.provide('…')` declarations. Forms it does NOT see: double-quoted calls,
 * array-form `inject(['evolutionX'])` declarations, and constant indirection
 * where the key never appears as a string literal. Documented, not a
 * guarantee: a new ghost key hidden behind indirection needs the pairing
 * inventory (verify-event-pairing / service-key listing), not this script.
 *
 * Usage (works from BOTH layouts — dev `packages/evolution/scripts/…`, flat
 * mirror `packages/scripts/…`; the packages root argument is the evolution
 * tree regardless of layout):
 *   node <scripts-dir>/verify-arch-guards.mjs <packages/evolution-root> [--strict]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'packages/evolution'
// R-03: a missing root used to surface as a raw ENOENT from readdirSync —
// report the usage line instead (same posture as verify-dependency-closure).
if (!existsSync(root)) {
  console.error(`usage: verify-arch-guards.mjs <packages/evolution-root> [--strict] (root not found: ${root})`)
  process.exit(2)
}
const strict = process.argv.includes('--strict') || process.env.DSH_EVOLUTION_ARCH_STRICT === '1'
const CORE_SRC = 'evolution-core/src'
const APPROVAL_SRC = 'evolution-approval/src'
const SKIP = new Set(['node_modules', 'lib', 'dist', 'dist.next', 'dist.previous', '.release-staging', '.git', '.next', '.release-staging.next', '.release-staging.previous', 'tsdown'])
const DSH_HOME_RE = /process\.env\.DSH_HOME/
const COPY_RE = /interface\s+ApprovalPolicyLike|function\s+effectiveSessionPolicy/
let checkedCount = 0

const violations = []
/** N3 (gate, 0.3.25): Config numeric fields must carry a value clamp
 * (`.min(`/`.max(`/`.finite(`/`.nonnegative(`) — schemastery lets NaN and
 * ±Infinity through a bare `z.number()`, so the assembly-time clampedNumber()
 * fallback is the authoritative guard (G3.1). Field-level single-line
 * heuristic: a line containing `z.number()` without any clamp call is a
 * violation. 0.3.23 held the remaining fields as a warn-only TODO; 0.3.25
 * clamped them all (N3 = 0), so the check flipped into the violations gate.
 * */
/** H2 (v11): P0-1-class guard — a probed `evolution[A-Z]\w+` service key
 * must have a provider SOMEWHERE in the tree. doctor probed `evolutionReview`
 * for five releases with zero providers and the self-check silently lied;
 * this catches the next ghost key statically. */
const probedEvolutionKeys = new Set()
const providedEvolutionKeys = new Set()
const PROBE_RE = /(?:\bhas|\.get|ctx\.get)\('(evolution[A-Z]\w+)'\)/g
const PROVIDE_RE = /(?:super\([^)]*,\s*'|\.provide\('|provide\(')(evolution[A-Z]\w+)'/g

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue
      walk(path)
    } else if (entry.name.endsWith('.ts')) {
      checkedCount += 1
      const rel = relative(root, path).split('\\').join('/')
      const text = readFileSync(path, 'utf8')
      // H2 (v11): collect probe/provider pairs for the ghost-key check.
      for (const match of text.matchAll(PROBE_RE)) probedEvolutionKeys.add(match[1])
      for (const match of text.matchAll(PROVIDE_RE)) providedEvolutionKeys.add(match[1])
      // N1: production routing — only files under a package's src/ are
      // checked, so test fixtures that set DSH_HOME for an isolated home are
      // not treated as single-source drift.
      if (rel.includes('/src/') && DSH_HOME_RE.test(text) && !rel.startsWith(`${CORE_SRC}/`)) {
        violations.push(`${rel}: reads process.env.DSH_HOME outside ${CORE_SRC} (route through core's home resolver)`)
      }
      // N2: any local copy outside the canonical authority (approval, then core).
      if (rel.includes('/src/') && COPY_RE.test(text) && !rel.startsWith(`${APPROVAL_SRC}/`) && !rel.startsWith(`${CORE_SRC}/`)) {
        violations.push(`${rel}: local copy of ApprovalPolicyLike/effectiveSessionPolicy (single-source in ${APPROVAL_SRC})`)
      }
      // N3 (gate): bare Config numeric fields (see comment above).
      // P2-40 (v11) heuristic boundary: single-LINE scanning only — a
      // chained `z.number()\n  .min(1)` is a FALSE POSITIVE on its first
      // line, and block comments/string literals are NOT stripped (a
      // `z.number()` in prose still flags). The repo's current single-line
      // style keeps both at zero; change the scanning if the style changes.
      if (rel.includes('/src/')) {
        // Split on CRLF so `\r` is not left on the line end — otherwise the
        // comment strip below (`/\/\/.*$/`) cannot match a `//` comment on a
        // CRLF source file, and prose mentioning `z.number()` would be flagged.
        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length; i += 1) {
          const code = (lines[i] ?? '').replace(/\/\/.*$/, '').trim()
          if (!/z\.number\(\)/.test(code)) continue
          if (/\.(?:min|max|finite|nonnegative)\(/.test(code)) continue
          violations.push(`${rel}:${i + 1}: numeric field without a value clamp (route through clampedNumber + a .min/.max schema bound)`)
        }
      }
    }
  }
}

walk(root)

// H2 (v11): a probed evolution service key without ANY provider is the
// P0-1 class (doctor's evolutionReview ghost) — fail the gate.
const orphanKeys = [...probedEvolutionKeys].filter(key => !providedEvolutionKeys.has(key))
if (orphanKeys.length > 0) {
  violations.push(`ghost service key(s) probed but never provided: ${orphanKeys.join(', ')} (an evolution service key with zero providers makes a diagnosis silently lie)` )
}

if (checkedCount === 0) {
  // V4-30 (0.3.26): the guard must never pass on an unscanned tree (the F-103
  // vacant-guard class) — a wrong root or an empty overlay fails loud.
  const message = `verify-arch-guards: no .ts file(s) scanned under ${root} — check the packages root (a vacuum pass is not a pass)`
  if (strict) {
    console.error(`verify-arch-guards [strict]: ${message}`)
    process.exit(1)
  }
  console.warn(`verify-arch-guards [warn]: ${message}`)
}

if (violations.length > 0) {
  const summary = `${violations.length} architecture guard violation(s)`
  if (strict) {
    console.error(`verify-arch-guards [strict]: ${summary}:`)
    console.error(violations.join('\n'))
    console.error('verify-arch-guards: these are the G3/G4 convergence TODO list — do not add new copies; single-source the symbol instead.')
    process.exit(1)
  }
  console.warn(`verify-arch-guards [warn]: ${summary} (convergence TODO — G3.2/G4.8):`)
  console.warn(violations.join('\n'))
} else {
  console.log(`verify-arch-guards: OK — no DSH_HOME reads outside ${CORE_SRC}, no ApprovalPolicyLike/effectiveSessionPolicy copies outside ${APPROVAL_SRC}`)
}
// P3-2 (v14): the N4 "dead-fallback return" listing was REMOVED. Its heuristic
// matched `?? ''` / `?? <id>Id` textually with no type information, so all 78
// reported lines were idiomatic `noUncheckedIndexedAccess`/optional-field
// guards (`regex[1] ?? ''`, `lines[i] ?? ''`, `config.root ?? ''`) — a signal
// with zero true positives that printed on every run and trained reviewers to
// ignore the section. A type-aware equivalent belongs to oxlint, not here.
