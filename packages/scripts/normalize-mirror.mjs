#!/usr/bin/env node
/**
 * Normalize manifests after copying the upstream packages/evolution tree into
 * the flat public mirror (D2: the mirror is the publishing carrier; the dev
 * tree stays canonical for builds/tests):
 *   - repository URL points at the public mirror
 *   - repository.directory points at the flat package directory
 *   - package and root versions stay aligned at 0.1.0-rc.1
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packagesRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(dirname(packagesRoot))
const VERSION = '0.1.0-rc.1'

for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifestPath = join(packagesRoot, entry.name, 'package.json')
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { continue }
  manifest.version = VERSION
  manifest.repository = {
    type: 'git',
    url: 'git+https://github.com/lmzhen/dsh-evolution.git',
    directory: `packages/${entry.name}`,
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

const rootManifestPath = join(repoRoot, 'package.json')
const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'))
rootManifest.version = VERSION
writeFileSync(rootManifestPath, JSON.stringify(rootManifest, null, 2) + '\n')
console.log('normalized mirror manifests')
