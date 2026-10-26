#!/usr/bin/env node
/**
 * The ONE reader of platform-line.json (G1-S2). Everything else (print, generator, prepare-release,
 * gates, docs facts) derives from this module — no second version literal, no hand-written semver model.
 *
 * Usage: import { readPlatformLine, windowRows, OUTPUT_KEYS } from './lib-platform-line.mjs'
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLATFORM_LINE_FILE = 'platform-line.json'
export const OUTPUT_KEYS = Object.freeze({
  version: 'version',
  floor: 'floor',
  upstreamRef: 'upstream_ref',
  peersRange: 'peers_range',
  enginesRange: 'engines_range',
})

const PLATFORM_FIELDS = new Set(['$comment', 'version', 'floor'])

function die(message) { throw new Error('platform-line: ' + message) }

function semverFrom(rootDir) {
  const candidates = [join(rootDir, 'package.json')]
  if (typeof process.env.PLATFORM_LINE_SEMVER_ROOT === 'string' && process.env.PLATFORM_LINE_SEMVER_ROOT !== '') candidates.push(join(process.env.PLATFORM_LINE_SEMVER_ROOT, 'package.json'))
  candidates.push(join(process.cwd(), 'package.json'), import.meta.url)
  for (const candidate of candidates) {
    const require = createRequire(candidate)
    try {
      const semver = require('semver')
      // SEMVER_SPEC_VERSION is the RANGE SPEC version (2.0.0), not the package version the
      // evidence must record; read the installed manifest instead.
      const version = JSON.parse(readFileSync(require.resolve('semver/package.json'), 'utf8')).version
      return { semver, version }
    } catch { /* try next */ }
  }
  die('cannot resolve the semver package from ' + rootDir + ' (run `pnpm install` in the repository root; no hand-written fallback)')
}

export function loadSemver(rootDir) {
  const { semver, version } = semverFrom(rootDir)
  if (typeof semver.valid !== 'function' || typeof semver.satisfies !== 'function') die('the resolved semver package lacks valid()/satisfies()')
  return { semver, version }
}

function sameTuple(semver, a, b) {
  const pa = semver.parse(a)
  const pb = semver.parse(b)
  return pa.major === pb.major && pa.minor === pb.minor && pa.patch === pb.patch
}

function previousAnchorOf(semver, version, floor) {
  const parsed = semver.parse(version)
  if (parsed.patch === 0) die('previousAnchor cannot be derived from ' + version + ' (patch 0 has no same-tuple patch-1 line)')
  const candidate = parsed.major + '.' + parsed.minor + '.' + (parsed.patch - 1) + '-rc.2'
  if (!semver.valid(candidate)) die('derived previousAnchor is not a valid semver: ' + candidate)
  return candidate
}

export function parsePlatformLine(raw, sourcePath = '<inline>') {
  let parsed
  try { parsed = JSON.parse(raw) } catch (error) { die(sourcePath + ' is not JSON: ' + error.message) }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) die(sourcePath + ' must be a JSON object')
  for (const key of Object.keys(parsed)) {
    if (!PLATFORM_FIELDS.has(key)) die(sourcePath + ' carries unknown field ' + JSON.stringify(key) + ' (one home only: version/floor)')
  }
  for (const field of ['version', 'floor']) {
    if (typeof parsed[field] !== 'string' || parsed[field].trim() === '') die(sourcePath + ' is missing the ' + field + ' string')
  }
  const { semver } = semverFrom(dirname(sourcePath === '<inline>' ? process.cwd() + '/package.json' : resolve(sourcePath)))
  if (semver.valid(parsed.version) === null) die('version is not a valid semver: ' + parsed.version)
  if (semver.valid(parsed.floor) === null) die('floor is not a valid semver: ' + parsed.floor)
  if (!sameTuple(semver, parsed.version, parsed.floor)) die('version and floor must share one major.minor.patch tuple (single-line anchor); got ' + parsed.version + ' / ' + parsed.floor)
  if (!(semver.compare(parsed.floor, parsed.version) < 0)) die('floor must sort below version; got floor=' + parsed.floor + ' version=' + parsed.version)
  const nextPatch = parsed.version.replace(/-.*$/, '').replace(/^(\d+)\.(\d+)\.(\d+)$/, (m, a, b, c) => a + '.' + b + '.' + (Number(c) + 1)) + '-0'
  return Object.freeze({
    version: parsed.version,
    floor: parsed.floor,
    previousAnchor: previousAnchorOf(semver, parsed.version, parsed.floor),
    peersRange: '^' + parsed.floor,
    enginesRange: '>=' + parsed.floor + ' <' + nextPatch,
    upstreamRef: 'dsh-v' + parsed.version,
  })
}

export function resolvePlatformLineRoot(fromFileUrl) {
  const start = dirname(fromFileUrl.startsWith('file:') ? fileURLToPath(fromFileUrl) : resolve(fromFileUrl))
  let dir = start
  for (let hops = 0; hops < 12; hops += 1) {
    const candidate = join(dir, PLATFORM_LINE_FILE)
    if (existsSync(candidate)) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  die('no ' + PLATFORM_LINE_FILE + ' found above ' + start)
}

export function readPlatformLine(rootDir = process.cwd()) {
  const file = join(rootDir, PLATFORM_LINE_FILE)
  if (!existsSync(file)) die('missing ' + file)
  return parsePlatformLine(readFileSync(file, 'utf8'), file)
}

/** The admission grid: every version the release line must be judged against (peers vs engines). */
export function windowRows(platformLine) {
  const { semver } = loadSemver(process.cwd())
  const versions = [
    '0.2.0-rc.2',
    '0.2.1-rc.0',
    '0.2.1-rc.1',
    '0.2.1-rc.2',
    '0.2.1-rc.3',
    '0.2.1',
    '0.2.2-0',
    '0.2.2-rc.1',
    '0.2.2',
    '0.3.0-rc.1',
  ]
  return versions.map((version) => {
    const peersAdmits = semver.satisfies(version, platformLine.peersRange)
    const enginesAdmits = semver.satisfies(version, platformLine.enginesRange, { includePrerelease: true })
    const expected = peersAdmits && enginesAdmits
    return { version, peersAdmits, enginesAdmits, expected, note: expected ? 'admit' : (peersAdmits !== enginesAdmits ? 'predicate-split: policy denies' : 'deny') }
  })
}
