#!/usr/bin/env node
/**
 * gate-35: the preset composer has exactly ONE implementation.
 *
 * G2-S2 retired the generated installer-side port (lib-preset-composition.mjs) and its generator
 * (gen-composer-port.mjs): the source installer now imports the BUILT evolution-core composer
 * (lib/composition/index.js), so the two paths cannot drift because there is only one path.
 * This gate keeps the retirement retired: the twin/generator must not come back, the installer must
 * import the built artifact, and no installer-local copy of the override/cap logic may reappear.
 * Usage: node packages/scripts/verify-composer-single-source.mjs [packages-root]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? 'packages'
const scripts = join(root, 'scripts')
const installerPath = join(scripts, 'install-layered.mjs')
const problems = []

for (const gone of ['lib-preset-composition.mjs', 'gen-composer-port.mjs']) {
  if (existsSync(join(scripts, gone))) problems.push(join(scripts, gone) + ' exists but the composer has one implementation (delete the generated twin/generator)')
}
if (!existsSync(installerPath)) {
  console.error('verify-composer-single-source: missing ' + installerPath)
  process.exit(1)
}
const installer = readFileSync(installerPath, 'utf8')
if (!installer.includes('evolution-core/lib/composition/index.js')) {
  problems.push('install-layered.mjs does not import the built core composer (expected evolution-core/lib/composition/index.js)')
}
if (installer.includes("from './lib-preset-composition.mjs'")) {
  problems.push('install-layered.mjs imports the retired generated twin')
}
if (/export function injectToolSkillCap/.test(installer)) {
  problems.push('install-layered.mjs regrew a local injectToolSkillCap (the cap injection belongs to the core composer)')
}

// G2-S6: the restricted preset rides in the runtime registry only (RESTRICTED_PRESET_DELIVERY=runtime),
// so every bundle that can mount the family must resolve `evolution-core/restrictor`, and no profile
// patch/yml may carry the restricted preset ids (a second delivery source would double-register).
const DELIVERY = readFileSync(join(root, 'evolution-core/src/composition/preset-ids.ts'), 'utf8')
if (!DELIVERY.includes("RESTRICTED_PRESET_DELIVERY = 'runtime'")) {
  problems.push('RESTRICTED_PRESET_DELIVERY is not the frozen runtime value')
}
const restrictedIds = ['evolution-reviewer-readonly', 'evolution-maintainer-readonly', 'evolution-restricted-tools']
for (const bundle of ['evolution-all', 'evolution-host', 'evolution-preset', 'evolution-agent']) {
  const manifestPath = join(root, bundle, 'package.json')
  if (!existsSync(manifestPath)) { problems.push('missing bundle manifest ' + manifestPath); continue }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const declared = Object.keys(manifest.dependencies ?? {})
  if (!declared.includes('@deepseek-ai/dsh-evolution-core')) problems.push(bundle + ' does not declare @deepseek-ai/dsh-evolution-core (the restrictor row must be resolvable)')
}
const ymlFiles = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) ymlFiles.push(full)
  }
}
walk(root)
for (const file of ymlFiles) {
  const text = readFileSync(file, 'utf8')
  for (const id of restrictedIds) if (text.includes(id)) problems.push(file + ' carries the restricted preset id ' + id + ' (runtime delivery is the only source)')
}

if (problems.length > 0) {
  console.error('verify-composer-single-source: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-composer-single-source: OK — one composer implementation, installer imports the built core lib, no generated twin, restricted presets are runtime-only and resolvable from every bundle')
