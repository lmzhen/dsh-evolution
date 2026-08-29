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
import { readdirSync, readFileSync } from 'node:fs'
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

if (failures.length > 0) {
  console.error(`verify-layout-sync: ${failures.length} layout drift(s):`)
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`verify-layout-sync: OK — ${dev.length} script(s) identical across layouts (line endings normalized)`)
