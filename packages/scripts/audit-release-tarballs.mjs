#!/usr/bin/env node
/**
 * Pre-publish audit of the packed release tarballs: the bytes a user actually installs.
 *
 * The publish path already proves the RANGES are right (`verify-platform-ranges`) and that pnpm
 * can pack them (`publish-scoped.mjs --dry-run`), and neither of those opens a tarball. This looks
 * inside every one of them: scoped identity, that each entry a consumer resolves (main / types /
 * exports) exists in the payload, that the scoped release dropped the ./src/* shim, that the
 * platform ranges are exactly the floor, that no @deepseek-ai/dsh-evolution- name literal survived
 * the rescope, that each browser half carries lib/client.js plus its dsh.client declaration, and
 * that no test / node_modules / tarball residue rode along.
 *
 * Usage:
 *   node audit-release-tarballs.mjs <dist-dir> [--version <x.y.z>] [--platform-range <^x.y.z>]
 *
 * Both optional flags come from the release workflow's own variables (RELEASE_VERSION's tag form
 * and PLATFORM_FLOOR), so the audit compares the packed bytes against the release's declared
 * contract rather than against a second copy of that contract kept here.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The `tar` on PATH is GNU tar from Git Bash on Windows, which reads a `D:\...` path as a remote
// host spec; the npm module extracts in-process and takes the path verbatim. Candidates are the
// script's own resolution chain and every ancestor `node_modules`, so the same file works in the
// mirror (`packages/scripts`), in the overlay (`packages/evolution/scripts`) and in a CI checkout
// where the publish job installs one deliberately.
const require = createRequire(import.meta.url)
function loadTar() {
  const candidates = ['tar']
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let up = 0; up < 6; up += 1) {
    candidates.push(join(dir, 'node_modules', 'tar'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const candidate of candidates) {
    try { return require(candidate) } catch { /* try the next candidate */ }
  }
  throw new Error('audit-release-tarballs: no `tar` module resolvable (install one on the tree, e.g. npm install --no-save tar)')
}
const tar = loadTar()

const argv = process.argv.slice(2)
const distDir = argv.find((arg) => !arg.startsWith('--'))
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1] }
const expectedVersion = flag('--version')
const expectedPlatformRange = flag('--platform-range')
if (distDir === undefined) {
  console.error('usage: audit-release-tarballs.mjs <dist-dir> [--version <x.y.z>] [--platform-range <^x.y.z>]')
  process.exit(2)
}

const tarballs = readdirSync(distDir).filter((name) => name.endsWith('.tgz')).sort()
if (tarballs.length === 0) { console.error('audit-release-tarballs: no .tgz under ' + distDir); process.exit(2) }

const problems = []
const notes = []
/** How many tarballs declared a browser half (the vacuity check at the end reads this). */
let clientTarballs = 0

/**
 * Every file in one extracted payload, relative to the package root.
 * @param root - the extracted `package/` directory.
 * @returns the payload paths, forward-slashed.
 */
function payloadFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(full.slice(root.length + 1).replaceAll('\\', '/'))
    }
  }
  walk(root)
  return out
}

for (const tarball of tarballs) {
  const scratch = mkdtempSync(join(tmpdir(), 'tarball-audit-'))
  try {
    tar.x({ file: join(distDir, tarball), cwd: scratch, sync: true })
    const root = join(scratch, 'package')
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const files = payloadFiles(root)
    const short = manifest.name ?? tarball

    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@lmzhen/')) problems.push(short + ': name is not @lmzhen-scoped')
    if (expectedVersion !== undefined && manifest.version !== expectedVersion) problems.push(short + ': version ' + String(manifest.version) + ' != ' + expectedVersion)
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) problems.push(short + ': no files allowlist')

    const entryTargets = []
    if (typeof manifest.main === 'string') entryTargets.push(manifest.main)
    if (typeof manifest.types === 'string') entryTargets.push(manifest.types)
    for (const [key, value] of Object.entries(manifest.exports ?? {})) {
      if (key === './package.json') continue
      if (key === './src/*') { problems.push(short + ': scoped release still exports ./src/*'); continue }
      if (typeof value === 'string') entryTargets.push(value)
      else for (const sub of Object.values(value ?? {})) if (typeof sub === 'string') entryTargets.push(sub)
    }
    for (const target of entryTargets) {
      const clean = target.replace(/^\.\//, '')
      if (!files.includes(clean)) problems.push(short + ': declares ' + target + ' but the payload has no such file')
    }

    for (const section of ['dependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (name.startsWith('@deepseek-ai/dsh-') && expectedPlatformRange !== undefined && range !== expectedPlatformRange) {
          problems.push(short + ': ' + section + '.' + name + ' = ' + String(range) + ' (expected ' + expectedPlatformRange + ')')
        }
        if (name.startsWith('@lmzhen/') && expectedVersion !== undefined && range !== '^' + expectedVersion) {
          problems.push(short + ': ' + section + '.' + name + ' = ' + String(range) + ' (expected ^' + expectedVersion + ')')
        }
      }
    }

    for (const file of files) {
      if (/^(tests|node_modules)\//.test(file)) problems.push(short + ': payload carries ' + file)
      if (file.endsWith('.tgz')) problems.push(short + ': payload carries a tarball ' + file)
    }

    const shipped = files.filter((file) => file.startsWith('lib/') && file.endsWith('.js'))
    for (const file of shipped) {
      const text = readFileSync(join(root, file), 'utf8')
      if (text.includes('@deepseek-ai/dsh-evolution-')) problems.push(short + ': ' + file + ' still carries a @deepseek-ai/dsh-evolution- literal')
    }

    // v46 S2.3 (finding T7-08): the tarball's OWN manifest decides whether it carries a browser
    // half. The hand-copied package set meant a third half was never checked for its loader
    // artifact — it could ship without lib/client.js and the audit would stay silent.
    if (manifest.dsh?.client !== undefined) {
      clientTarballs += 1
      if (!files.includes('lib/client.js')) problems.push(short + ': declares dsh.client but the payload carries no lib/client.js')
    } else if (files.includes('lib/client.js')) {
      problems.push(short + ': ships lib/client.js without a dsh.client declaration — the loader the platform mounts is not the one the manifest promises')
    }
    notes.push(short + ' ' + String(manifest.version) + ' — ' + files.length + ' file(s), ' + shipped.length + ' shipped module(s)')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// v46 S2.3: the browser halves are mandatory surfaces — a release that carries none is a silent
// regression, not a clean audit (the family ships two).
if (clientTarballs === 0) {
  problems.push('no tarball declares dsh.client — the release carries no browser half at all')
}
console.log('audit-release-tarballs: ' + tarballs.length + ' tarball(s) under ' + distDir + ' (' + clientTarballs + ' with a browser half)')
for (const note of notes) console.log('  ' + note)
if (problems.length > 0) {
  console.error('audit-release-tarballs: FAIL — ' + problems.length + ' problem(s):')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('audit-release-tarballs: OK — every packed tarball is publishable as packed')
