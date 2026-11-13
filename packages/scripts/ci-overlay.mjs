#!/usr/bin/env node
/**
 * ci-overlay — turn the flat family checkout into the upstream overlay tree.
 *
 * ONE home for the sequence both CI actions need (the full validate action and the Windows
 * install lane): copy `packages/**` into `upstream/packages/evolution`, inject the family alias
 * block into the upstream tsconfig, ship the platform line, and leave the overlay in the same
 * state a clean CI checkout produces. Before this script the same shell block lived in
 * action.yml; a second lane re-writing it would drift exactly like the pre-M3 alias sets did.
 *
 * Usage (from the repository root):
 *   node packages/scripts/ci-overlay.mjs [--upstream <dir>] [--family <dir>] [--no-clean]
 *
 * Flags:
 *   --upstream <dir>  the upstream checkout (default: upstream)
 *   --family <dir>    the flat family package root (default: packages)
 *   --no-clean        keep an existing overlay instead of rebuilding it (local re-runs)
 *
 * Exits 1 on any missing input; the injector's own loud failures propagate.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const value = (name, fallback) => {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const next = args[index + 1]
  return next === undefined || next.startsWith('--') ? fallback : next
}
const upstream = resolve(ROOT, value('--upstream', 'upstream'))
const family = resolve(ROOT, value('--family', 'packages'))
const clean = !args.includes('--no-clean')

const fail = (message) => { console.error('ci-overlay: ' + message); process.exit(1) }
if (!existsSync(join(upstream, 'package.json'))) fail('no upstream checkout at ' + upstream + ' (expected package.json)')
if (!existsSync(join(upstream, 'tsconfig.base.json'))) fail('upstream checkout carries no tsconfig.base.json: ' + upstream)
if (!existsSync(family) || !statSync(family).isDirectory()) fail('no family package root at ' + family)

const overlay = join(upstream, 'packages', 'evolution')
// A clean checkout carries no build outputs; the local mirror can. Skip exactly what the old
// shell block deleted afterwards (package-root node_modules/lib/dist and staging residue) so the
// overlay equals the clean-clone shape without copying gigabytes of local build state.
const SKIP_AT_PACKAGE_ROOT = new Set(['node_modules', 'lib', 'dist', '.release-staging', '.release-staging.next', '.release-staging.previous'])
const filter = (source) => {
  if (source === family) return true
  const relative = source.slice(family.length + 1).split(/[\\/]/)
  if (relative.includes('.git')) return false
  if (relative[0] === 'node_modules' || relative[0].startsWith('.release-staging')) return false
  if (relative.length === 2 && SKIP_AT_PACKAGE_ROOT.has(relative[1])) return false
  return true
}

if (clean) rmSync(overlay, { recursive: true, force: true })
mkdirSync(overlay, { recursive: true })
cpSync(family, overlay, { recursive: true, force: true, filter })

// The old block pruned the overlay root itself; keep the same hygiene for --no-clean re-runs.
for (const residue of ['node_modules', 'lib', 'dist', '.release-staging', '.release-staging.next', '.release-staging.previous']) {
  rmSync(join(overlay, residue), { recursive: true, force: true })
}

const inject = spawnSync(process.execPath, [
  join(family, 'scripts', 'inject-evolution-paths.mjs'),
  join(upstream, 'tsconfig.base.json'),
  join(ROOT, 'tsconfig.base.json'),
], { cwd: ROOT, stdio: 'inherit' })
if (inject.error !== undefined) fail('inject-evolution-paths could not start: ' + inject.error.message)
if (inject.status !== 0) fail('inject-evolution-paths failed with exit ' + String(inject.status))

const platformLine = join(ROOT, 'platform-line.json')
if (!existsSync(platformLine)) fail('no platform-line.json at the repository root')
cpSync(platformLine, join(upstream, 'platform-line.json'))

const packages = readdirSync(overlay, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
const aliasLines = readFileSync(join(upstream, 'tsconfig.base.json'), 'utf8').split(/\r?\n/).filter((line) => /"@deepseek-ai\/(?:dsh-evolution|dsh-memory|dsh-tool|dsh-skill-usage)|"@lmzhen\//.test(line)).length
const platformVersion = JSON.parse(readFileSync(platformLine, 'utf8')).version
console.log('ci-overlay: overlay=' + overlay + ' packages=' + packages + ' family_aliases=' + aliasLines + ' platform_line=' + platformVersion)
