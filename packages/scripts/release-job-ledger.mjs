#!/usr/bin/env node
/**
 * release-job-ledger — write the publish job's `ci-gates.json` from the real job results.
 *
 * W10 M4c: this was an inline heredoc inside release.yml. The ledger says "this run's required jobs
 * succeeded" and nothing more; keeping the row set and the reading string here means the workflow
 * only supplies the results and the evidence assembler consumes one shape.
 *
 * Usage: node release-job-ledger.mjs --output ci-gates.json
 * Env:   PLATFORM_LINE_RESULT, COMPAT_CHECK_RESULT, COMPAT_CHECK_NODE22_RESULT, DESKTOP_INSTALL_RESULT
 * Exit:  0 wrote the ledger; 1 a required result is missing (a fabricated false is not a reading);
 *        2 usage error.
 */
import { writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (name) => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index + 1] }
const output = flag('--output') ?? 'ci-gates.json'
if (output.startsWith('--')) { console.error('release-job-ledger: --output needs a path'); process.exit(2) }

const JOBS = [
  ['platform-line', 'PLATFORM_LINE_RESULT'],
  ['compat-check', 'COMPAT_CHECK_RESULT'],
  ['compat-check-node22', 'COMPAT_CHECK_NODE22_RESULT'],
  ['desktop-install', 'DESKTOP_INSTALL_RESULT'],
]
const rows = []
const missing = []
for (const [id, env] of JOBS) {
  const result = process.env[env]
  if (result === undefined || result === '') { missing.push(env); continue }
  rows.push({ id, ok: result === 'success', reading: 'GitHub Actions job ' + id + ' result=' + result, criterionEvaluated: true })
}
if (missing.length > 0) {
  console.error('release-job-ledger: missing job result(s): ' + missing.join(', ') + ' — a result nobody supplied is not a reading')
  process.exit(1)
}
writeFileSync(output, JSON.stringify({ gates: rows }, null, 2) + '\n')
console.log('release-job-ledger: wrote ' + output + ' (' + rows.map((row) => row.id + '=' + (row.ok ? 'ok' : 'not-ok')).join(', ') + ')')
