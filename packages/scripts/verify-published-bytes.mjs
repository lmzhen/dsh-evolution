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
 * packages and then saw fetches fail while the registry propagated / rate-limited. The old shape
 * re-ran a fixed global pass schedule; a single slow package therefore held the whole check for
 * minutes and the release job (which now has its own independent verify job, W10 M4) could be seen as
 * a red publish.
 *
 * Current shape: EVERY package polls on its own budget (default 5 min) with bounded exponential
 * backoff and a small concurrency pool. A byte mismatch fails immediately (a mismatch is decided,
 * not a propagation delay); packages still unreadable when their budget expires are cannot-decide
 * (exit 2) and named. Use the independent `verify-published` CI job to re-run only this check.
 *
 * Usage: node verify-published-bytes.mjs <dist-dir> --version <x.y.z> [--budget-ms <n>] [--concurrency <n>]
 *
 * Exit: 0 all compared bytes match; 1 a byte mismatch (named); 2 cannot decide (a package could not
 * be fetched within its budget - offline or not on the registry yet).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const distDir = argv.find((entry) => !entry.startsWith('--'))
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1] }
const version = flag('--version')
const budgetRaw = flag('--budget-ms')
const concurrencyRaw = flag('--concurrency')
if (distDir === undefined || version === undefined) { console.error('usage: verify-published-bytes.mjs <dist-dir> --version <x.y.z> [--budget-ms <n>] [--concurrency <n>]'); process.exit(2) }
if (!existsSync(distDir)) { console.error('verify-published-bytes: no such dist dir ' + distDir + ' - pass the directory the release packed into'); process.exit(2) }
const budgetMs = budgetRaw === undefined ? 300000 : Number(budgetRaw)
if (!Number.isFinite(budgetMs) || budgetMs <= 0) { console.error('verify-published-bytes: --budget-ms must be a positive number (a non-positive budget decides nothing)'); process.exit(2) }
const concurrency = concurrencyRaw === undefined ? 4 : Number(concurrencyRaw)
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) { console.error('verify-published-bytes: --concurrency must be an integer in [1,16]'); process.exit(2) }
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
const registryBase = (process.env.REGISTRY_BASE ?? 'https://registry.npmjs.org').replace(/\/$/, '')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const mismatches = []
const unresolved = []
let compared = 0

/**
 * Verify ONE package within its own budget. A mismatch returns immediately (decided); a fetch that
 * keeps failing is retried with bounded exponential backoff until the budget expires.
 */
async function verifyOne(file) {
  const name = packageOf(file)
  const short = name.slice(name.indexOf('/') + 1)
  const url = registryBase + '/' + name + '/-/' + short + '-' + version + '.tgz'
  const deadline = Date.now() + budgetMs
  const delays = [2000, 5000, 10000, 20000, 30000]
  let attempt = 0
  let last = 'fetch-failed'
  while (Date.now() < deadline) {
    attempt += 1
    const scratch = mkdtempSync(join(tmpdir(), 'published-bytes-'))
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const fetched = short + '-' + version + '.tgz'
      writeFileSync(join(scratch, fetched), Buffer.from(await response.arrayBuffer()))
      const localSha = sha(join(distDir, file))
      const publishedSha = sha(join(scratch, fetched))
      compared += 1
      if (localSha !== publishedSha) {
        mismatches.push(name + '@' + version + ': published bytes differ - local ' + localSha.slice(0, 12) + ' vs registry ' + publishedSha.slice(0, 12))
        console.error('FAIL ' + name + '@' + version + ' - ' + localSha.slice(0, 12) + ' vs ' + publishedSha.slice(0, 12))
      } else console.log('PASS ' + name + '@' + version + ' - ' + localSha.slice(0, 12))
      return
    } catch (error) {
      last = String((error && error.message) ?? 'fetch-failed').slice(0, 200)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
    const wait = Math.min(delays[Math.min(attempt - 1, delays.length - 1)] ?? 30000, Math.max(0, deadline - Date.now()))
    if (wait > 0) await sleep(wait)
  }
  unresolved.push(name + '@' + version + ': not readable within ' + Math.round(budgetMs / 1000) + 's (' + attempt + ' attempt(s), last: ' + last + ')')
  console.error('UNVERIFIED ' + name + '@' + version + ' - ' + last)
}

let cursor = 0
const workers = Array.from({ length: Math.min(concurrency, tgz.length) }, async () => {
  while (cursor < tgz.length) {
    const file = tgz[cursor]
    cursor += 1
    await verifyOne(file)
  }
})
await Promise.all(workers)

if (mismatches.length > 0) {
  console.error('verify-published-bytes: FAIL - ' + mismatches.length + ' byte difference(s):')
  for (const problem of mismatches) console.error('  - ' + problem)
  process.exit(1)
}
if (unresolved.length > 0) {
  console.error('verify-published-bytes: NOT VERIFIED - ' + unresolved.length + ' package(s) not readable within their budget (compared ' + compared + '):')
  for (const problem of unresolved) console.error('  - ' + problem)
  process.exit(2)
}
console.log('verify-published-bytes: OK - ' + compared + ' package(s) match the published bytes')
