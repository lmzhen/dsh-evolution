#!/usr/bin/env node
/**
 * Build the evolution package family without the monorepo-wide tsdown run.
 *
 * The root tsdown config treats the private @deepseek-ai/dsh-root workspace
 * package as a build target and fails on its missing entry points. This
 * script builds only the evolution-family packages, resolving the local
 * package tree from this script's own layout:
 *   node packages/scripts/build-lib.mjs
 *
 * R-02: this script is only runnable where the project references resolve —
 * the upstream OVERLAY / dev tree (mirror packages merged into an upstream
 * checkout, or an upstream dev checkout). The flat public mirror is the
 * publish carrier only: its tsconfigs reference ../../../vendor/cordis paths
 * that do not exist in the flat layout, so running this script there fails
 * with ENOENT by design (see README G5.5).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const evolutionRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = resolve(evolutionRoot, '../..')
const tsc = join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js')
const tsdown = join(repoRoot, 'node_modules', 'tsdown', 'dist', 'run.mjs')
const config = join(evolutionRoot, 'tsdown.package.config.ts')

const packages = readdirSync(evolutionRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(evolutionRoot, entry.name, 'package.json')))
  .map(entry => entry.name)
  .sort()

function run(command, args, cwd) {
  const result = spawnSync(process.execPath, [command, ...args], { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const projects = packages.map(name => join(evolutionRoot, name, 'tsconfig.json'))
run(tsc, ['-b', ...projects, '--force'], repoRoot)
for (const name of packages) {
  console.log(`build: ${name}`)
  run(tsdown, ['--config', config], join(evolutionRoot, name))
}
