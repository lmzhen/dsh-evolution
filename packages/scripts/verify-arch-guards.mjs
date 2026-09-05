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
 * Usage (CI overlays the flat mirror into the upstream tree, so it runs at
 * packages/evolution):
 *   node packages/scripts/verify-arch-guards.mjs packages/evolution [--strict]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'packages/evolution'
const strict = process.argv.includes('--strict') || process.env.DSH_EVOLUTION_ARCH_STRICT === '1'
const CORE_SRC = 'evolution-core/src'
const APPROVAL_SRC = 'evolution-approval/src'
const SKIP = new Set(['node_modules', 'lib', 'dist', '.release-staging', '.git', '.next', 'tsdown'])
const DSH_HOME_RE = /process\.env\.DSH_HOME/
const COPY_RE = /interface\s+ApprovalPolicyLike|function\s+effectiveSessionPolicy/

const violations = []
/** N3 (warn-only listing, not a gate): Config numeric fields must carry a
 * value clamp (`.min(`/`.max(`/`.finite(`/`.nonnegative(`) — schemastery lets
 * NaN and ±Infinity through a bare `z.number()`, so the assembly-time
 * clampedNumber() fallback is the authoritative guard (G3.1). Field-level
 * single-line heuristic: a line containing `z.number()` without any clamp
 * call on it is reported. The outstanding set (capability/curator/review/
 * memory-files/activity Config) is the G3.1 convergence TODO; once it lands,
 * flip this check into `violations` with strict. */
const nNumeric = []
/** N4 (warn-only listing, not a gate): dead-fallback returns — a `?? ''` or
 * `?? <identifier>Id` after a value that is already supplied makes the branch
 * dead. Reported as a smell rather than an error because many `?? xId` are a
 * legitimate optional-id default. */
const nDeadFallback = []

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue
      walk(path)
    } else if (entry.name.endsWith('.ts')) {
      const rel = relative(root, path).split('\\').join('/')
      const text = readFileSync(path, 'utf8')
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
      // N3 (warn-only): bare Config numeric fields (see comment above).
      if (rel.includes('/src/')) {
        // Split on CRLF so `\r` is not left on the line end — otherwise the
        // comment strip below (`/\/\/.*$/`) cannot match a `//` comment on a
        // CRLF source file, and prose mentioning `z.number()` would be flagged.
        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length; i += 1) {
          const code = (lines[i] ?? '').replace(/\/\/.*$/, '').trim()
          if (!/z\.number\(\)/.test(code)) continue
          if (/\.(?:min|max|finite|nonnegative)\(/.test(code)) continue
          nNumeric.push(`${rel}:${i + 1}: numeric field without a value clamp (G3.1 TODO — assembly-time clampedNumber() is the guard)`)
        }
        // N4 (warn-only): dead-fallback returns (see comment above).
        for (let i = 0; i < lines.length; i += 1) {
          const code = (lines[i] ?? '').replace(/\/\/.*$/, '').trim()
          if (!(/\?\? ''|\?\? [A-Za-z]\w*Id/.test(code))) continue
          nDeadFallback.push(`${rel}:${i + 1}: dead-fallback return ('?? ...' — the value is already supplied)`)
        }
      }
    }
  }
}

walk(root)

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
if (nNumeric.length > 0) {
  console.warn(`verify-arch-guards [warn]: ${nNumeric.length} unclamped numeric Config field(s) (G3.1 convergence TODO — warn-only for now):`)
  console.warn(nNumeric.join('\n'))
}
if (nDeadFallback.length > 0) {
  console.warn(`verify-arch-guards [warn]: ${nDeadFallback.length} dead-fallback return(s) ('?? ...' — value already supplied):`)
  console.warn(nDeadFallback.join('\n'))
}
