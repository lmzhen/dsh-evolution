#!/usr/bin/env node
/**
 * Align manifest versions after copying the upstream packages/evolution tree
 * into the flat public mirror (D2: the mirror is the publishing carrier; the
 * dev tree stays canonical for builds/tests):
 *   - every package manifest and the root package.json get the newest release
 *     line from CHANGELOG.md — P3-7: the old constant 0.1.0-rc.1 was the dev
 *     baseline and mismatched the 0.3.x line a human reading the public
 *     manifests sees. The exact release version still comes from the git tag
 *     via prepare-release --version; this only fixes the committed preview.
 *   - repository metadata is NOT normalized here: prepare-release stamps the
 *     public mirror URL and the flat package directory at pack time (single
 *     source), so committed manifests keep the dev-tree repository.
 *
 * Layout: the script sits in <tree>/scripts/ in both layouts (dev:
 * packages/evolution/scripts, mirror: packages/scripts) and climbs one level
 * to the directory holding the package folders. Only the mirror carries a
 * CHANGELOG.md; without one (dev twin, layout-sync parity only) it is a no-op
 * that never rewrites canonical dev manifests.
 *
 * v22 (PRE-2): every rewrite is tmp+rename atomic and each file is parsed in
 * its own try/catch with failures collected and reported at the end. The old
 * direct writeFileSync + parse-abort loop left a TRUNCATED manifest on an
 * interrupted run, and every later run aborted on that same file — a
 * permanently unself-healing carrier plus a mixed-version mirror.
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changelogHead } from './lib-changelog.mjs'

const packagesRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const changelogPath = join(dirname(packagesRoot), 'CHANGELOG.md')
if (!existsSync(changelogPath)) {
  console.warn('normalize-mirror: no CHANGELOG.md one level up (dev-tree twin?) — no-op, keeping canonical manifests.')
  process.exit(0)
}

const match = changelogHead(readFileSync(changelogPath, 'utf8'))
if (!match) {
  // V6-47 (0.3.37): a missing "## x.y.z" heading used to fall back to the
  // hardcoded '0.1.0-rc.1' and REWRITE every manifest DOWN (a dangerous
  // version regression on a single format drift). Fail loud instead.
  console.error('normalize-mirror: no "## x.y.z" heading at the top of CHANGELOG.md (format drift?) — refusing to touch manifests.')
  process.exit(1)
}
const VERSION = match

/** tmp+rename atomic manifest rewrite (same discipline as inject-evolution-
 * paths F-352 / the installer F-354): a crash mid-write leaves a tmp file,
 * never a truncated manifest. */
function rewriteAtomically(manifestPath, manifest) {
  const tmp = `${manifestPath}.tmp`
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n')
  renameSync(tmp, manifestPath)
}

let changed = 0
const failures = []
for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifestPath = join(packagesRoot, entry.name, 'package.json')
  if (!existsSync(manifestPath)) continue
  try {
    // Per-file isolation: one unreadable manifest is REPORTED, not a loop
    // abort — the old parse-abort left every later manifest unaligned while
    // the broken file also blocked its own repair.
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.version === VERSION) continue
    manifest.version = VERSION
    rewriteAtomically(manifestPath, manifest)
    changed++
  } catch (error) {
    failures.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const rootManifestPath = join(dirname(packagesRoot), 'package.json')
if (existsSync(rootManifestPath)) {
  try {
    const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'))
    if (rootManifest.version !== VERSION) {
      rootManifest.version = VERSION
      rewriteAtomically(rootManifestPath, rootManifest)
      changed++
    }
  } catch (error) {
    failures.push(`root package.json: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures.length > 0) {
  console.error(`normalize-mirror: ${failures.length} manifest(s) could not be aligned to ${VERSION}:`)
  console.error(failures.join('\n'))
  console.error('normalize-mirror: fix or delete the broken manifest(s) and re-run — the rest of the tree was still aligned.')
  process.exit(1)
}

console.log(`normalize-mirror: ${changed} manifest(s) aligned to ${VERSION}`)
