#!/usr/bin/env node
/**
 * G4.1 (C5): the install counts in README are DERIVED, not typed.
 *
 * "You should see N packages installed (the published list is M)" was a hand-written pair and it had
 * already drifted (it said 30 while the tree publishes more). Both numbers now come from the family's
 * ONE discovery library, so the prose can only ever restate what the tree says:
 *   published = publishableDirs(root).length
 *   installed = published minus the install-target bundle that ships as an agent preset rather than a
 *               node_modules plugin (the preset tail, per EVOLUTION_BUNDLE_TAILS) — the same rule the
 *               installer applies via installerAccepts().
 *
 * Usage: node packages/scripts/gen-install-counts.mjs <repo-root> [--check]
 *   --check  fail when README differs from what the tree implies (the CI form)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EVOLUTION_BUNDLE_TAILS, installerAccepts, manifestName, publishableDirs } from './lib-family-packages.mjs'

const argv = process.argv.slice(2)
const check = argv.includes('--check')
const repoRoot = argv.find((arg) => !arg.startsWith('--')) ?? '.'
const packagesRoot = join(repoRoot, 'packages')
const readmePath = join(repoRoot, 'README.md')

const START = '<!-- gen:install-counts -->'
const END = '<!-- /gen:install-counts -->'

const dirs = publishableDirs(packagesRoot)
const published = dirs.length
/** A bundle tail ships as a preset (an agent preset), not as a node_modules plugin. */
const presetTails = EVOLUTION_BUNDLE_TAILS.filter((tail) => tail.endsWith('-preset'))
const installed = dirs
  .map((dir) => manifestName(packagesRoot, dir))
  .filter((name) => {
    if (name === null) return false
    // The installer's rule reads the UNSCOPED name (installerAccepts' own docblock).
    const unscoped = name.replace(/^@[^/]+\//, '')
    return installerAccepts(unscoped) && !presetTails.some((tail) => unscoped === tail)
  })
  .length

const readme = readFileSync(readmePath, 'utf8')
const start = readme.indexOf(START)
const end = readme.indexOf(END)
if (start < 0 || end < 0 || end < start) {
  console.error('gen-install-counts: README carries no ' + START + ' … ' + END + ' region')
  process.exit(1)
}
const region = readme.slice(start + START.length, end)
const expected = ' ' + installed + ' packages installed (the published list is ' + published + '; the agent preset is separate)'

if (check) {
  if (region !== expected) {
    console.error('gen-install-counts: README is stale')
    console.error('  in README: ' + JSON.stringify(region))
    console.error('  from tree: ' + JSON.stringify(expected))
    process.exit(1)
  }
  console.log('gen-install-counts: OK — ' + installed + ' installed / ' + published + ' published')
  process.exit(0)
}

writeFileSync(readmePath, readme.slice(0, start + START.length) + expected + readme.slice(end))
console.log('gen-install-counts: wrote ' + installed + ' installed / ' + published + ' published')
