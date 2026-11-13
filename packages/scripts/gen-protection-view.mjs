#!/usr/bin/env node
/**
 * gen-protection-view.mjs (G7-f): what does the gate table actually protect, after de-duplication?
 *
 * The audit counted 109 rows of which 46 give no independent protection. Both numbers needed a
 * view: a row is not a protection when it cannot execute (no argv), and two rows that run the same
 * script or the same CI step protect the same thing once. This script names the distinct
 * protections instead of asserting a target count, so deletions can be argued from data.
 *
 * Usage: node packages/scripts/gen-protection-view.mjs [--json] [--out <path>]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const json = process.argv.includes('--json')
const outFlag = process.argv.indexOf('--out')
const out = outFlag >= 0 && process.argv[outFlag + 1] !== undefined ? resolve(process.argv[outFlag + 1]) : join(HERE, 'reports', 'protection-view.json')

const manifest = JSON.parse(readFileSync(join(HERE, 'gate-manifest.json'), 'utf8'))
const rows = Array.isArray(manifest.gates) ? manifest.gates : []

/** The thing a row protects, independent of which layout or profile names it. */
function protectionKey(row) {
  if (!Array.isArray(row.argv) || row.argv.length === 0) return null
  const tokens = row.argv.filter((token) => token !== 'node')
  const script = tokens.find((token) => /\.(?:mjs|cjs|js|ts)$/.test(token))
  if (script !== undefined) return 'script:' + script.replace(/^packages\/evolution\//, 'packages/')
  const step = row.human ?? ''
  const nested = step.match(/shell: *([^\s|]+)/)
  return 'step:' + (nested === null ? String(row.id) : nested[1])
}

const groups = new Map()
const unexecutable = []
for (const row of rows) {
  // Step rows execute as action/lane command text and external rows document another owner's
  // command: neither is a spawn-run protection, so they are not counted as unexecutable (A1b).
  if (row.kind === 'step' || row.kind === 'external') continue
  const key = protectionKey(row)
  if (key === null) { unexecutable.push(row.id); continue }
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(row.id)
}

const duplicates = [...groups.entries()].filter(([, ids]) => ids.length > 1)
  .map(([key, ids]) => ({ key, ids }))
  .sort((a, b) => b.ids.length - a.ids.length)

const view = {
  schemaVersion: 1,
  generatedBy: 'packages/scripts/gen-protection-view.mjs',
  generatedAt: new Date().toISOString(),
  rows: rows.length,
  distinctProtections: groups.size,
  noIndependentProtection: unexecutable.length,
  duplicateGroups: duplicates.length,
  rowsInDuplicateGroups: duplicates.reduce((sum, group) => sum + group.ids.length, 0),
  unexecutable,
  duplicates,
}

const check = process.argv.includes('--check')
if (check) {
  const facts = JSON.parse(readFileSync(join(HERE, 'family-facts.json'), 'utf8'))
  const machine = (facts.facts ?? []).find((fact) => fact?.machine?.kind === 'checks')?.machine
  const registered = new Set(Object.keys(machine?.cannotDecideRegistered ?? {}))
  const unregistered = unexecutable.filter((id) => !registered.has(id))
  console.log('protection-view --check: rows=' + view.rows + ' distinct=' + view.distinctProtections + ' unexecutable=' + unexecutable.length + ' unregistered=' + unregistered.length)
  if (unregistered.length > 0) {
    console.error('protection-view: ' + unregistered.length + ' row(s) cannot execute and carry no registration: ' + unregistered.join(', '))
    process.exit(1)
  }
  process.exit(0)
}
if (json) console.log(JSON.stringify(view, null, 2))
else {
  console.log('protection-view: rows=' + view.rows + ' distinct=' + view.distinctProtections + ' no-protection=' + view.noIndependentProtection + ' duplicate-groups=' + view.duplicateGroups + ' (' + view.rowsInDuplicateGroups + ' rows)')
  for (const group of duplicates.slice(0, 12)) console.log('  ' + group.ids.length + 'x  ' + group.key + '  <- ' + group.ids.join(', '))
}
writeFileSync(out, JSON.stringify(view, null, 2) + '\n')
