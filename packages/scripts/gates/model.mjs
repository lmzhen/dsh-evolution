#!/usr/bin/env node
/**
 * gates/model — the gate row schema, the ONE validation entry point, and the ONE projection.
 *
 * A row is data, not behavior: `gate(id, fields)` only names the id explicitly. Consumers are the
 * generators/verifiers (`gates/views.mjs` renders them), `run-gates.mjs` (selects and executes), and
 * `gen-check-taxonomy.mjs` (counts membership). Nothing derives a second profile/lane mapping.
 */

export const KINDS = ['script', 'toolchain', 'step', 'external']
export const TREES = ['mirror', 'overlay', 'machine-local']
/** Closed lane set, in display order (the manifest sorts lanes by this order). */
export const LANES = ['local', 'pre-tag', 'ci-setup', 'ci-static', 'ci-unit', 'ci-release', 'ci-windows', 'machine-local']
export const RUN_LANES = new Set(['local', 'pre-tag', 'ci-setup', 'ci-static', 'ci-unit', 'ci-release', 'ci-windows'])
export const RUNNABLE_KINDS = new Set(['script', 'toolchain'])

/** `gate(id, fields)` exists so every row names its id explicitly in the diff. */
export function gate(id, fields) {
  return { id, ...fields }
}

/** profiles derive from lanes; storing both would be the second source this refactor removes. */
export function profilesOf(entry) {
  if (entry.kind === 'step' || entry.kind === 'external') return []
  const profiles = []
  if (entry.lanes.includes('local')) profiles.push('local')
  if (entry.lanes.includes('pre-tag')) profiles.push('pre-tag')
  if (entry.lanes.some((lane) => lane.startsWith('ci-'))) profiles.push('ci')
  return profiles
}

// ---- the ONE projection (formerly lib-gate-projection.mjs) --------------------------------------
const profileOf = (row) => (Array.isArray(row.profiles) ? row.profiles : [])
export const runnableRows = (rows) => rows.filter((row) => RUNNABLE_KINDS.has(row.kind))
export const declaredPreTag = (rows) => rows.filter((row) => profileOf(row).includes('pre-tag'))
export const supersetPreTag = (rows) => rows.filter((row) => profileOf(row).includes('local') || profileOf(row).includes('ci'))
export const unknownProfiles = (rows) => rows
  .map((row) => ({ id: row.id, bad: profileOf(row).filter((profile) => !['local', 'pre-tag', 'ci'].includes(profile)) }))
  .filter((entry) => entry.bad.length > 0)

/**
 * Tokens are spawn arguments, not shell text: quotes would become pattern characters (Phase 0 #6).
 * A token carrying a shell expansion (`$NAME`/`${...}`) is data for an action step (A3 converts
 * those to `command`), not a spawn token, so the quote rule does not apply to it.
 */
function quotedToken(argv) {
  return argv.find((token) => !token.includes('$') && ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))))
}

/**
 * Validate a registry set. Returns problems (callers decide exit code); an empty array means every
 * consumer can trust the set. Cross-row edges (`needs`/`after`) are validated against the same set.
 */
