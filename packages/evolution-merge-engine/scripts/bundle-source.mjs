#!/usr/bin/env node
// Rebuild the checked-in engine bundle from src/index.js. The published lib is
// generated from this bundle, so this step is required after editing engine.js.
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const repoRoot = resolve(root, '..', '..', '..')
const esbuild = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild')
const result = spawnSync(esbuild, [
  join(root, 'src', 'index.js'),
  '--bundle', '--format=esm', '--platform=node', '--target=node20',
  '--external:onnxruntime-node',
  '--outfile=' + join(root, 'src', 'index.bundle.js'),
], { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
