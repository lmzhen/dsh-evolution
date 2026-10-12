#!/usr/bin/env node
/**
 * G7.1 (audit A8): the plain-object predicate has ONE author.
 *
 * The audit found the clause "typeof x === 'object' && x !== null && !Array.isArray(x)" rewritten
 * fifteen times across nine packages, twice inside the client halves. The host side now imports it
 * from evolution-core/src/guards.ts, and the client halves carry a GENERATED copy (they cannot
 * import core: build-client.mjs externalizes @deepseek-ai/*). This gate keeps it that way:
 *
 *   A. a source line carrying the clause may live only in the home, or in a file whose header says
 *      GENERATED and names the home;
 *   B. the generated copies carry the SAME body as the home (the producer's --check owns the bytes;
 *      this rule catches a hand-inlined variant that dropped the header).
 *
 * Comments are stripped first (judge code, not prose); the guard skips its own file.
 *
 * SCOPE (declared, 0.22.0 / independent review P2-9): the scan walks the plugin packages'
 * TypeScript sources under `packages/evolution-<pkg>/src` (see the OK line for the exact wording).
 * `packages/scripts` is the tooling layer and keeps a few inline spellings of the same clause
 * (`verify-arch-guards.mjs:1980`, `install-layered.mjs:599`); those files are `.mjs` and cannot
 * import the TypeScript home, so the omission is a DECLARED exception, not an oversight. A new
 * inline copy inside the plugin sources still fails.
 *
 * Usage: node packages/scripts/verify-predicate-single-source.mjs [packages-root]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './lib-source-text.mjs'

const root = process.argv[2] ?? 'packages'
const HOME = join('evolution-core', 'src', 'guards.ts')
const CLAUSE = /typeof\s+[\w.$]+\s*===\s*'object'[^\n]*!Array\.isArray\(|!Array\.isArray\([^\n]*typeof\s+[\w.$]+\s*===\s*'object'/
const problems = []
let scanned = 0
let generated = 0

const walk = (dir, visit) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(path, visit) }
    else if (entry.name.endsWith('.ts')) visit(path)
  }
}

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('evolution-')) continue
  const src = join(root, entry.name, 'src')
  try {
    walk(src, (file) => {
      scanned += 1
      const raw = readFileSync(file, 'utf8')
      const isHome = file.endsWith(HOME)
      const isGenerated = raw.startsWith('// GENERATED FILE') && raw.includes('guards.ts')
      if (!CLAUSE.test(stripComments(raw))) return
      if (isHome) return
      if (isGenerated) { generated += 1; return }
      problems.push(file + ': carries its own plain-object predicate — import it from ' + HOME + ' (client halves use the generated copy)')
    })
  } catch (error) {
    problems.push(src + ': unreadable (' + String(error.message) + ')')
  }
}

// A vacuum pass is not a pass: a root that exists but matches no source file judges nothing at
// all, and this gate used to exit 0 there (independent review P2-5). The arming audit carries
// the same rule for the same reason.
if (scanned === 0) {
  console.error('verify-predicate-single-source: a vacuum pass is not a pass — no source file matched the given root')
  process.exit(1)
}
if (problems.length > 0) {
  console.error('verify-predicate-single-source: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-predicate-single-source: OK — 1 author (' + HOME + '), ' + generated + ' generated copy(ies), ' +
  scanned + ' plugin source file(s) scanned (scope: packages/evolution-*/src/**; packages/scripts/** is tooling)')
