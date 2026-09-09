#!/usr/bin/env node
/**
 * Idempotent publisher for scoped dsh-evolution tarballs.
 *
 * Reads dist/manifest.json and dist/publish-order.json produced by
 * prepare-release.mjs. Publishing is resumable: a version whose registry
 * integrity matches the local tarball is skipped, while a different integrity
 * fails the run. There is no rollback for npm publishes.
 *
 * Usage:
 *   node packages/scripts/publish-scoped.mjs --tag next
 *   node packages/scripts/publish-scoped.mjs --dry-run
 *   node packages/scripts/publish-scoped.mjs --no-provenance
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const evolutionRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const distRoot = join(evolutionRoot, 'dist')
const argv = process.argv.slice(2)

function hasFlag(name) { return argv.includes(name) }
// 0.3.20 (N-4): a version-driven tag selection replaces the hardcoded 'next'
// default (0.3.18 removed the 0.1.0 automatic choice — the direct cause of
// the next-tagged 0.3.18 incident). Per the manifest version: prerelease
// (contains '-') → next, stable → latest. An explicit --tag always overrides
// (manual repair scenarios only); release.yml runs bare so the choice is the
// script's.
const tagArg = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : undefined
if (argv.includes('--tag') && (tagArg === undefined || tagArg === '')) {
  throw new Error('--tag requires a value (e.g. --tag latest or --tag next); a bare --tag would silently fall back to the version-driven tag')
}
let tag = 'next'
const dryRun = hasFlag('--dry-run')
const provenance = !hasFlag('--no-provenance')
const interactive = hasFlag('--interactive')
const groupIndex = argv.indexOf('--groups')
const groupRaw = groupIndex >= 0 ? argv[groupIndex + 1] : undefined
// D-11 (v18): a bare `--groups` used to fall through to "no limit" and
// publish EVERY group; require a value like --tag/--only do.
if (groupIndex >= 0 && (groupRaw === undefined || groupRaw === '' || groupRaw.startsWith('--'))) {
  throw new Error('--groups requires a positive integer (a bare flag would publish every group)')
}
const groupLimit = groupRaw === undefined ? undefined : Number(groupRaw)
if (groupLimit !== undefined && (!Number.isInteger(groupLimit) || groupLimit <= 0)) {
  throw new Error(`--groups requires a positive integer, got ${groupRaw} — a non-positive value slices the publish order to nothing (0) or drops trailing groups (negative) yet still reports complete`)
}
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined
if (argv.includes('--only') && (onlyArg === undefined || onlyArg === '')) {
  throw new Error('--only requires a comma-separated package list')
}
const onlyNames = onlyArg ? onlyArg.split(',').map(name => name.trim()).filter(Boolean) : []
const otp = argv.includes('--otp') ? argv[argv.indexOf('--otp') + 1] : ''

/** V7-01 (0.3.41): `npm.cmd` with shell:false is EINVAL on Windows (Node
 * ≥18.20/20.12/22 CVE-2024-27980 hardening — install-layered.mjs already knew:
 * "spawn of npm.cmd is blocked on Windows (EINVAL)"). Resolve the npm CLI
 * entry and run it with NODE directly: execFileSync stays shell-free, so a
 * tarball path containing SPACES is never re-split (the V6-48 reason for
 * dropping `cmd.exe /c` in the first place) and no .cmd/bat is spawned.
 * Candidates: standalone npm (APPDATA shim layout) and node-bundled npm
 * (node_modules/npm next to node.exe / Program Files). */
