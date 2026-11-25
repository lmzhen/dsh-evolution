#!/usr/bin/env node
/**
 * DCR-85 head drill (build line only): the head is the sole commit point.
 *
 * Proves: bootstrap/mutate publish a schema-shaped head; removing the head
 * while commits exist fails closed instead of reading an empty store; a
 * corrupt head is rejected rather than silently rebuilt.
 *
 * Run after build-lib:
 *   node packages/evolution/evolution-core/scripts/verify-store-head.mjs
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const lib = pathToFileURL(join(here, '..', 'lib', 'index.js')).href
const { HomeFence, StoreKernel, nodeEvolutionIo } = await import(lib)
const home = await mkdtemp(join(tmpdir(), 'dsh-store-head-'))
const headPath = join(home, 'store-v2', 'head.json')

const assert = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const io = nodeEvolutionIo()
  const fence = new HomeFence({ home })
  const kernel = new StoreKernel({ io, home, fence })
  const first = await kernel.bootstrap({ state: { version: 1 } })
  const head = JSON.parse(await readFile(headPath, 'utf8'))
  assert(head.schemaVersion === 1, 'head.schemaVersion')
  assert(head.commitId === first.commitId, 'head.commitId matches bootstrap')
  assert(/^[0-9a-f]{64}$/.test(head.commitId), 'head.commitId is a sha256')
  assert(/^[0-9a-f]{64}$/.test(head.commitSha256), 'head.commitSha256 is a sha256')
  assert(typeof head.updatedAt === 'string', 'head.updatedAt')

  const second = await kernel.mutate({ domains: ['state'], source: 'command', change: () => ({ state: { version: 2 } }) })
  const nextHead = JSON.parse(await readFile(headPath, 'utf8'))
  assert(nextHead.commitId === second.commitId && nextHead.commitId !== first.commitId, 'mutate advances the head')

  await rm(headPath, { force: true })
  let missingHeadFailed = false
  try { await kernel.query(['state']) } catch { missingHeadFailed = true }
  assert(missingHeadFailed, 'missing head with commits must fail closed')

  await writeFile(headPath, '{not json\n')
  let corruptHeadFailed = false
  try { await kernel.query(['state']) } catch { corruptHeadFailed = true }
  assert(corruptHeadFailed, 'corrupt head must be rejected')

  console.log('verify-store-head: OK — head schema, advance and fail-closed cases hold')
} finally {
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
