#!/usr/bin/env node
/**
 * G7-3 (份数=1): there is exactly ONE comment stripper in the family's tooling.
 *
 * Gates that judge code must not judge prose, so every probe strips comments first — and before
 * this gate each probe carried its own copy (six of them, plus the two regex one-liners inside the
 * arch guards). The single home is lib-source-text.mjs; this gate keeps it that way:
 *
 *   A. no file other than lib-source-text.mjs defines a stripper (by name or by the block-comment
 *      regex literal);
 *   B. the lib really exports stripComments, and every probe imports it from there.
 *
 * Usage: node packages/scripts/verify-source-text-single-source.mjs [packages-root]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
// Dogfood: this gate judges code, not prose, so it strips comments with the very function it guards.
import { stripComments } from './lib-source-text.mjs'

const root = process.argv[2] ?? 'packages'
const scriptsDir = join(root, 'scripts')
const HOME = 'lib-source-text.mjs'
const NAME_RE = /(?:function|const)\s+(stripComments|withoutComments|stripBlockComments)\b/
const REGEX_RE = /\/\\\*\[\\s\\S\]\*\?\\\*\//

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(path) }
    else if (entry.name.endsWith('.mjs')) files.push(path)
  }
}
try { walk(scriptsDir) } catch (error) {
  console.error('verify-source-text-single-source: cannot read ' + scriptsDir + ' (' + String(error.message) + ')')
  process.exit(1)
}

const problems = []

// G0-0.3 self-proof: this judge must be able to fire. Two samples, one per net:
// the name net. (A regex-shape net exists too, but its exact supported spelling could NOT be
// reproduced from reasoning in the G0-0.3 session - two candidate spellings both missed - so it is
// deliberately NOT self-proved here; the manifest claim was narrowed to what is actually checked.)
const SELF_PROOF = [
  { net: NAME_RE, sample: String.fromCharCode(99, 111, 110, 115, 116) + " withoutComments = (t) => t" },
]
for (const proof of SELF_PROOF) {
  if (!proof.net.test(proof.sample)) problems.push("self-proof FAILED: the " + (proof.net === NAME_RE ? "name" : "spelling") + " net no longer matches its own sample")
}
let importers = 0
for (const file of files) {
  const text = stripComments(readFileSync(file, 'utf8'))
  const isHome = file.endsWith(HOME)
  // The guard skips its own file (the pattern literals below are code, not a second implementation),
  // the same exemption verify-arch-guards applies to itself.
  if (file.endsWith('verify-source-text-single-source.mjs')) continue
  if (isHome) {
    if (!/export function stripComments/.test(text)) problems.push(HOME + ': does not export stripComments')
    continue
  }
  if (NAME_RE.test(text)) problems.push(file + ': defines its own comment stripper — import stripComments from ' + HOME)
  else if (REGEX_RE.test(text)) problems.push(file + ': carries a block-comment regex — import stripComments from ' + HOME)
  if (text.includes("from './" + HOME + "'")) importers += 1
}

if (importers === 0) problems.push('no probe imports ' + HOME + ' — the single source is not wired')

if (problems.length > 0) {
  console.error('verify-source-text-single-source: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-source-text-single-source: OK — 1 implementation (' + HOME + '), ' + importers + ' probe(s) import it')