function npmCliJs() {
  // V8-17 (0.3.48): skip the env-dependent candidates when the variable is
  // unset (the install-layered V6-51 precedent) — `join('', 'npm', …)`
  // probes a CWD-RELATIVE phantom path that may accidentally exist.
  const candidates = [
    ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js')] : []),
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ...(process.env.ProgramFiles ? [join(process.env.ProgramFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js')] : []),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('cannot locate npm-cli.js (checked APPDATA/npm, node.exe dir, Program Files/nodejs) — install npm and retry')
}

const npmExecutable = process.platform === 'win32' ? process.execPath : 'npm'

function npmArgs(args) {
  if (process.platform === 'win32') return [npmCliJs(), ...args]
  return args
}

function npm(args, options = {}) {
  return execFileSync(npmExecutable, npmArgs(args), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

function integrityOf(tarball) {
  const digest = createHash('sha512').update(readFileSync(tarball)).digest('base64')
  return `sha512-${digest}`
}

function viewIntegrity(name, version) {
  try {
    return JSON.parse(npm(['view', `${name}@${version}`, 'dist.integrity', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch {
    return undefined
  }
}

function publish(tarball) {
  const args = ['publish', tarball, '--access', 'public', '--tag', tag]
  if (otp) args.push('--otp', otp)
  if (provenance) args.push('--provenance')
  if (interactive) {
    execFileSync(npmExecutable, npmArgs(args), { stdio: 'inherit' })
    return
  }
  const output = npm(args)
  console.log(output.trim())
}

// R-09: a publish retry must re-run within seconds, so block the event loop
// with Atomics.wait instead of the previous 2-second busy-wait spin (which
// burned a full core and starved any concurrent handle on the same loop).
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const manifest = JSON.parse(readFileSync(join(distRoot, 'manifest.json'), 'utf8'))
const order = JSON.parse(readFileSync(join(distRoot, 'publish-order.json'), 'utf8'))

const expected = Object.keys(manifest).sort()
const listed = order.flat().sort()
// V8-18 (0.3.48): the F-103 vacuum-guard discipline — an empty manifest or an
// empty publish order would compare equal and the run would print "publish
// run complete" without publishing anything.
if (expected.length === 0) {
  throw new Error('manifest.json declares ZERO packages — refusing to publish (a vacuum run would falsely report complete)')
}
if (listed.length === 0) {
  throw new Error('publish-order.json declares ZERO packages — refusing to publish (a vacuum run would falsely report complete)')
}
if (JSON.stringify(expected) !== JSON.stringify(listed)) {
  throw new Error('manifest and publish-order disagree on the package set')
}

// --only must name a real package: an unknown name would match nothing and the
// run would silently "complete" without publishing anything.
for (const name of onlyNames) {
  if (!expected.includes(name)) {
    throw new Error(`--only unknown package: ${name} (not in the staged manifest)`)
  }
}

const publishOrder = groupLimit === undefined ? order : order.slice(0, groupLimit)
// V8-19 (0.3.48): --only × --groups — a named package beyond the sliced
// publishOrder was silently skipped while the run still reported complete
// (the operator believed it was published). Fail loud instead.
if (onlyNames.length > 0) {
  const slicedNames = new Set(publishOrder.flat())
  for (const name of onlyNames) {
    if (!slicedNames.has(name)) {
      throw new Error(`--only package ${name} is outside the --groups slice (${groupLimit} group(s)) — it would be silently skipped; raise the limit or drop --groups`)
    }
  }
}
for (const group of publishOrder) {
  for (const name of group) {
    if (onlyNames.length > 0 && !onlyNames.includes(name)) continue
    const file = manifest[name]
    if (!file) throw new Error(`missing tarball for ${name}`)
    const tarball = join(distRoot, file)
    if (!existsSync(tarball)) throw new Error(`missing tarball file ${file}`)
    const match = file.match(/-(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)\.tgz$/)
    const releaseVersion = match?.[1] ?? ''
    if (!releaseVersion) throw new Error(`cannot parse a semver from ${file}; non-tag builds must pack with a semver-safe version (e.g. 0.0.0-main)`)
    // N-4: the tag follows the release version; one version per run so the
    // assignment is idempotent across the package loop.
    tag = tagArg ?? (releaseVersion.includes('-') ? 'next' : 'latest')

    const local = integrityOf(tarball)
    const remote = viewIntegrity(name, releaseVersion)
    if (remote !== undefined) {
      if (remote === local) {
        console.log(`skip   ${name}@${releaseVersion} (integrity match)`)
        continue
      }
      throw new Error(`${name}@${releaseVersion} exists with different integrity; refusing to overwrite`)
    }

    console.log(`publish ${name}@${releaseVersion}${dryRun ? ' (dry-run)' : ''}`)
    if (dryRun) continue
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        publish(tarball)
        break
      } catch (error) {
        const text = `${error?.stderr ?? ''}${error?.message ?? ''}`
        // R-09: E409 (version already exists with different content) is NOT a
        // transient error — retrying deterministically fails 3 more times. The
        // pre-publish viewIntegrity check above normally catches this; an E409
        // here means the version appeared between the check and the publish
        // (or the registry view failed). Fail immediately and point at the
        // integrity comparison instead of retrying.
        if (/E409/i.test(text)) {
          throw new Error(
            `${name}@${releaseVersion}: npm rejected the publish with E409 — the version already exists with different content. `
            + `Compare the published tarball's dist.integrity against the local ${file} instead of retrying.`,
          )
        }
        if (/E429|EAI_AGAIN|ECONNRESET|HTTP 5|503|502|500/i.test(text) && attempt < 3) {
          console.warn(`publish retry ${attempt}/3: ${name}`)
          sleep(2000)
          continue
        }
        throw error
      }
    }
  }
}
console.log('publish run complete')
