#!/usr/bin/env node
/**
 * Layout-sync guard (P1-②): the dev tree and the flat mirror carry the SAME
 * source set (`packages/<pkg>` plus `scripts/`), and every change must be
 * synced by hand — the rc.51 `tsdown.package.config.ts` drift (D-7) was
 * exactly a one-sided edit. This script compares the two `scripts/` trees
 * (the publishing carrier) with line-ending normalization, so a pure
 * CRLF/LF difference is NOT a drift while any content difference is.
 *
 * Usage (run from either tree root):
 *   node packages/scripts/verify-layout-sync.mjs <dev-scripts-dir> <mirror-scripts-dir>
 *   node packages/scripts/verify-layout-sync.mjs --auto   # defaults for this repo
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
function arg(name, fallback = '') {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

let devDir = arg('--auto') === '1' ? 'D:/dsh/deepseek-harness/packages/evolution/scripts' : argv[0]
let mirrorDir = arg('--auto') === '1' ? 'D:/dsh/dsh-evolution-mirror/packages/scripts' : argv[1]
if (!devDir || !mirrorDir) {
  console.error('usage: verify-layout-sync.mjs <dev-scripts-dir> <mirror-scripts-dir>')
  process.exit(1)
}
devDir = resolve(devDir)
mirrorDir = resolve(mirrorDir)

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
