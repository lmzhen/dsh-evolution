#!/usr/bin/env node
/**
 * Verify the requirements registry.
 *
 * Default: schema/alias/evidence validation + report (exit 0 when valid, 1 when invalid).
 * --strict: release gate; any in-scope partial/gap/unverified/docDrift fails (exit 1).
 * --json: machine envelope for CI.
 *
 * Usage: node verify-requirements.mjs <evolution-root> [--strict] [--json]
 */
import { RequirementsLoadError, docsCurrent, evaluateRequirements, loadBaseline, loadRequirements, strictProblems, summarize, validateRequirements } from './lib-requirements.mjs'

const argv = process.argv.slice(2)
const root = argv.find(arg => !arg.startsWith('--'))
if (root === undefined) {
  console.error('verify-requirements: usage: node verify-requirements.mjs <evolution-root> [--strict] [--json]')
  process.exit(2)
}
const unknown = argv.filter(arg => arg.startsWith('--') && !['--strict', '--json', '--report'].includes(arg))
if (unknown.length > 0) {
  console.error('verify-requirements: unknown flag(s): ' + unknown.join(', '))
  process.exit(2)
}
const strict = argv.includes('--strict')
const jsonOut = argv.includes('--json')

let model
try {
  model = loadRequirements(root)
} catch (error) {
  const message = error instanceof RequirementsLoadError ? error.message : String(error?.message ?? error)
  if (jsonOut) console.log(JSON.stringify({ schema: 1, status: 'cannot-decide', problems: [message], counts: null }, null, 2))
  else console.error('verify-requirements: CANNOT DECIDE — ' + message)
  process.exit(2)
}
if (model.items.length === 0) {
  const message = 'requirements registry carries zero items; an empty universe is not a pass'
  if (jsonOut) console.log(JSON.stringify({ schema: 1, status: 'cannot-decide', problems: [message], counts: null }, null, 2))
  else console.error('verify-requirements: CANNOT DECIDE — ' + message)
  process.exit(2)
}
const results = evaluateRequirements(model)
const baseline = loadBaseline(model)
const summary = summarize(results)
const problems = validateRequirements(model)
const docProblems = docsCurrent(model, results, baseline)
problems.push(...docProblems)
const closure = strict ? strictProblems(model, results) : []
for (const message of closure) if (!problems.includes(message)) problems.push(message)
const status = problems.length === 0 ? 'pass' : 'fail'
const envelope = {
  schema: 1,
  status,
  strict,
  counts: summary.counts,
  audit: summary.audit,
  problems,
  items: results.map(row => ({ id: row.item.id, status: row.status, docDrift: row.docDrift, scoring: row.item.scoring !== false })).sort((left, right) => left.id.localeCompare(right.id)),
}
if (jsonOut) console.log(JSON.stringify(envelope, null, 2))
else {
  console.log('verify-requirements: ' + status.toUpperCase() + ' — total=' + summary.counts.total + ' satisfied=' + summary.counts.satisfied + ' partial=' + summary.counts.partial + ' gap=' + summary.counts.gap + ' n/a=' + summary.counts['n/a'] + ' unverified=' + summary.counts.unverified + ' docDrift=' + summary.counts.docDrift + ' scored=' + summary.counts.scored)
  if (problems.length > 0) {
    for (const message of problems) console.error('  - ' + message)
  }
}
process.exit(problems.length === 0 ? 0 : 1)
