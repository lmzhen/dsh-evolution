#!/usr/bin/env node
/**
 * Normalize manifests after copying the upstream packages/evolution tree into
 * this flat mirror:
 *   - repository URL points at this public repository
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
  if (!readFileSync(manifestPath, 'utf8').trim()) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.version = VERSION
  manifest.repository = {
    type: 'git',
    url: 'git+https://github.com/lmzhen/dsh-evolution.git',
    directory: `packages/${entry.name}`,
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
rootManifest.version = VERSION
writeFileSync(join(repoRoot, 'package.json'), JSON.stringify(rootManifest, null, 2) + '\n')
console.log('normalized mirror manifests')
