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
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packagesRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const changelogPath = join(dirname(packagesRoot), 'CHANGELOG.md')
if (!existsSync(changelogPath)) {
  console.warn('normalize-mirror: no CHANGELOG.md one level up (dev-tree twin?) — no-op, keeping canonical manifests.')
  process.exit(0)
}

const match = /^## (\d+\.\d+\.\d+)/m.exec(readFileSync(changelogPath, 'utf8'))
const VERSION = match?.[1] ?? '0.1.0-rc.1'
if (!match) console.warn(`normalize-mirror: no "## x.y.z" heading in CHANGELOG.md — keeping baseline ${VERSION}`)

let changed = 0
for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifestPath = join(packagesRoot, entry.name, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.version === VERSION) continue
  manifest.version = VERSION
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  changed++
}

const rootManifestPath = join(dirname(packagesRoot), 'package.json')
if (existsSync(rootManifestPath)) {
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'))
  if (rootManifest.version !== VERSION) {
    rootManifest.version = VERSION
    writeFileSync(rootManifestPath, JSON.stringify(rootManifest, null, 2) + '\n')
    changed++
  }
}

console.log(`normalize-mirror: ${changed} manifest(s) aligned to ${VERSION}`)
