#!/usr/bin/env node
/**
 * Build the platform/dependency node_modules that the packed consumer needs,
 * from the family tarballs' own manifests. This is the artifact-first half of
 * the full-import gate: the tarballs under test are the only family bytes.
 *
 * Usage: node prepare-packed-platform.mjs <dist-dir> [platform-version]
 * Prints the absolute node_modules path on stdout.
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dist = process.argv[2]
const platformVersion = process.argv[3] ?? '0.2.2-rc.1'
if (!dist) { console.error('usage: prepare-packed-platform.mjs <dist-dir> [platform-version]'); process.exit(2) }
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'))
const tarballs = Object.values(manifest)
if (tarballs.length === 0) { console.error('prepare-packed-platform: empty manifest'); process.exit(1) }
const specs = new Set()
const add = (name, range) => { if (!name.startsWith('@lmzhen/')) specs.add(name + '@' + range) }
for (const tarball of tarballs) {
  // cwd + bare filename: GNU tar reads `D:\...` as a REMOTE host and fails ("Cannot connect to D:") —
  // the dist dir may be an absolute path on a Windows runner.
  const raw = execFileSync('tar', ['-xOf', String(tarball), 'package/package.json'], { encoding: 'utf8', cwd: dist })
  const pkg = JSON.parse(raw)
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-')) add(name, platformVersion)
    else add(name, range)
  }
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-')) add(name, platformVersion)
    else add(name, range)
  }
}
// @deepseek-ai/dsh-storage-domain@0.2.2-rc.1 imports @deepseek-ai/dsh-storage but does not
// declare it, so install it explicitly for the artifact-first import gate.
specs.add('@deepseek-ai/dsh-storage@' + platformVersion)
const root = await mkdtemp(join(tmpdir(), 'dsh-packed-platform-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
execFileSync(npm, ['install', '--prefix', root, '--no-package-lock', '--no-save', '--legacy-peer-deps', ...specs], { stdio: 'inherit', shell: process.platform === 'win32' })
process.stdout.write(join(root, 'node_modules') + '\n')
