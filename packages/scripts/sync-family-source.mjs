#!/usr/bin/env node
/**
 * Deterministic staging sync: copy the canonical evolution package sources into
 * the release mirror, or report drift with --check. package.json/README/lib/dist
 * stay release-owned; source, tests, vendor and provenance files are canonical.
 *
 * Usage:
 *   node sync-family-source.mjs --from <overlay packages/evolution> --to <mirror packages> [--only pkg] [--check]
 */
import { createHash } from 'node:crypto'
import { cp, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const args = process.argv.slice(2)
const value = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
const from = value('--from')
const to = value('--to')
const only = value('--only')
const check = args.includes('--check')
if (!from || !to) throw new Error('usage: sync-family-source.mjs --from <overlay> --to <mirror> [--only pkg] [--check]')

const SKIP = new Set(['node_modules', 'lib', 'dist', '.release-staging.next', '.release-staging.previous'])
const ROOT_FILES = new Set(['UPSTREAM.json', 'verify-upstream.mjs', 'persisted-write-inventory.json'])
const hashes = new Map()
async function walk(dir, rel = '') {
  const rows = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name === '.git' || entry.name.endsWith('.tgz')) continue
    const child = join(dir, entry.name)
    const childRel = rel === '' ? entry.name : rel + '/' + entry.name
    if (entry.isDirectory()) rows.push(...await walk(child, childRel))
    else if (entry.isFile()) rows.push(childRel)
  }
  return rows
}
async function digest(file) { return createHash('sha256').update(await readFile(file)).digest('hex') }

const packages = (await readdir(from, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
let changed = 0
for (const pkg of packages) {
  if (only !== undefined && pkg !== only) continue
  const srcDir = join(from, pkg)
  const dstDir = join(to, pkg)
  const files = []
  for (const part of ['src', 'vendor', 'tests', 'data']) {
    try { if ((await stat(join(srcDir, part))).isDirectory()) files.push(...await walk(join(srcDir, part), part)) } catch {}
  }
  for (const name of ROOT_FILES) {
    try { if ((await stat(join(srcDir, name))).isFile()) files.push(name) } catch {}
  }
  for (const rel of files) {
    const a = join(srcDir, rel)
    const b = join(dstDir, rel)
    let same = false
    try { same = (await digest(a)) === (await digest(b)) } catch {}
    if (same) continue
    changed += 1
    if (check) { console.log('DIFF ' + pkg + '/' + rel); continue }
    await cp(a, b, { force: true })
    console.log('SYNC ' + pkg + '/' + rel)
  }
}
console.log((check ? 'CHECK ' : 'SYNC ') + changed + ' file(s)')
if (check && changed > 0) process.exitCode = 1
