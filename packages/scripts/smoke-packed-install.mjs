#!/usr/bin/env node
/**
 * P2-33: install the PACKED tarballs the way a consumer does.
 *
 * The old CI "install smoke" ran install-layered over the source overlay, so it
 * proved the source tree worked, never that the bytes npm will serve do. This
 * extracts every dist tarball into a throwaway consumer node_modules, links the
 * platform scope from the build tree, imports each package's declared entry, and
 * checks its bundle patch asset. A missing lib file, export target or runtime
 * asset fails here, before publish.
 *
 * Usage: node smoke-packed-install.mjs <dist-dir> [--platform-node-modules <dir>]
 */
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const dist = argv[0]
if (dist === undefined || dist === '') {
  console.error('smoke-packed-install: usage: <dist-dir> [--platform-node-modules <dir>]')
  process.exit(2)
}
const distDir = resolve(dist)
const platformIndex = argv.indexOf('--platform-node-modules')
const platformNodeModules = platformIndex >= 0 ? resolve(argv[platformIndex + 1] ?? '') : join(process.cwd(), 'node_modules')
const manifest = JSON.parse(await readFile(join(distDir, 'manifest.json'), 'utf8'))
const tarballs = Object.values(manifest)
if (tarballs.length === 0) {
  console.error('smoke-packed-install: dist manifest carries no tarball')
  process.exit(1)
}

const root = await mkdtemp(join(tmpdir(), 'dsh-packed-consumer-'))
const consumer = join(root, 'consumer')
const modules = join(consumer, 'node_modules')
await mkdir(modules, { recursive: true })
await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'packed-consumer', private: true, type: 'module' }, null, 2) + '\n')

// Platform peers/dependencies resolve from the build tree, not the registry:
// this smoke is about the PACKAGE BYTES, and a network failure must not mask it.
const link = async (target, path) => {
  if (existsSync(path)) return
  await mkdir(dirname(path), { recursive: true })
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}
await link(join(platformNodeModules, '@deepseek-ai'), join(modules, '@deepseek-ai'))
// Ordinary runtime deps (yaml, zod, react, ...) come from the build tree too;
// the family scope is the tarballs under test, never the workspace copies.
for (const entry of await readdir(platformNodeModules, { withFileTypes: true })) {
  if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith('.') || entry.name.startsWith('@')) continue
  await link(join(platformNodeModules, entry.name), join(modules, entry.name))
}

const unpacked = []
try {
  for (const tarball of tarballs) {
    const file = join(distDir, String(tarball))
    if (!existsSync(file)) throw new Error('tarball missing: ' + file)
    const staging = join(root, 'unpack-' + String(unpacked.length))
    await mkdir(staging, { recursive: true })
    execFileSync('tar', ['-xzf', file, '-C', staging], { stdio: 'pipe' })
    const packageDir = join(staging, 'package')
    const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
    if (typeof pkg.name !== 'string' || !pkg.name.startsWith('@')) throw new Error('tarball has no scoped package name: ' + file)
    const target = join(modules, ...pkg.name.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await rename(packageDir, target)
    unpacked.push({ name: pkg.name, dir: target, pkg })
  }
  const failures = []
  for (const item of unpacked) {
    const exportsField = item.pkg.exports ?? {}
    const dot = exportsField['.']
    const entry = typeof exportsField === 'string'
      ? exportsField
      : typeof dot === 'string'
        ? dot
        : dot?.default ?? dot?.import ?? dot?.require
    if (typeof entry !== 'string') {
      failures.push(item.name + ': package.json declares no usable "." export')
      continue
    }
    const entryPath = join(item.dir, entry.replace(/^\.\//, ''))
    if (!existsSync(entryPath)) {
      failures.push(item.name + ': export target is absent from the tarball: ' + entry)
      continue
    }
    try {
      await import(pathToFileURL(entryPath).href)
    } catch (error) {
      failures.push(item.name + ': entry import failed: ' + (error instanceof Error ? error.message : String(error)))
    }
    const patch = item.pkg?.dsh?.bundle?.patch
    if (typeof patch === 'string' && !existsSync(join(item.dir, patch))) failures.push(item.name + ': bundle patch is absent: ' + patch)
  }
  if (failures.length > 0) {
    console.error('smoke-packed-install: ' + failures.length + ' failure(s)')
    for (const failure of failures) console.error('  - ' + failure)
    process.exit(1)
  }
  console.log('smoke-packed-install: OK - ' + unpacked.length + ' tarball(s) unpacked; every "." export imports; every bundle patch is present')
} finally {
  await rm(root, { recursive: true, force: true })
}
