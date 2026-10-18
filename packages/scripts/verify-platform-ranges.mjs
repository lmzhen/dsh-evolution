#!/usr/bin/env node
/**
 * G1-S6 platform-range guard: the release metadata must agree with the ONE platform line.
 *
 * The platform line (version/floor/peers/engines/window) comes from platform-line.json through
 * lib-platform-line.mjs — this guard owns NO version literal and NO hand-written semver model.
 * Three assertion classes:
 *   (a) every staged manifest's @deepseek-ai/dsh-* range == platformLine.peersRange;
 *   (b) every staged manifest carries engines.dsh == platformLine.enginesRange (and no workspace:
 *       literal survives);
 *   (c) the admission grid (peers predicate vs engines predicate, 9 versions) is printed with the
 *       policy expected column, so a range change that reshapes the window is visible in the log.
 * Vendored @deepseek-ai/* non-dsh ranges are pinned by lib-vendored-ranges.mjs (unknown ones fail).
 *
 * Usage:
 *   node packages/scripts/verify-platform-ranges.mjs --manifest-dir packages/evolution/.release-staging
 *     [--platform-line-root <repo root>] [--our-scope @lmzhen] [--upstream <checkout root>]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadSemver, readPlatformLine, resolvePlatformLineRoot, windowRows } from './lib-platform-line.mjs'
import { VENDORED_DIRS, vendoredRangeFor } from './lib-vendored-ranges.mjs'

const argv = process.argv.slice(2)
function arg(name, fallback = '') {
  const index = argv.indexOf(name)
  const value = index >= 0 ? argv[index + 1] : undefined
  if (value === undefined || value.startsWith('--')) return fallback
  return value
}
function requireArg(name) {
  const value = arg(name)
  if (!value) { console.error('verify-platform-ranges: missing required ' + name); process.exit(2) }
  return value
}

const manifestDir = resolve(requireArg('--manifest-dir'))
const ourScope = arg('--our-scope', '@lmzhen')
const familyPrefixes = arg('--family-prefixes', ourScope + '/dsh-')
const upstream = arg('--upstream', '')
const lineRoot = arg('--platform-line-root', '')
if (ourScope === '@deepseek-ai' && familyPrefixes === '@deepseek-ai/dsh-') {
  console.error('verify-platform-ranges: --our-scope @deepseek-ai cannot distinguish family from platform deps; pass --family-prefixes (e.g. @lmzhen/dsh-)')
  process.exit(1)
}

const platformLine = readPlatformLine(lineRoot === '' ? resolvePlatformLineRoot(import.meta.url) : resolve(lineRoot))
const { semver, version: semverVersion } = loadSemver(lineRoot === '' ? resolvePlatformLineRoot(import.meta.url) : resolve(lineRoot))
const peersRange = platformLine.peersRange
const enginesRange = platformLine.enginesRange

const problems = []
let scanned = 0
let platformRanges = 0

function isFamilyDep(name) {
  return name.startsWith(familyPrefixes) || (name.startsWith(ourScope + '/') && !name.startsWith('@deepseek-ai/'))
}
function field(section, name) { return section + '.' + name }

let entries = []
try { entries = readdirSync(manifestDir, { withFileTypes: true }) } catch {
  console.error('verify-platform-ranges: cannot read manifest dir ' + manifestDir)
  process.exit(1)
}
for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const manifestPath = join(manifestDir, entry.name, 'package.json')
  if (!existsSync(manifestPath)) continue
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch {
    problems.push(manifestPath + ': not valid JSON')
    continue
  }
  scanned += 1
  const pkgName = typeof manifest.name === 'string' ? manifest.name : entry.name
  for (const sectionName of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    const section = manifest[sectionName] ?? {}
    for (const [name, spec] of Object.entries(section)) {
      if (typeof spec !== 'string') continue
      if (spec.includes('workspace:')) problems.push(pkgName + ' ' + field(sectionName, name) + ': workspace literal survived into the staged manifest (' + spec + ')')
      if (name.startsWith('@deepseek-ai/dsh-')) {
        if (isFamilyDep(name)) continue
        platformRanges += 1
        if (spec !== peersRange) problems.push(pkgName + ' ' + field(sectionName, name) + ': ' + spec + ' != ' + peersRange + ' (platform peers range)')
        continue
      }
      if (!name.startsWith('@deepseek-ai/')) continue
      const vendored = vendoredRangeFor(name)
      if (vendored === undefined) {
        problems.push(pkgName + ' ' + field(sectionName, name) + ': no vendored range rule — add it to packages/scripts/lib-vendored-ranges.mjs')
        continue
      }
      if (spec !== vendored) problems.push(pkgName + ' ' + field(sectionName, name) + ': ' + spec + ' != ' + vendored + ' (vendored range)')
    }
  }
  const enginesDsh = manifest.engines && typeof manifest.engines === 'object' ? manifest.engines.dsh : undefined
  if (enginesDsh === undefined) problems.push(pkgName + ' engines.dsh: missing (every staged manifest declares the platform window)')
  else if (enginesDsh !== enginesRange) problems.push(pkgName + ' engines.dsh: ' + String(enginesDsh) + ' != ' + enginesRange)
}

if (scanned === 0) {
  console.error('verify-platform-ranges: no package manifest found under ' + manifestDir + ' (0 directories with a readable package.json) — checked 0 packages, the guard would be silent')
  process.exit(1)
}
if (platformRanges === 0) {
  console.error('verify-platform-ranges: ' + scanned + ' manifest(s) scanned under ' + manifestDir + ' but 0 @deepseek-ai/dsh-* platform dependency ranges found — nothing to verify')
  process.exit(1)
}

// (c) the admission grid, two predicates: peers (npm default) vs engines (includePrerelease).
const rows = windowRows(platformLine)
const peerAdmits = rows.filter((row) => row.peersAdmits)
const engineAdmits = rows.filter((row) => row.enginesAdmits)
console.log('platform peers   (' + peersRange + '): ' + rows.filter((row) => row.peersAdmits).map((row) => row.version).join(', '))
console.log('platform engines (' + enginesRange + '): ' + engineAdmits.map((row) => row.version).join(', '))
console.log('window grid (' + semverVersion + '): ' + rows.map((row) => row.version + '=' + (row.expected ? 'admit' : 'deny')).join(' '))
void semver
void peerAdmits

if (upstream !== '') {
  for (const [name, dir] of Object.entries(VENDORED_DIRS)) {
    const manifestPath = join(upstream, 'vendor', dir, 'package.json')
    if (!existsSync(manifestPath)) { problems.push('upstream vendor manifest missing: ' + manifestPath); continue }
    const upstreamVersion = JSON.parse(readFileSync(manifestPath, 'utf8')).version
    const expected = '^' + upstreamVersion
    if (vendoredRangeFor(name) !== expected) problems.push(name + ': pinned ' + vendoredRangeFor(name) + ' != validated upstream ' + expected + ' (update lib-vendored-ranges.mjs)')
  }
}

if (problems.length > 0) {
  console.error('verify-platform-ranges: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('verify-platform-ranges: OK — ' + scanned + ' manifest(s), ' + platformRanges + ' platform range(s) == ' + peersRange + ', engines.dsh == ' + enginesRange + ', grid ' + rows.length + ' rows (semver ' + semverVersion + ')')
