#!/usr/bin/env node
/**
 * Generate packages/REQUIREMENTS.md and REQUIREMENTS-TRACEABILITY.md from the registry.
 *
 * The registry is the source; these documents are build products. --check makes a
 * hand edit a gate failure.
 *
 * Usage: node gen-requirements.mjs <evolution-root> [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { docsPaths, evaluateRequirements, loadBaseline, loadRequirements, renderRequirements, renderTraceability, summarize, validateRequirements, RequirementsLoadError } from './lib-requirements.mjs'

const argv = process.argv.slice(2)
const root = argv.find(arg => !arg.startsWith('--'))
const check = argv.includes('--check')
const unknown = argv.filter(arg => arg.startsWith('--') && arg !== '--check')
if (root === undefined || unknown.length > 0) {
  console.error('gen-requirements: usage: node gen-requirements.mjs <evolution-root> [--check]')
  process.exit(2)
}

let model
try {
  model = loadRequirements(root)
} catch (error) {
  console.error('gen-requirements: CANNOT DECIDE — ' + (error instanceof RequirementsLoadError ? error.message : String(error?.message ?? error)))
  process.exit(2)
}
if (model.items.length === 0) {
  console.error('gen-requirements: CANNOT DECIDE — empty registry')
  process.exit(2)
}
const schemaProblems = validateRequirements(model)
if (schemaProblems.length > 0) {
  for (const message of schemaProblems) console.error('gen-requirements: ' + message)
  process.exit(1)
}
const results = evaluateRequirements(model)
const baseline = loadBaseline(model)
const summary = summarize(results)
const paths = docsPaths(root)
const outputs = {
  [paths.requirements]: renderRequirements(model, results, baseline),
  [paths.traceability]: renderTraceability(model, results),
}
let stale = false
for (const [path, content] of Object.entries(outputs)) {
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (previous === content) continue
  if (check) {
    console.error('gen-requirements: STALE — ' + path + ' differs from the registry; rerun without --check')
    stale = true
  } else {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
    console.log('gen-requirements: wrote ' + path)
  }
}
if (stale) process.exit(1)
console.log('gen-requirements: up to date — total=' + summary.counts.total + ' satisfied=' + summary.counts.satisfied + ' partial=' + summary.counts.partial + ' gap=' + summary.counts.gap + ' unverified=' + summary.counts.unverified)
