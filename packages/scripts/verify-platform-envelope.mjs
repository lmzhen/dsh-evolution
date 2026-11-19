#!/usr/bin/env node
/**
 * Envelope guard: every published manifest must declare exactly the cohort's
 * peer/engine union, with no workspace literal left behind.
 *
 * This is the pre-publish companion to verify-platform-ranges: it reads the
 * same ONE platform-line.json and judges the manifests that will be uploaded.
 * Exit: 0 pass, 1 violation, 2 cannot decide (no manifests / no line).
 *
 * Usage:
 *   node packages/scripts/verify-platform-envelope.mjs --manifest-dir packages/evolution/.release-staging
 *     [--line <platform-line.json>] [--our-scope @lmzhen]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPlatformLine, resolvePlatformLineRoot } from './lib-platform-line.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const valueOf = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const manifestDirArg = valueOf('--manifest-dir')
if (manifestDirArg === undefined) {
  console.error('verify-platform-envelope: --manifest-dir is required')
  process.exit(2)
}
const manifestDir = resolve(manifestDirArg)
if (!existsSync(manifestDir)) {
  console.error('verify-platform-envelope: no manifest directory at ' + manifestDir + ' (cannot decide)')
  process.exit(2)
}
const linePath = valueOf('--line')
const line = linePath === undefined
  ? readPlatformLine(resolvePlatformLineRoot(import.meta.url))
  : JSON.parse(readFileSync(resolve(linePath), 'utf8'))
const scope = valueOf('--our-scope') ?? '@lmzhen'
const platformPrefix = '@deepseek-ai/dsh-'

const manifests = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (entry.name === 'package.json') manifests.push(file)
  }
}
walk(manifestDir)
if (manifests.length === 0) {
  console.error('verify-platform-envelope: no package.json under ' + manifestDir + ' (cannot decide)')
  process.exit(2)
}

const problems = []
let ranges = 0
for (const file of manifests) {
  let pkg
  try { pkg = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
    problems.push(file + ': unreadable manifest (' + (error instanceof Error ? error.message : String(error)) + ')')
    continue
  }
  if (typeof pkg.name !== 'string' || !pkg.name.startsWith(scope + '/')) continue
  if (pkg.engines?.dsh !== line.enginesRange) problems.push(pkg.name + ': engines.dsh ' + String(pkg.engines?.dsh) + ' != ' + line.enginesRange)
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (name.startsWith(platformPrefix)) {
        ranges += 1
        if (range !== line.peersRange) problems.push(pkg.name + ': ' + section + '.' + name + ' ' + String(range) + ' != ' + line.peersRange)
      }
      if (typeof range === 'string' && range.includes('workspace:')) problems.push(pkg.name + ': ' + section + '.' + name + ' still carries workspace:')
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('  - ' + problem)
  console.error('verify-platform-envelope: ' + problems.length + ' violation(s)')
  process.exit(1)
}
console.log('verify-platform-envelope: OK — ' + manifests.length + ' manifest(s), ' + ranges + ' platform range(s) == cohort union ' + line.peersRange)
