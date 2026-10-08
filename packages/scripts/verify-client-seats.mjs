#!/usr/bin/env node
/**
 * Client-seat guard (G2): a browser half must be able to ACTIVATE, and every row with a
 * user layer must be reachable from the page that edits it.
 *
 * Three ways a client row dies, all silent on the platform (a required cordis inject has
 * no timeout: the row stays PENDING forever and its UI simply never appears):
 *
 *   A. the inject names a service no plugin provides any more (`settingsScope` was removed
 *      in 0.1.7-alpha.1 and replaced by `configForms`);
 *   B. the inject keeps a name the bundle no longer READS — the leftover of a seam change,
 *      which is the same pending-forever failure with a dead constant as its cause;
 *   C. the row has E3 fields but no seat in the generated client view, or no bundle that
 *      mounts it advertises the row's configuration page key.
 *
 * A and C are checked against the tree; B needs no platform. The platform half reads the
 * service declarations of the target line (`super(ctx, '<name>')` / `.provide('<name>')`),
 * so pass `--upstream <platform-root>`: without it half A reports as unchecked instead of
 * passing silently.
 *
 * Usage: node verify-client-seats.mjs <evolution-root> [--upstream <platform-root>] [--strict]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const rootArg = argv.find(arg => !arg.startsWith('--'))
const root = resolve(rootArg ?? 'packages')
const upstreamArg = argv.indexOf('--upstream')
const upstream = upstreamArg < 0 ? undefined : resolve(argv[upstreamArg + 1] ?? '')
const strict = argv.includes('--strict')
const unknown = argv.filter(arg => arg.startsWith('--') && arg !== '--strict' && arg !== '--upstream')
if (unknown.length > 0) {
  console.error('verify-client-seats: unknown flag ' + unknown.join(', ') + ' — usage: node verify-client-seats.mjs <evolution-root> [--upstream <platform-root>] [--strict]')
  process.exit(2)
}

const problems = []
const notes = []

/** Read one JSON file, or undefined when it is missing or unparsable. */
function json(path) {
  if (!existsSync(path)) return undefined
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}

/** The family packages, by directory name. */
const packages = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .flatMap(entry => {
    const manifest = json(join(root, entry.name, 'package.json'))
    return manifest === undefined ? [] : [{ dir: entry.name, manifest }]
  })

/** The service names the platform line provides, from its own declarations. */
function providedServices(platformRoot) {
  const names = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'tests') continue
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      const text = readFileSync(full, 'utf8')
      for (const match of text.matchAll(/super\(ctx, '([A-Za-z][A-Za-z0-9.]*)'\)/g)) names.add(match[1])
      for (const match of text.matchAll(/\.provide\('([A-Za-z][A-Za-z0-9.]*)'/g)) names.add(match[1])
      for (const match of text.matchAll(/ctx\.provide\('([A-Za-z][A-Za-z0-9.]*)'/g)) names.add(match[1])
    }
  }
  const clientRoot = join(platformRoot, 'packages', 'client')
  if (existsSync(clientRoot)) walk(clientRoot)
  return names
}

const provided = upstream === undefined ? undefined : providedServices(upstream)
const CLIENT_INJECT = /export const inject(?::\s*string\[\])?\s*=\s*\[([^\]]*)\]/

// A/B. Every client half's required services are provided, and every one of them is read.
for (const pkg of packages) {
  const client = pkg.manifest.dsh?.client
  if (client === undefined) continue
  const entry = join(root, pkg.dir, 'src', 'client', 'index.ts')
  if (!existsSync(entry)) {
    problems.push(pkg.dir + ': declares dsh.client but has no src/client/index.ts')
    continue
  }
  const text = readFileSync(entry, 'utf8')
  const declared = CLIENT_INJECT.exec(text)
  if (declared === null) {
    problems.push(pkg.dir + ': the client entry declares no `export const inject` — the row would activate before its services exist')
    continue
  }
  const names = declared[1].split(',').map(part => part.trim().replace(/^'|'$/g, '')).filter(Boolean)
  if (names.length === 0) {
    notes.push(pkg.dir + ': inject is empty (no client service required)')
    continue
  }
  const source = readdirSync(join(root, pkg.dir, 'src'), { recursive: true })
    .map(rel => String(rel))
    .filter(rel => rel.endsWith('.ts') || rel.endsWith('.tsx'))
    .map(rel => join(root, pkg.dir, 'src', rel))
    .filter(path => path !== entry)
    .map(path => readFileSync(path, 'utf8'))
    .join('\n')
  for (const name of names) {
    if (provided !== undefined && !provided.has(name)) {
      problems.push(pkg.dir + ': inject requires "' + name + '", which no client service of the platform line provides — the row stays PENDING forever and its whole browser half never mounts')
    }
    const read = new RegExp('[.\\s(\\[{,]' + name.replace('.', '\\.') + '\\b').test(source)
    if (!read) {
      problems.push(pkg.dir + ': inject requires "' + name + '" but no client source reads it — a leftover requirement keeps the row PENDING for a service nobody uses')
    }
  }
  notes.push(pkg.dir + ': inject [' + names.join(', ') + ']')
}

