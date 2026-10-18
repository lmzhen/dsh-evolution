#!/usr/bin/env node
/**
 * POST-PUBLISH check: the bytes on the registry must be the bytes we packed.
 *
 * Why this exists: the pre-tag gate compares the packed tarball against what a profile has
 * installed, and it CANNOT compare against the registry (the version is not published yet), so it
 * records cannot-decide and names this check as the owner of that criterion. Until now nothing
 * owned it. Pre-publish audits (audit-release-tarballs) look at the local dist dir only.
 *
 * A fresh publish is not instantly readable from every edge: v0.26.26 and v0.27.0 both published all
 * packages and then saw fetches fail while the registry propagated / rate-limited. Two passes with
 * bounded exponential backoff keep the check honest (cannot-decide never counts as pass) without
 * turning a propagation window into a red release.
 *
 * Usage: node verify-published-bytes.mjs <dist-dir> --version <x.y.z>
 *
 * Exit: 0 all compared bytes match; 1 a byte mismatch (named); 2 cannot decide (a package could not
 * be fetched after both passes - offline, empty cache, or not on the registry yet).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const distDir = argv.find((entry) => !entry.startsWith('--'))
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1] }
const version = flag('--version')
if (distDir === undefined || version === undefined) { console.error('usage: verify-published-bytes.mjs <dist-dir> --version <x.y.z>'); process.exit(2) }
if (!existsSync(distDir)) { console.error('verify-published-bytes: no such dist dir ' + distDir + ' - pass the directory the release packed into'); process.exit(2) }
const tgz = readdirSync(distDir).filter((name) => name.endsWith('.tgz')).sort()
if (tgz.length === 0) { console.error('verify-published-bytes: no .tgz under ' + distDir); process.exit(2) }
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
/** The packed file name is <scope>-<name>-<version>.tgz; scopes flatten to a dash. */
const packageOf = (file) => {
  const base = file.replace(/\.tgz$/, '')
  const cut = base.lastIndexOf('-' + version)
  const stem = cut > 0 ? base.slice(0, cut) : base
  const dash = stem.indexOf('-')
  return dash > 0 ? '@' + stem.slice(0, dash) + '/' + stem.slice(dash + 1) : stem
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const problems = []
let compared = 0

/**
 * Fetch one published tarball with bounded exponential backoff.
 * @returns undefined on success, else the captured failure text (stderr tail included).
 */
async function fetchPublished(name, scratch, attempts, backoff) {
  let last = 'fetch-failed'
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      execFileSync(npm, ['pack', name + '@' + version, '--silent'], { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
      return undefined
    } catch (error) {
      const stderr = String((error && error.stderr) ?? '').trim().split(String.fromCharCode(10)).slice(-1)[0] ?? ''
      last = String((error && error.code) ?? 'fetch-failed') + (stderr === '' ? '' : ' :: ' + stderr.slice(0, 160))
      if (attempt < attempts) await sleep(backoff[attempt - 1] ?? 30000)
    }
  }
  return last
}

const pending = [...tgz]
for (let round = 1; round <= 2 && pending.length > 0; round += 1) {
  const attempts = round === 1 ? 5 : 2
  const backoff = round === 1 ? [3000, 8000, 20000, 45000] : [20000]
  const stillPending = []
  for (const file of pending) {
    const name = packageOf(file)
    const scratch = mkdtempSync(join(tmpdir(), 'published-bytes-'))
    const failure = await fetchPublished(name, scratch, attempts, backoff)
    if (failure !== undefined) {
      stillPending.push(file)
      rmSync(scratch, { recursive: true, force: true })
      continue
    }
    const fetched = readdirSync(scratch).filter((entry) => entry.endsWith('.tgz'))[0]
    const local = join(distDir, file)
    const published = join(scratch, String(fetched))
    const localSha = sha(local)
    const publishedSha = sha(published)
    compared += 1
    if (localSha !== publishedSha) problems.push(name + '@' + version + ': published bytes differ - local ' + localSha.slice(0, 12) + ' vs registry ' + publishedSha.slice(0, 12))
    else console.log('PASS ' + name + '@' + version + ' - ' + localSha.slice(0, 12))
    rmSync(scratch, { recursive: true, force: true })
    await sleep(250)
  }
  pending.length = 0
  pending.push(...stillPending)
  if (round === 1 && pending.length > 0) {
    console.error('verify-published-bytes: ' + pending.length + ' package(s) not readable yet - one more pass after 30s')
    await sleep(30000)
  }
}
if (problems.length > 0) { console.error('verify-published-bytes: FAIL - ' + problems.length + ' byte difference(s):'); for (const problem of problems) console.error('  - ' + problem); process.exit(1) }
if (pending.length > 0) { console.error('verify-published-bytes: NOT VERIFIED - ' + pending.length + ' package(s) could not be decided after 2 passes (compared ' + compared + ')'); process.exit(2) }
console.log('verify-published-bytes: OK - ' + compared + ' package(s) match the published bytes')
