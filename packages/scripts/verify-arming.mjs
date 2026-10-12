#!/usr/bin/env node
/**
 * verify-arming — the SECOND meta-gate (G1.2, contract: “控制是否有牙”).
 *
 * Why: a rule can be perfectly written and still never judge anything — because its scan found no
 * files, because a counter was computed and discarded, or because a file-level exemption swallowed
 * every input. The detector self-test proves a PREDICATE bites a synthetic string; it cannot prove the
 * rule bit THIS tree. This gate consumes the guard’s machine-readable arming report and asserts the
 * missing half: every rule family actually scanned the real tree.
 *
 * The wiring half (“a declared check must be run by CI or registered local-only”) is ALREADY owned by
 * verify-arch-guards’ doc-facts rule — this gate deliberately does not re-implement it (single source).
 *
 * usage: node verify-arming.mjs [--packages <root>] [--strict]
 *        expects to be run where the family tree lives (mirror or dev layout).
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined }
const strict = argv.includes('--strict')
const root = flag('--packages') ?? (existsSync(join(here, '..', 'evolution-core')) ? resolve(here, '..') : resolve(here, '..', '..', 'packages'))
const guard = join(here, 'verify-arch-guards.mjs')

let report
try {
  const out = execFileSync(process.execPath, [guard, root, '--arming-json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  report = JSON.parse(out.split('\n').find((line) => line.startsWith('{')) ?? '{}')
} catch (error) {
  const out = String(error.stdout ?? '')
  const json = out.split('\n').find((line) => line.startsWith('{'))
  if (json === undefined) { console.error('verify-arming: the guard produced no arming report — every rule is unverified (a missing report is not a pass)'); console.error(out.slice(-400)); process.exit(2) }
  report = JSON.parse(json)
}

const problems = []
const notes = []
const scanned = report.scanned ?? {}
const declared = new Set(report.declaredDetectors ?? [])
const present = new Set(report.detectors ?? [])

for (const [kind, files] of Object.entries(scanned)) {
  if (!(files > 0)) problems.push('the ' + kind + ' scan found 0 file(s) on ' + root + ' — that rule family is unarmed (a vacuum pass is not a pass)')
}
if (Object.keys(scanned).length === 0) problems.push('the arming report carries no scan counters at all')
for (const id of declared) if (!present.has(id)) problems.push(id + ' declares a detector sample but has no detector')
if ((report.rules ?? 0) === 0) problems.push('the arming report says the registry is empty')
if ((report.violations ?? 0) > 0) notes.push(report.violations + ' guard violation(s) in the same run (see verify-arch-guards)')

const summary = 'rules=' + (report.rules ?? '?') + ' detectors=' + present.size + ' scanned=' + Object.entries(scanned).map(([k, n]) => k + ':' + n).join(' ')
if (problems.length > 0) {
  console.error('verify-arming: ' + problems.length + ' unarmed control(s):')
  for (const line of problems) console.error('  - ' + line)
  if (strict || true) process.exit(1)
}
console.log('verify-arming: OK — ' + summary + (notes.length > 0 ? '  (' + notes.join('; ') + ')' : ''))
console.log('  note: the “declared check must be run by CI or registered local-only” class is owned by verify-arch-guards doc-facts (not duplicated here)')
