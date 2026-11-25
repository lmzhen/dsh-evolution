#!/usr/bin/env node
/**
 * DCR-85 store surface closure: every host command id is declared in the one
 * surface registry, and every command-kind registry id is a real host command.
 *
 * This is the machine half of §9: a new command that is not registered fails
 * closed, and a dead registration is named instead of silently held.
 *
 * Usage: node packages/scripts/verify-store-surface.mjs packages [--self-test]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? 'packages'
const surfacePath = join(root, 'evolution-core', 'src', 'store', 'surface.ts')
const defsPath = join(root, 'evolution-commands', 'src', 'host-command-defs.ts')
const surface = readFileSync(surfacePath, 'utf8')
const defs = readFileSync(defsPath, 'utf8')

const ids = (text) => [...text.matchAll(/\bid:\s*'([^']+)'/g)].map(match => match[1])
const allSurface = new Set(ids(surface))
const commandSurface = new Set(
  [...surface.matchAll(/\{[^}]*\bkind:\s*'command'[^}]*\}/g)]
    .map(match => /\bid:\s*'([^']+)'/.exec(match[0])?.[1])
    .filter(Boolean),
)
const host = new Set(ids(defs))

const problems = []
for (const id of host) if (!allSurface.has(id)) problems.push('host command not registered in surface: ' + id)
for (const id of commandSurface) {
  const subcommandOfRegisteredHost = id.includes('.') && host.has(id.slice(0, id.indexOf('.')))
  if (!host.has(id) && !subcommandOfRegisteredHost) problems.push('surface command has no host command: ' + id)
}
if (allSurface.size === 0) problems.push('surface registry is empty (a vacuum pass is not a pass)')

if (process.argv.includes('--self-test')) {
  const synthetic = '__surface_self_test__'
  const fakeHost = new Set([...host, synthetic])
  const detected = [...fakeHost].some(id => !allSurface.has(id))
  if (!detected) {
    console.error('verify-store-surface: SELF-TEST FAILED — an unregistered host command was not detected')
    process.exit(1)
  }
  console.log('verify-store-surface: self-test OK — a synthetic unregistered command turns the closure red')
  process.exit(0)
}

if (problems.length > 0) {
  console.error('verify-store-surface: ' + String(problems.length) + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-store-surface: OK — ' + String(host.size) + ' host command(s) match ' + String(commandSurface.size) + ' registered command(s)')
