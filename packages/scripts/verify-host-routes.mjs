#!/usr/bin/env node
/**
 * G4/W6 host-route guard: ONE path table, ONE carrier, no second admission path.
 *
 * Checks (static, so it runs in the mirror without a build):
 *   1. HOST_ROUTES is the only home of '/api/dsh-evolution/' literals (5 surfaces / 16 endpoints).
 *   2. Business sources carry no loopback fence / webServer registration and no hand-copied route paths.
 *   3. The three migrated host packages import HOST_ROUTES from core/http-routes.
 *   4. Generated client route constants (G5), when present, carry the GENERATED header and only paths
 *      that exist in HOST_ROUTES.
 * Exit 2 when the scan finds no sources (a silent guard is worse than a red one).
 *
 * Usage: node packages/scripts/verify-host-routes.mjs packages [--json]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const argv = process.argv.slice(2)
const root = resolve(argv.find((arg) => !arg.startsWith('--')) ?? 'packages')
const JSON_OUT = argv.includes('--json')
const problems = []
const seenPaths = []

const coreDir = join(root, 'evolution-core')
const coreRoutes = join(coreDir, 'src', 'http-routes.ts')
if (!existsSync(coreRoutes)) {
  console.error('verify-host-routes: core http-routes.ts not found under ' + root)
  process.exit(2)
}
const coreSource = readFileSync(coreRoutes, 'utf8')
const published = [...coreSource.matchAll(/'(\/api\/dsh-evolution\/[^']*)'/g)]
  .map((match) => match[1])
  // The registerHostRoutes prefix guard names the bare prefix; only endpoints carry a segment after it.
  .filter((path) => path !== '/api/dsh-evolution/')
for (const path of published) seenPaths.push(path)
if (published.length !== 16) problems.push('HOST_ROUTES carries ' + published.length + ' endpoint path(s), expected 16')
if (new Set(published).size !== published.length) problems.push('HOST_ROUTES declares a duplicate endpoint path')
for (const surface of ['approval', 'skillHistory', 'skillHealth', 'merge', 'diagnostics']) {
  if (!new RegExp('\\b' + surface + '\\s*:').test(coreSource)) problems.push('HOST_ROUTES is missing the "' + surface + '" surface')
}
const publishedSet = new Set(published)

const forbidden = [
  [/\bwebServer\b/, 'webServer registration/fence (the platform connection carrier is the only admission path)'],
  [/isLoopbackRequest|FenceRequest/, 'retired loopback fence helper'],
  [/\bwriteJson\b|\breadJsonBody\b/, 'retired node:http JSON helper'],
]

let scanned = 0
function walk(dir, rel) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist' || entry.name === 'tests') continue
    const full = join(dir, entry.name)
    const relPath = rel === '' ? entry.name : rel + '/' + entry.name
    if (entry.isDirectory()) { walk(full, relPath); continue }
    if (!/\.(?:ts|mts|mjs)$/.test(entry.name)) continue
    const relToRoot = relative(root, full).split(/[\\/]/).join('/')
    if (!relToRoot.includes('/src/')) continue
    // platform-services.ts is a capability-claim table: it NAMES webServer as a platform service, it
    // does not register a route on it.
    if (relToRoot === 'evolution-core/src/platform-services.ts') continue
    scanned += 1
    const isCoreTable = relToRoot === 'evolution-core/src/http-routes.ts'
    const isGenerated = /\/client\/[^/]*\.generated\.ts$/.test(relToRoot)
    const lines = readFileSync(full, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      for (const [pattern, rule] of forbidden) {
        if (pattern.test(line)) problems.push(relToRoot + ':' + (index + 1) + ' ' + rule)
      }
      for (const match of line.matchAll(/'(\/api\/dsh-evolution\/[^']*)'/g)) {
        if (!isCoreTable && !isGenerated) {
          problems.push(relToRoot + ':' + (index + 1) + ' hand-copied route path ' + match[1] + ' (import HOST_ROUTES)')
        } else if (isGenerated && !publishedSet.has(match[1])) {
          problems.push(relToRoot + ':' + (index + 1) + ' generated client path ' + match[1] + ' is not in HOST_ROUTES')
        }
      }
    })
    if (isGenerated && !/GENERATED/.test(lines[0] ?? '')) problems.push(relToRoot + ': generated client constant lacks the GENERATED header')
  }
}
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('evolution-')) continue
  walk(join(root, entry.name), entry.name)
}
if (scanned === 0) problems.push('scanned 0 business sources under ' + root + ' — the guard would be silent')

for (const pkg of ['evolution-approval', 'evolution-skill-history', 'evolution-skill-health']) {
  const routesFile = join(root, pkg, 'src', 'routes.ts')
  if (!existsSync(routesFile)) { problems.push(pkg + ': routes.ts is missing'); continue }
  const source = readFileSync(routesFile, 'utf8')
  if (!/from '@deepseek-ai\/dsh-evolution-core\/http-routes'/.test(source) || !/HOST_ROUTES/.test(source)) {
    problems.push(pkg + ': routes.ts must import HOST_ROUTES from core/http-routes')
  }
}

if (problems.length > 0) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, scanned, endpoints: published.length, problems }, null, 2))
  else {
    console.error('verify-host-routes: ' + problems.length + ' problem(s):')
    for (const problem of problems) console.error('  - ' + problem)
  }
  process.exit(1)
}
if (JSON_OUT) console.log(JSON.stringify({ ok: true, scanned, endpoints: published.length }, null, 2))
else console.log('verify-host-routes: OK — ' + scanned + ' business source(s), HOST_ROUTES ' + published.length + ' endpoints, no fence/webServer/hand-copied paths')
