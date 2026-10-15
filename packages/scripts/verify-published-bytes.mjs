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
for (const file of tgz) {
  const name = packageOf(file)
  const scratch = mkdtempSync(join(tmpdir(), "published-bytes-"))
  try {
    execFileSync(npm, ["pack", name + "@" + version, "--silent"], { cwd: scratch, stdio: "pipe", shell: process.platform === "win32" })
  } catch (error) {
    const code = String((error && error.error ? error.error.code : undefined) ?? (error && error.code) ?? "fetch-failed") + " :: " + String((error && error.message) ?? "").split(String.fromCharCode(10))[0].slice(0, 140)
    console.error("CANNOT DECIDE " + name + "@" + version + ": could not fetch the published tarball (" + code + ") - the registry is unreachable, or the version is not published yet")
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
}
if (problems.length > 0) { console.error("verify-published-bytes: FAIL - " + problems.length + " byte difference(s):"); for (const problem of problems) console.error("  - " + problem); process.exit(1) }
if (undecided > 0) { console.error("verify-published-bytes: NOT VERIFIED - " + undecided + " package(s) could not be decided (compared " + compared + ")"); process.exit(2) }
console.log("verify-published-bytes: OK - " + compared + " package(s) match the published bytes")