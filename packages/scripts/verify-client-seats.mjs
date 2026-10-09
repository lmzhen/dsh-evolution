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

// E. An occupant of a seat whose caller passes a VALUE must draw at that value.
//
// The platform hands every `sidebar.panellist` occupant `{ size, active }` (ui-sidebar renders
// `renderSlot('sidebar.panellist', { size: wide ? 16 : 18, active }, { only: id })`) and its own
// occupants pass that `size` straight to their primitive, because the row it sits in owns the glyph
// slot, its inset and the gap to the label. A family row that draws at a box of ITS OWN still renders
// — it just moves its label out of the column (measured in the desktop's global panel list on
// 2026-10-09: 56px against the platform rows' 46px), so nothing fails except a pixel comparison a
// human has to make. The seat list is generated from the platform line rather than recorded here, so
// a seat that gains a size prop is covered without editing this guard.

/** Escape one string for use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The text of one call, from its `(` to its matching `)`. */
function callText(text, openIndex) {
  let depth = 0
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return text.slice(openIndex, index + 1)
    }
  }
  return text.slice(openIndex)
}

/**
 * The index of the bracket that closes the one at `openIndex`.
 * @param text - the file's source.
 * @param openIndex - index of a `(`, `{` or `[`.
 * @returns the closing index, or -1 when the text ends first.
 */
function closeIndex(text, openIndex) {
  const open = text[openIndex]
  const close = open === '(' ? ')' : open === '{' ? '}' : ']'
  let depth = 0
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === open) depth += 1
    else if (text[index] === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * The last top-level argument of a call's argument list.
 * @param args - the argument list, without its parentheses.
 * @returns the argument, or an empty string when the list is empty.
 */
function lastArgument(args) {
  // The family's registrations carry a trailing comma before the closing parenthesis, so the comma
  // that precedes the LAST argument is not the trailing one.
  const list = args.trim().replace(/,$/, '').trim()
  let depth = 0
  let start = 0
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index]
    if (char === '(' || char === '{' || char === '[') depth += 1
    else if (char === ')' || char === '}' || char === ']') depth -= 1
    else if (char === ',' && depth === 0) start = index + 1
  }
  return list.slice(start).trim()
}

/**
 * The seats whose `renderSlot` call passes a `size`, read from the platform line.
 * @param platformRoot - the platform tree.
 * @returns the seat names, or an empty set when no platform client tree is reachable.
 */
function parameterizedSeats(platformRoot) {
  const seats = new Set()
  const clientRoot = join(platformRoot, 'packages', 'client')
  if (!existsSync(clientRoot)) return seats
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
      for (const match of text.matchAll(/renderSlot\(\s*'([^']+)'/g)) {
        const open = text.indexOf('(', match.index)
        if (open < 0) continue
        if (/\bsize\s*:/.test(callText(text, open))) seats.add(match[1])
      }
    }
  }
  walk(clientRoot)
  return seats
}

