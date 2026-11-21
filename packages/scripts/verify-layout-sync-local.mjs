#!/usr/bin/env node
/**
 * Gate-15: layout-sync, resolved from the current build line instead of a CI-only relative path.
 *
 * The old external row ran D:/dsh/audit-v37/mirror-sync.mjs, which no longer exists. gate-75 keeps
 * the release-chain comparison; this local-safe row resolves the build line through lib-env and
 * compares its scripts tree with the flat mirror's.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveOverlay } from './lib-env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const overlay = resolveOverlay()
if (overlay === null) {
  console.error('verify-layout-sync-local: CANNOT DECIDE - no platform overlay found (set EVOLUTION_OVERLAY_ROOT)')
  process.exit(2)
}
const dev = join(overlay, 'packages', 'evolution', 'scripts')
const result = spawnSync(process.execPath, [join(HERE, 'verify-layout-sync.mjs'), dev, HERE], { encoding: 'utf8', stdio: 'inherit' })
if (result.error !== undefined && result.error !== null) {
  console.error('verify-layout-sync-local: ' + result.error.message)
  process.exit(2)
}
process.exit(result.status ?? 1)