// D. The informational package edges name client packages of the target line.
if (upstream !== undefined) {
  const platformClientNames = new Set()
  const clientRoot = join(upstream, 'packages', 'client')
  if (existsSync(clientRoot)) {
    for (const entry of readdirSync(clientRoot, { withFileTypes: true })) {
      const inner = join(clientRoot, entry.name)
      if (!entry.isDirectory()) continue
      for (const candidate of [inner, ...readdirSync(inner, { withFileTypes: true }).filter(child => child.isDirectory()).map(child => join(inner, child.name))]) {
        const manifest = json(join(candidate, 'package.json'))
        if (manifest?.name !== undefined) platformClientNames.add(manifest.name)
      }
    }
  }
  for (const pkg of packages) {
    for (const edge of pkg.manifest.dsh?.client?.inject ?? []) {
      if (!platformClientNames.has(edge)) {
        problems.push(pkg.dir + ': dsh.client.inject names "' + edge + '", which is not a client package of the platform line — the preflight and HMR diff show a dependency that no longer exists')
      }
    }
  }
  notes.push('platform client packages seen: ' + platformClientNames.size)
} else {
  notes.push('no --upstream: inject satisfiability and package edges are UNCHECKED')
}

// C. Every row with a user layer has a card and a page seat.
const registry = readFileSync(join(root, 'evolution-core', 'src', 'params.ts'), 'utf8')
// Only E3 rows of an owner that has a settings namespace reach a card: the generator keys
// the view by exactly that pair (tier E3 + PARAM_NAMESPACES entry), so an E2-only owner is
// deployment-configured and has nothing to edit here.
const namespaceBlock = /export const PARAM_NAMESPACES[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\)/.exec(registry)
const namespaceOwners = new Set([...(namespaceBlock?.[1] ?? '').matchAll(/^\s*'([^']+)':/gm)].map(match => match[1]))
const owners = new Set([...registry.matchAll(/^\s*\{ id: '[^']+',[^\n]*tier: 'E3'[^\n]*owner: '([^']+)'/gm)]
  .map(match => match[1])
  .filter(owner => namespaceOwners.has(owner)))
const generated = join(root, 'evolution-settings-ui', 'src', 'client', 'generated-params.ts')
if (!existsSync(generated)) {
  problems.push('evolution-settings-ui: no generated client view (run gen-param-client-view.mjs)')
} else {
  const view = readFileSync(generated, 'utf8')
  const cards = new Set([...view.matchAll(/namespace: '([^']+)'/g)].map(match => match[1]))
  const seats = new Set([...view.matchAll(/^\s*\{ bundle: '[^']+', rows: \[([^\]]*)\]/gm)].flatMap(match =>
    match[1].split(',').map(part => part.trim().replace(/^'|'$/g, '')).filter(Boolean)))
  for (const owner of owners) {
    if (!cards.has(owner)) problems.push(owner + ': has registry rows but no card in the generated client view — the operator can never edit it')
  }
  for (const row of seats) {
    if (!owners.has(row)) problems.push('client view: seat row "' + row + '" is not an owner the registry carries')
  }
  const patchOwners = new Set(packages.filter(pkg => pkg.manifest.dsh?.bundle?.patch !== undefined).map(pkg => pkg.manifest.name))
  for (const match of view.matchAll(/\{ bundle: '([^']+)'/g)) {
    if (!patchOwners.has(match[1])) problems.push('client view: seat bundle "' + match[1] + '" is not a family bundle package')
  }
  notes.push(owners.size + ' registered row(s), ' + cards.size + ' card(s), ' + seats.size + ' seat row(s)')
}

const summary = packages.length + ' package(s), ' + notes.join(', ')
if (problems.length === 0) {
  console.log('verify-client-seats: OK — ' + summary)
  process.exit(0)
}
const level = strict ? 'FAIL' : 'WARN'
console.error('verify-client-seats: ' + level + ' — ' + problems.length + ' problem(s):')
for (const problem of problems) console.error('  - ' + problem)
console.error('verify-client-seats: a required client service is not optional — fix the inject or provide the service; never leave a name the bundle does not read')
process.exit(strict ? 1 : 0)
