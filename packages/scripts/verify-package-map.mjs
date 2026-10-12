#!/usr/bin/env node
/**
 * G4.1/G4.3: the package map must name exactly the packages the tree publishes.
 *
 * The map in packages/README.md is prose (one line per area), so it cannot be generated — but its SET
 * membership can be checked, and that is what drifts: a new package lands and nobody adds a row, or a
 * row outlives the package it names. Both directions fail here.
 *
 * Usage: node packages/scripts/verify-package-map.mjs [packages-root]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { publishableDirs } from './lib-family-packages.mjs'

const root = process.argv[2] ?? 'packages'
const readmePath = join(root, 'README.md')
const lines = readFileSync(readmePath, 'utf8').split(String.fromCharCode(10))
const start = lines.findIndex((line) => line.trim() === '## Package map')
if (start < 0) {
  console.error('verify-package-map: ' + readmePath + ' carries no "## Package map" section')
  process.exit(1)
}
const mentioned = new Set()
for (let i = start + 1; i < lines.length; i += 1) {
  const line = lines[i]
  if (line.startsWith('## ')) break
  if (!line.startsWith('|')) continue
  const first = line.split('|')[1] ?? ''
  for (const match of first.matchAll(/`([a-z][a-z0-9-]*)`/g)) mentioned.add(match[1])
}

const dirs = publishableDirs(root)
const missing = dirs.filter((dir) => !mentioned.has(dir))
const extra = [...mentioned].filter((name) => !dirs.includes(name))
const problems = []
for (const name of missing) problems.push(readmePath + ' has no row for the published package ' + name)
for (const name of extra) problems.push(readmePath + ' names ' + name + ', which is not a published package')

if (problems.length > 0) {
  console.error('verify-package-map: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-package-map: OK — ' + dirs.length + ' published package(s), all named in the map')
