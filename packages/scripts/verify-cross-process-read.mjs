#!/usr/bin/env node
/**
 * Cross-process lock-free read drill (DCR-85 R8 evidence).
 *
 * The parent holds HomeFence while a child process opens the same home and
 * queries the MVCC store through the built core package. This proves readers do
 * not take the writer lock and see one commit.
 *
 * Usage (build line):
 *   EVOLUTION_OVERLAY_ROOT=D:\dsh\harness-rc3 node packages/scripts/verify-cross-process-read.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const overlay = resolve(process.env.EVOLUTION_OVERLAY_ROOT ?? process.cwd())
const lib = pathToFileURL(join(overlay, 'packages', 'evolution', 'evolution-core', 'lib', 'index.js')).href
const { HomeFence, StoreKernel, nodeEvolutionIo } = await import(lib)
const home = await mkdtemp(join(tmpdir(), 'dsh-cross-process-read-'))

function readInChild() {
  const script = [
    'import { StoreKernel, nodeEvolutionIo } from ' + JSON.stringify(lib) + ';',
    'const kernel = new StoreKernel({ io: nodeEvolutionIo(), home: process.argv[1] });',
    'const snapshot = await kernel.query(["state"]);',
    'process.stdout.write(JSON.stringify(snapshot.domains.state));',
  ].join('\n')
  return new Promise((resolveChild, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, home], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolveChild(stdout) : reject(new Error('child read failed: ' + stderr)))
  })
}

const io = nodeEvolutionIo()
const fence = new HomeFence({ home })
const kernel = new StoreKernel({ io, home, fence })
try {
  await kernel.bootstrap({ state: { version: 7 } })
  const seen = await fence.run(async () => await readInChild())
  const value = JSON.parse(seen)
  if (value.version !== 7) throw new Error('child saw an unexpected state: ' + seen)
  console.log('verify-cross-process-read: OK — child read version 7 while the parent held HomeFence')
} finally {
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
