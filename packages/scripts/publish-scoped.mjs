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
 *   node packages/evolution/scripts/publish-scoped.mjs --tag next
 *   node packages/evolution/scripts/publish-scoped.mjs --dry-run
 *   node packages/evolution/scripts/publish-scoped.mjs --no-provenance
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
let tag = 'next'
const dryRun = hasFlag('--dry-run')
const provenance = !hasFlag('--no-provenance')
const interactive = hasFlag('--interactive')
const groupLimit = argv.includes('--groups') ? Number(argv[argv.indexOf('--groups') + 1]) : undefined
const onlyNames = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',').map(name => name.trim()).filter(Boolean) : []
const otp = argv.includes('--otp') ? argv[argv.indexOf('--otp') + 1] : ''

function npm(args, options = {}) {
  if (process.platform === 'win32') {
    return execFileSync('cmd.exe', ['/c', 'npm', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
  }
  return execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
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
    execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/c', 'npm', ...args] : args, { stdio: 'inherit' })
    return
  }
  const output = npm(args)
  console.log(output.trim())
}

function sleep(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    // busy-wait is fine for a publish control loop
  }
}

const manifest = JSON.parse(readFileSync(join(distRoot, 'manifest.json'), 'utf8'))
const order = JSON.parse(readFileSync(join(distRoot, 'publish-order.json'), 'utf8'))

const expected = Object.keys(manifest).sort()
const listed = order.flat().sort()
if (JSON.stringify(expected) !== JSON.stringify(listed)) {
  throw new Error('manifest and publish-order disagree on the package set')
}

const publishOrder = groupLimit === undefined ? order : order.slice(0, groupLimit)
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
        if (/E409|E429|EAI_AGAIN|ECONNRESET|HTTP 5|503|502|500/i.test(text) && attempt < 3) {
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