/** A drawn edge whose value must come from the seat's size prop. */
const DRAWN_EDGE_RE = /(['"]?)(width|height)\1\s*[:=]\s*\{?\s*([^,}\n]+)/g

/**
 * Whether one occupant reads the seat's `size` and draws at it.
 * @param body - the occupant component's source.
 * @returns the problems, each naming the edge that did not come from the prop.
 */
function occupantProblems(body) {
  if (!/\bsize\b/.test(body)) return ["does not read the seat's size prop"]
  const problems = []
  for (const edge of body.matchAll(DRAWN_EDGE_RE)) {
    const value = (edge[3] ?? '').trim()
    if (!/size/.test(value)) problems.push(edge[2] + ' does not come from size: ' + value)
  }
  return problems
}

/**
 * The source of one component declared in a file.
 * @param text - the file's source.
 * @param name - the component's name.
 * @returns the declaration and its body, or undefined when the file does not declare it.
 */
function componentBody(text, name) {
  const declared = new RegExp('(?:function\\s+' + name + '\\s*\\(|(?:const|let)\\s+' + name + '\\s*=)').exec(text)
  if (declared === null) return undefined
  // Skip the PARAMETER LIST first: its props type literal carries the first braces of the declaration
  // (`props: { size?: number }`), so stopping at the first one would judge the type instead of the body —
  // a rule that matches nothing reports a pass.
  const parameters = text.indexOf('(', declared.index)
  const after = parameters < 0 ? declared.index : closeIndex(text, parameters) + 1
  const brace = text.indexOf('{', after)
  if (brace < 0) return undefined
  let depth = 0
  for (let index = brace; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(declared.index, index + 1)
    }
  }
  return text.slice(declared.index)
}

{
  // The detector must bite before the tree is judged: a rule that matches nothing reports a pass.
  const incident = "function Icon(props: { size?: number; active?: boolean } = {}): unknown {\n  return createElement('svg', { width: String(GLYPH_BOX), height: String(GLYPH_BOX) })\n}"
  const fixed = "function Icon(props: { size?: number; active?: boolean } = {}): unknown {\n  return createElement('svg', { width: String(size), height: String(size) })\n}"
  // The extraction is half the rule: the props type literal carries braces of its own, and stopping at
  // the first one judged the TYPE instead of the body — a rule that matches nothing reports a pass.
  const extractedIncident = componentBody(incident, 'Icon')
  const regression = occupantProblems(extractedIncident ?? '')
  const clean = occupantProblems(componentBody(fixed, 'Icon') ?? '')
  const ignoring = occupantProblems('function Icon(): unknown {\n  return createElement(\'span\')\n}')
  const sizeCall = callText("renderSlot('x', { size: wide ? 16 : 18 }, { only: id })", 10)
  const plainCall = callText("renderSlot('x', { active }, { only: id })", 10)
  if (regression.length !== 2 || clean.length !== 0 || ignoring.length !== 1 || !/createElement/.test(extractedIncident ?? '') || !/\bsize\s*:/.test(sizeCall) || /\bsize\s*:/.test(plainCall)) {
    console.error('verify-client-seats: self-check failed — the geometry detector lost its edge cases (box-of-its-own=' + regression.length + ', size-prop=' + clean.length + ', no-prop-read=' + ignoring.length + ')')
    process.exit(1)
  }
}

if (upstream !== undefined) {
  const seats = parameterizedSeats(upstream)
  let checked = 0
  for (const pkg of packages) {
    const clientDir = join(root, pkg.dir, 'src', 'client')
    if (!existsSync(clientDir)) continue
    for (const rel of readdirSync(clientDir, { recursive: true }).map(String).filter(name => /\.tsx?$/.test(name))) {
      const full = join(clientDir, rel)
      const text = readFileSync(full, 'utf8')
      for (const seat of seats) {
        const registration = new RegExp("name:\\s*'" + escapeRegExp(seat) + "'")
        if (!registration.test(text)) continue
        const at = text.search(registration)
        // A `name: '<seat>'` with no `slots.register(` before it is a type declaration (the family's seam
        // spells the seat's metadata on its own interface), not a contribution: nothing to judge.
        const open = text.lastIndexOf('register(', at)
        if (open < 0) continue
        const args = callText(text, open + 'register'.length)
        const occupant = lastArgument(args.slice(1, -1))
        const body = componentBody(text, occupant)
        if (body === undefined) {
          notes.push(pkg.dir + '/' + String(rel) + ': occupant of ' + seat + ' (' + occupant + ') is not a function declaration in this file — geometry unchecked, declare the icon as a named function')
          continue
        }
        checked += 1
        // NOT `problems`: that is this guard's own violation list, and pushing into a local of the same
        // name appends to the array being iterated (the loop then never ends).
        const found = occupantProblems(body)
        for (const problem of found) {
          problems.push(pkg.dir + '/' + String(rel) + ': occupant of ' + seat + ' (' + occupant + ') ' + problem + ' — draw at the size the seat passes (the row owns the glyph slot, its inset and the gap)')
        }
      }
    }
  }
  notes.push(seats.size + ' parameterized seat(s) on the platform line, ' + checked + ' occupant(s) judged')
} else {
  notes.push('no --upstream: parameterized-seat geometry is UNCHECKED')
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
