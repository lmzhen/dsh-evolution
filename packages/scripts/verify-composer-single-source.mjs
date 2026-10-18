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
import { existsSync, readFileSync } from 'node:fs'
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

if (problems.length > 0) {
  console.error('verify-composer-single-source: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-composer-single-source: OK — one composer implementation, installer imports the built core lib, no generated twin')
