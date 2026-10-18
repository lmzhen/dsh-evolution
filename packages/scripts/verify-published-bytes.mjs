#!/usr/bin/env node
/**
 * POST-PUBLISH check: the bytes on the registry must be the bytes we packed.
 *
 * Why this exists: the pre-tag gate compares the packed tarball against what a profile has
 * installed, and it CANNOT compare against the registry (the version is not published yet), so it
 * records cannot-decide and names this check as the owner of that criterion. Until now nothing
 * owned it. Pre-publish audits (audit-release-tarballs) look at the local dist dir only.
 *
 * Usage: node verify-published-bytes.mjs <dist-dir> --version <x.y.z>
 *
 * Exit: 0 all compared bytes match; 1 a byte mismatch (named); 2 cannot decide (a package could not
 * be fetched - offline, empty cache, or not on the registry yet). cannot-decide never counts as pass.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const distDir = argv.find((entry) => !entry.startsWith("--"))
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1] }
const version = flag("--version")
if (distDir === undefined || version === undefined) { console.error("usage: verify-published-bytes.mjs <dist-dir> --version <x.y.z>"); process.exit(2) }
if (!existsSync(distDir)) { console.error("verify-published-bytes: no such dist dir " + distDir + " - pass the directory the release packed into"); process.exit(2) }
const tgz = readdirSync(distDir).filter((name) => name.endsWith(".tgz")).sort()
if (tgz.length === 0) { console.error("verify-published-bytes: no .tgz under " + distDir); process.exit(2) }
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
/** The packed file name is <scope>-<name>-<version>.tgz; scopes flatten to a dash. */
const packageOf = (file) => {
  const base = file.replace(/\.tgz$/, "")
  const cut = base.lastIndexOf("-" + version)
  const stem = cut > 0 ? base.slice(0, cut) : base
  const dash = stem.indexOf("-")
  return dash > 0 ? "@" + stem.slice(0, dash) + "/" + stem.slice(dash + 1) : stem
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const problems = []
let undecided = 0
let compared = 0
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/**
 * Fetch one published tarball, with bounded retries.
 *
 * A fresh publish is not instantly readable from every edge: the v0.26.26 tag run published all
 * 32 packages and then saw 13 `npm pack` fetches fail, so the post-publish check exited 2 while the
 * release itself was fine (registry propagation / rate limiting is transient, and cannot-decide
 * must never be reported as pass). Three attempts with exponential backoff + a small gap between
 * packages keeps the check honest without turning a propagation window into a red release.
 */
async function fetchPublished(name, scratch) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      execFileSync(npm, ["pack", name + "@" + version, "--silent"], { cwd: scratch, stdio: "pipe", shell: process.platform === "win32" })
      return undefined
    } catch (error) {
      lastError = error
      if (attempt < 3) await sleep(attempt === 1 ? 2000 : 6000)
    }
  }
  return lastError
}
for (const file of tgz) {
  const name = packageOf(file)
  const scratch = mkdtempSync(join(tmpdir(), "published-bytes-"))
  const failure = await fetchPublished(name, scratch)
  if (failure !== undefined) {
    const code = String((failure && failure.error ? failure.error.code : undefined) ?? (failure && failure.code) ?? "fetch-failed") + " :: " + String((failure && failure.message) ?? "").split(String.fromCharCode(10))[0].slice(0, 140)
    console.error("CANNOT DECIDE " + name + "@" + version + ": could not fetch the published tarball after 3 attempts (" + code + ") - the registry is unreachable, or the version is not published yet")
    undecided += 1
    rmSync(scratch, { recursive: true, force: true })
    continue
  }
  const fetched = readdirSync(scratch).filter((entry) => entry.endsWith(".tgz"))[0]
  const local = join(distDir, file)
  const published = join(scratch, String(fetched))
  const localSha = sha(local)
  const publishedSha = sha(published)
  compared += 1
  if (localSha !== publishedSha) problems.push(name + "@" + version + ": published bytes differ - local " + localSha.slice(0, 12) + " vs registry " + publishedSha.slice(0, 12))
  else console.log("PASS " + name + "@" + version + " - " + localSha.slice(0, 12))
  rmSync(scratch, { recursive: true, force: true })
  await sleep(250)
}
if (problems.length > 0) { console.error("verify-published-bytes: FAIL - " + problems.length + " byte difference(s):"); for (const problem of problems) console.error("  - " + problem); process.exit(1) }
if (undecided > 0) { console.error("verify-published-bytes: NOT VERIFIED - " + undecided + " package(s) could not be decided (compared " + compared + ")"); process.exit(2) }
console.log("verify-published-bytes: OK - " + compared + " package(s) match the published bytes")