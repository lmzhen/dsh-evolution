#!/usr/bin/env node
/**
 * verify-store-kernel — the MVCC store's two non-negotiable properties.
 *
 * 1. READ PATH: the query block must not mention a writer primitive. The
 *    architectural claim is that query never takes HomeFence/withFileLock or
 *    the legacy state.lock; a future refactor that adds one is a regression.
 * 2. WRITE PATH: only the one fence is used, and the mutable head is published
 *    through the IO seam's atomic write; no node:fs call may bypass it.
 * 3. INVENTORY: the head/commit/object paths are declared in the persisted
 *    write inventory so a writer cannot appear outside the audited table.
 *
 * Usage: node packages/scripts/verify-store-kernel.mjs <packages-root>
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'packages')
const kernelPath = join(root, 'evolution-core/src/store/store-kernel.ts')
const inventoryPath = join(root, 'evolution-core/persisted-write-inventory.json')
const problems = []

if (!existsSync(kernelPath)) problems.push('missing ' + kernelPath)
if (!existsSync(inventoryPath)) problems.push('missing ' + inventoryPath)

if (problems.length === 0) {
  const source = readFileSync(kernelPath, 'utf8')
  const queryStart = source.indexOf('async query(')
  const mutateComment = source.indexOf('/**\n   * Publish one commit', queryStart)
  if (queryStart < 0 || mutateComment < 0 || mutateComment <= queryStart) {
    problems.push('cannot isolate the query method body')
  } else {
    const query = source.slice(queryStart, mutateComment)
    for (const token of ['fence.run', 'withFileLock', 'state.lock', 'HomeFence', 'this.fence']) {
      if (query.includes(token)) problems.push(`query body mentions ${token} (read path must be lock-free)`)
    }
  }
  if (/from ['"]node:fs/.test(source)) problems.push('store kernel imports node:fs directly; use the EvolutionIoLike seam')
  if (!source.includes('this.fence.run(')) problems.push('no writer fence call found; writes must serialize on HomeFence')
  if (!source.includes('createTextIfAbsent') || !source.includes('this.io.writeText(')) {
    problems.push('head/object writes must use the IO seam createTextIfAbsent/writeText')
  }
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  for (const id of ['store-v2-head', 'store-v2-commits', 'store-v2-objects']) {
    if (!Array.isArray(inventory.sites) || !inventory.sites.some(site => site?.id === id)) {
      problems.push('persisted-write-inventory has no site "' + id + '"')
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('verify-store-kernel: ' + problem)
  process.exit(1)
}
console.log('verify-store-kernel: OK — query is lock-free, writes use one HomeFence and the IO seam, MVCC paths are inventoried')
