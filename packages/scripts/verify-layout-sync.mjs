#!/usr/bin/env node
/**
 * Layout-sync guard (P1-②): the dev tree and the flat mirror carry the SAME
 * source set, and every change must be synced by hand — the rc.51
 * `tsdown.package.config.ts` drift (D-7) was exactly a one-sided edit.
 *
 * Coverage (M-6, v3 audit): this guard compares the two `scripts/` trees —
 * the publish-carrying scripts that are maintained in BOTH layouts by hand.
 * The `packages/<pkg>` trees are the release-surface output of
 * normalize-mirror; a full-tree comparison is a future `--deep` option.
 *
 * Usage (both paths are REQUIRED — no hardcoded machine layouts):
 *   node packages/scripts/verify-layout-sync.mjs <dev-scripts-dir> <mirror-scripts-dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)

const devDir = resolve(argv[0] ?? '')
const mirrorDir = resolve(argv[1] ?? '')
if (!argv[0] || !argv[1]) {
  console.error('usage: verify-layout-sync.mjs <dev-scripts-dir> <mirror-scripts-dir> (both required)')
  process.exit(1)
}

const normalize = (content) => content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const names = (dir) => {
  try {
    return readdirSync(dir).filter(name => !name.startsWith('.')).sort()
  } catch {
    return []
  }
}

const dev = names(devDir)
const mirror = names(mirrorDir)
const failures = []
for (const name of new Set([...dev, ...mirror])) {
  const devPath = join(devDir, name)
  const mirrorPath = join(mirrorDir, name)
  const inDev = dev.includes(name)
  const inMirror = mirror.includes(name)
  if (!inDev || !inMirror) {
    failures.push(`${name}: exists only in ${inDev ? 'dev (missing in mirror)' : 'mirror (missing in dev)'}`)
    continue
  }
  if (normalize(readFileSync(devPath, 'utf8')) !== normalize(readFileSync(mirrorPath, 'utf8'))) {
    failures.push(`${name}: content differs between layouts`)
  }
}

// V9-01 (0.3.50): committed-preview contract — the first "## x.y.z" heading in
// the mirror-root CHANGELOG must equal every package manifest version AND the
// root package.json version. dcebd8c rewrote 30 manifests to the dev baseline
// 0.1.0-rc.1 and four releases later nothing had caught it (the publish chain
// re-derives versions from the git tag, so the drift was invisible to CI).
const repoRoot = resolve(mirrorDir, '..', '..')
try {
  const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8')
  const head = /^## (\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)/m.exec(changelog)?.[1]
  if (!head) {
    failures.push('CHANGELOG.md has no "## x.y.z" heading')
  } else {
    const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    if (rootManifest.version !== head) failures.push(`root package.json version ${rootManifest.version} != CHANGELOG head ${head}`)
    for (const entry of readdirSync(join(repoRoot, 'packages'))) {
      const manifestPath = join(repoRoot, 'packages', entry, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest.version !== head) failures.push(`${entry}: version ${manifest.version} != CHANGELOG head ${head}`)
    }
  }
} catch (error) {
  failures.push(`version-guard scan failed: ${error instanceof Error ? error.message : String(error)}`)
}

if (failures.length > 0) {
  console.error(`verify-layout-sync: ${failures.length} layout drift(s):`)
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`verify-layout-sync: OK — ${dev.length} script(s) identical across layouts (line endings normalized); versions align with CHANGELOG head`)
