#!/usr/bin/env node
/**
 * Gate the family's declared platform line against a target platform source tree.
 *
 * The platform's plugin compatibility preflight admits a plugin only when its
 * engines.dsh/peer ranges satisfy the running platform. This check reads the one
 * platform-line.json (through lib-platform-line) and the target tree's version
 * without network access.
 *
 * Usage: node verify-platform-line.mjs <platform-source-root> [--json]
 * Exit: 0 admitted, 1 not admitted, 2 unreadable/usage.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadSemver, readPlatformLine, resolvePlatformLineRoot } from './lib-platform-line.mjs'

const argv = process.argv.slice(2)
const targetArg = argv.find((arg) => !arg.startsWith('--'))
const json = argv.includes('--json')
if (targetArg === undefined) {
  console.error('verify-platform-line: usage: node verify-platform-line.mjs <platform-source-root> [--json]')
  process.exit(2)
}
const targetRoot = resolve(targetArg)
const targetManifest = join(targetRoot, 'package.json')
if (!existsSync(targetManifest)) {
  console.error('verify-platform-line: no package.json at ' + targetManifest + ' (cannot decide)')
  process.exit(2)
}
let target
try {
  target = JSON.parse(readFileSync(targetManifest, 'utf8'))
} catch (error) {
  console.error('verify-platform-line: unreadable target manifest: ' + (error instanceof Error ? error.message : String(error)))
  process.exit(2)
}
if (typeof target.name !== 'string' || !target.name.startsWith('@deepseek-ai/dsh')) {
  console.error('verify-platform-line: target manifest is not a DSH platform root (' + String(target.name) + ')')
  process.exit(2)
}
const familyRoot = resolvePlatformLineRoot(import.meta.url)
const line = readPlatformLine(familyRoot)
const { semver } = loadSemver(familyRoot)
if (typeof target.version !== 'string' || semver.valid(target.version) === null) {
  console.error('verify-platform-line: target version is not a valid semver: ' + String(target.version))
  process.exit(2)
}
const peers = semver.satisfies(target.version, line.peersRange)
const engines = semver.satisfies(target.version, line.enginesRange)
const admitted = peers && engines
const result = {
  familyRoot,
  familyLine: { version: line.version, floor: line.floor, peersRange: line.peersRange, enginesRange: line.enginesRange },
  target: { root: targetRoot, name: target.name, version: target.version },
  peers,
  engines,
  admitted,
}
if (json) {
  console.log(JSON.stringify(result, null, 1))
} else {
  console.log('platform line: family ' + line.version + ' (floor ' + line.floor + '), peers ' + line.peersRange + ', engines ' + line.enginesRange)
  console.log('target: ' + target.name + '@' + target.version + ' at ' + targetRoot)
  console.log('admission: peers=' + String(peers) + ' engines=' + String(engines) + ' => ' + (admitted ? 'ADMITTED' : 'NOT ADMITTED'))
  if (!admitted) console.log('action: migrate the platform adapters first, then update platform-line.json version/floor and regenerate the derived ranges; do not only widen the range.')
}
process.exit(admitted ? 0 : 1)
