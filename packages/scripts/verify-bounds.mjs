#!/usr/bin/env node
/**
 * G2.4 (contract C3): ONE lock, ONE upper bound.
 *
 * The family's mutual exclusion and its wall-clock ceilings used to be re-invented per package. The
 * plan freezes two shapes instead (C3), and this gate keeps them:
 *
 *   A. ONE LOCK — a module-scope guard that gates an instance-level concern may only be the shared
 *      implementation (`evolution-core/src/instance-scope.ts`, which owns `claimInstance`) or a
 *      PLATFORM piece (`hmr.runExclusive`, `SubagentRun.dispose`, the IO write lock). A file that
 *      re-invents one — a module-scope `let x = false` or a bespoke `new Map(...)` next to an
 *      instance-idiom name — is reported. ("非竞争失败不得删活锁" is the rule this makes mechanical.)
 *   B. ONE UPPER BOUND — a timer call may not carry a BARE millisecond literal
 *      (`setTimeout(fn, 5000)`); the ceiling comes from a named constant, a config value or the
 *      shared clamp. Timeout constants that DUPLICATE another package's value are REPORTED (they are
 *      the second home of the same number, not an error on their own).
 *
 * Comments are stripped first (line-preserving), and the guard skips itself.
 *
 * Usage: node packages/scripts/verify-bounds.mjs [packages-root]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './lib-source-text.mjs'

const root = process.argv[2] ?? 'packages'
const problems = []
const notices = []
const timeoutValues = new Map()
let scanned = 0

const INSTANCE_IDIOM = /instanceHome|holdsInstance|claimInstance|single-?flight/
const SELF_MADE_GUARD = /(let|var)\s+[A-Za-z_$][\w$]*\s*=\s*false|new Map\(/
/** The call positions where a bare number IS a ceiling. */
const TIMER_CALL = /(setTimeout|setInterval|AbortSignal\.timeout|sleep)\s*\(.*,\s*(\d[\d_]*)\s*\)/
const TIMEOUT_CONST = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*(?:TIMEOUT|_MS)[A-Z0-9_]*)\s*=\s*(\d[\d_]*)/

const walk = (dir, visit) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) { if (entry !== 'tests' && entry !== 'dist') walk(path, visit) }
    else if (entry.endsWith('.ts')) visit(path)
  }
}

for (const dir of readdirSync(root)) {
  if (!dir.startsWith('evolution-') && dir !== 'tool-memory' && dir !== 'tool-skill-manage' && dir !== 'memory' && dir !== 'memory-files' && dir !== 'skill-usage') continue
  const src = join(root, dir, 'src')
  try {
    walk(src, (file) => {
      if (file.endsWith('instance-scope.ts')) return
      scanned += 1
      const code = stripComments(readFileSync(file, 'utf8'))
      // A: a self-made instance guard. A file that CONSUMES the shared claimInstance is the shape we
      // want — only one that rolls its own guard beside the idiom is a violation.
      if (INSTANCE_IDIOM.test(code) && SELF_MADE_GUARD.test(code) && !/claimInstance\s*\(/.test(code)) {
        problems.push(file + ': re-invents an instance guard next to an instance-idiom name — use the shared claimInstance or a platform piece')
      }
      for (const line of code.split(String.fromCharCode(10))) {
        // B1: a bare ceiling in a timer call.
        const timer = TIMER_CALL.exec(line)
        if (timer !== null && timer[2].replace(/_/g, '').length >= 3) {
          problems.push(file + ': ' + timer[1] + ' carries a bare millisecond literal (' + timer[2] + ') — name the ceiling')
        }
        // B2: a duplicate timeout constant (a notice, not a failure).
        const constant = TIMEOUT_CONST.exec(line)
        if (constant !== null) {
          const value = constant[2].replace(/_/g, '')
          // A millisecond ceiling is a 3+ digit number; two names for the same value inside ONE file are
          // deliberate, only a SECOND package's copy is the second home this rule is about.
          if (value.length < 3) continue
          const home = timeoutValues.get(value)
          if (home === undefined) timeoutValues.set(value, file)
          else if (home !== file) notices.push(file + ': ' + constant[1] + ' duplicates the value ' + value + ' already declared in ' + home)
        }
      }
    })
  } catch { /* a package without src is fine */ }
}

// A vacuum pass is not a pass: a root that exists but matches no source file judges nothing at
// all, and this gate used to exit 0 there (independent review P2-5). The arming audit carries
// the same rule for the same reason.
if (scanned === 0) {
  console.error('verify-bounds: a vacuum pass is not a pass — no source file matched the given root')
  process.exit(1)
}
if (problems.length > 0) {
  console.error('verify-bounds: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
for (const notice of notices) console.warn('  bounds-duplicate: ' + notice)
console.log('verify-bounds: OK — one lock, one upper bound over ' + scanned + ' source file(s); ' +
  timeoutValues.size + ' named ceiling(s), ' + notices.length + ' duplicate(s)')