export function validateRegistry(entries) {
  const problems = []
  if (!Array.isArray(entries) || entries.length === 0) return ['registry is empty - a gate registry with nothing in it is a silent gate']
  const ids = new Set()
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') { problems.push('registry row is not an object'); continue }
    const id = entry.id
    if (typeof id !== 'string' || !/^(gate-\d{2}|ci-only-\d{2}|[a-z][a-z0-9-]*)$/.test(id)) { problems.push('row id is missing or not a frozen id: ' + JSON.stringify(id)); continue }
    if (ids.has(id)) problems.push(id + ': duplicate id')
    ids.add(id)
    if (!KINDS.includes(entry.kind)) problems.push(id + ': unknown kind ' + JSON.stringify(entry.kind))
    if (!TREES.includes(entry.tree)) problems.push(id + ': unknown tree ' + JSON.stringify(entry.tree))
    if (typeof entry.title !== 'string' || entry.title.trim() === '') problems.push(id + ': no title (the human Command column)')
    if (!Array.isArray(entry.lanes) || entry.lanes.length === 0) { problems.push(id + ': no lanes'); continue }
    for (const lane of entry.lanes) if (!LANES.includes(lane)) problems.push(id + ': unknown lane ' + JSON.stringify(lane))
    if (entry.tree === 'machine-local' && !(entry.lanes.length === 1 && entry.lanes[0] === 'machine-local')) problems.push(id + ': machine-local row must carry exactly ["machine-local"]')
    if (entry.tree !== 'machine-local' && entry.lanes.includes('machine-local')) problems.push(id + ': non-machine-local row carries machine-local')
    const runnable = RUNNABLE_KINDS.has(entry.kind)
    if (runnable && !entry.lanes.some((lane) => RUN_LANES.has(lane))) problems.push(id + ': runnable row has no runnable lane')
    if (runnable) {
      // A row that claims to be a check must name its command. The old prose-cell registrations are
      // retired: a check without an executable form is documentation, not a gate (W11 A1b).
      if (!Array.isArray(entry.argv) || entry.argv.length === 0) problems.push(id + ': runnable row needs argv (a check without an executable form is not a gate)')
      else if (entry.argv.some((token) => typeof token !== 'string')) problems.push(id + ': argv must be a string array')
      else if (!/^node$/.test(entry.argv[0])) problems.push(id + ': argv does not start with node: ' + JSON.stringify(entry.argv[0]))
      else if (quotedToken(entry.argv) !== undefined) problems.push(id + ': argv token carries shell quotes: ' + JSON.stringify(quotedToken(entry.argv)) + ' (tokens are spawn arguments)')
      if (entry.argv !== undefined && entry.command !== undefined) problems.push(id + ': a runnable row carries both argv and command')
    }
    if (entry.kind === 'step') {
      if (typeof entry.command !== 'string' || entry.command.trim() === '') problems.push(id + ': step row needs command (executed by its lane/action, not by run-gates)')
      if (entry.argv !== undefined && entry.argv !== null) problems.push(id + ': step row carries argv (steps are command text, not spawn argv)')
    }
    if (entry.kind === 'external') {
      // External rows document a command the family does not execute (another tool owns it). argv may
      // be present as documentation; it is never spawned, so it does not participate in dedupe.
      if (entry.command !== undefined) problems.push(id + ': external row carries command')
      if (entry.reason === undefined && entry.registration === undefined) problems.push(id + ': external row carries neither reason nor registration')
    }
    if (!runnable && entry.kind !== 'step' && entry.kind !== 'external' && entry.argv !== undefined && entry.argv !== null) problems.push(id + ': argv is only meaningful on runnable rows')
    if (entry.command !== undefined && runnable) problems.push(id + ': command belongs to step rows, not runnable rows')
    if (entry.argv === null) problems.push(id + ': argv must be omitted rather than null (omit it for step/external rows)')
    if (entry.timeoutMs !== undefined && (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0)) problems.push(id + ': timeoutMs must be a positive integer')
    for (const field of ['needs', 'after']) {
      const value = entry[field]
      if (value === undefined) continue
      if (!Array.isArray(value) || value.some((dep) => typeof dep !== 'string' || dep.trim() === '')) problems.push(id + ': ' + field + ' must be a string id array')
      else if (value.includes(id)) problems.push(id + ': ' + field + ' names itself')
    }
    if (entry.registration !== undefined) {
      const registration = entry.registration
      if (registration === null || typeof registration !== 'object' || typeof registration.reason !== 'string' || registration.reason.trim() === '') problems.push(id + ': registration needs a reason')
      if (registration !== null && typeof registration === 'object' && registration.expiry !== undefined && typeof registration.owner !== 'string') problems.push(id + ': registration with expiry needs an owner')
    }
    // CI override layer (W10 §16.8.2): several rows are authored in table/local form and need
    // different argv/env/cwd on a runner (machine paths, $RUNNER_TEMP homes, the probe baseline).
    if (entry.ci !== undefined) {
      const ci = entry.ci
      if (ci === null || typeof ci !== 'object' || Array.isArray(ci)) problems.push(id + ': ci override must be an object')
      else {
        if (ci.argv !== undefined && (!Array.isArray(ci.argv) || ci.argv.length === 0 || ci.argv[0] !== 'node' || ci.argv.some((token) => typeof token !== 'string'))) problems.push(id + ': ci.argv must be a non-empty node command (string[])')
        if (ci.argv !== undefined && quotedToken(ci.argv) !== undefined) problems.push(id + ': ci.argv token carries shell quotes: ' + JSON.stringify(quotedToken(ci.argv)))
        if (ci.env !== undefined && (ci.env === null || typeof ci.env !== 'object' || Object.values(ci.env).some((value) => typeof value !== 'string'))) problems.push(id + ': ci.env must be a string map')
        if (ci.cwd !== undefined && typeof ci.cwd !== 'string') problems.push(id + ': ci.cwd must be a string')
        if (ci.timeoutMs !== undefined && (!Number.isInteger(ci.timeoutMs) || ci.timeoutMs <= 0)) problems.push(id + ': ci.timeoutMs must be a positive integer')
        if (ci.argv === undefined && ci.env === undefined && ci.cwd === undefined && ci.timeoutMs === undefined) problems.push(id + ': ci override carries none of argv/env/cwd/timeoutMs')
      }
    }
  }
  for (const entry of entries) {
    for (const field of ['needs', 'after']) {
      for (const dep of Array.isArray(entry[field]) ? entry[field] : []) {
        if (!ids.has(dep)) problems.push(entry.id + ': ' + field + ' names unknown gate ' + JSON.stringify(dep))
      }
    }
  }
  for (const group of duplicateCommands(entries)) {
    problems.push(group.ids.join(' / ') + ': duplicate executable command (' + group.command.slice(0, 120) + ') — one check must have one row')
  }
  return problems
}

/**
 * Duplicate diagnostic (A1b enforces it): two rows that execute the same command are one check
 * declared twice. Normalised on the rendered command, ignoring the tree (the path layout differs).
 */
export function duplicateCommands(entries) {
  const groups = new Map()
  for (const entry of entries) {
    if (entry.kind === 'external') continue
    const command = Array.isArray(entry.argv) ? entry.argv.join(' ') : typeof entry.command === 'string' ? entry.command : null
    if (command === null) continue
    const key = command.replace(/`/g, '').replace(/\s+/g, ' ').trim()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry.id)
  }
  return [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([command, ids]) => ({ command, ids }))
}
