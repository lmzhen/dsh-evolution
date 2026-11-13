#!/usr/bin/env node
/**
 * Gate registry primitives and the ONE validation entry point (W10 M3).
 *
 * A registry row is data, not behavior: `gate(id, fields)` only names the id explicitly, and
 * `validateRegistry` refuses a set that cannot be generated into the views. Keeping validation
 * here (not in the generator) means the verifier and any future consumer judge the same rules.
 */

export const KINDS = ['script', 'toolchain', 'step', 'external']
export const TREES = ['mirror', 'overlay', 'machine-local']
/** Closed lane set, in display order (the manifest sorts lanes by this order). */
export const LANES = ['local', 'pre-tag', 'ci-setup', 'ci-static', 'ci-unit', 'ci-release', 'ci-windows', 'machine-local']
export const RUN_LANES = new Set(['local', 'pre-tag', 'ci-setup', 'ci-static', 'ci-unit', 'ci-release', 'ci-windows'])

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

/**
 * Validate a registry set. Returns problems (callers decide exit code); an empty array means every
 * consumer (generator, verifier) can trust the set.
 */
export function validateRegistry(entries) {
  const problems = []
  if (!Array.isArray(entries) || entries.length === 0) return ['registry is empty - a gate registry with nothing in it is a silent gate']
  const seen = new Set()
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') { problems.push('registry row is not an object'); continue }
    const id = entry.id
    if (typeof id !== 'string' || !/^(gate-\d{2}|ci-only-\d{2}|[a-z][a-z0-9-]*)$/.test(id)) { problems.push('row id is missing or not a frozen id: ' + JSON.stringify(id)); continue }
    if (seen.has(id)) problems.push(id + ': duplicate id')
    seen.add(id)
    if (!KINDS.includes(entry.kind)) problems.push(id + ': unknown kind ' + JSON.stringify(entry.kind))
    if (!TREES.includes(entry.tree)) problems.push(id + ': unknown tree ' + JSON.stringify(entry.tree))
    if (typeof entry.title !== 'string' || entry.title.trim() === '') problems.push(id + ': no title (the human Command column)')
    if (!Array.isArray(entry.lanes) || entry.lanes.length === 0) { problems.push(id + ': no lanes'); continue }
    for (const lane of entry.lanes) if (!LANES.includes(lane)) problems.push(id + ': unknown lane ' + JSON.stringify(lane))
    if (entry.tree === 'machine-local' && !(entry.lanes.length === 1 && entry.lanes[0] === 'machine-local')) problems.push(id + ': machine-local row must carry exactly ["machine-local"]')
    if (entry.tree !== 'machine-local' && entry.lanes.includes('machine-local')) problems.push(id + ': non-machine-local row carries machine-local')
    const runnable = entry.kind === 'script' || entry.kind === 'toolchain'
    if (runnable && !entry.lanes.some((lane) => RUN_LANES.has(lane))) problems.push(id + ': runnable row has no runnable lane')
    if (entry.argv !== null && entry.argv !== undefined) {
      if (!Array.isArray(entry.argv) || entry.argv.length === 0 || entry.argv.some((token) => typeof token !== 'string')) problems.push(id + ': argv must be a non-empty string array or null')
      else if (!/^node$/.test(entry.argv[0])) problems.push(id + ': argv does not start with node: ' + JSON.stringify(entry.argv[0]))
    } else if (entry.argvProblem === undefined) problems.push(id + ': argv is null without an argvProblem (a row must say why it has no executable form)')
    if (entry.argv === null && entry.registration === undefined) problems.push(id + ': argv-null row carries no registration (cannot-decide debt must be owned)')
    if (entry.registration !== undefined) {
      const registration = entry.registration
      if (registration === null || typeof registration !== 'object' || typeof registration.reason !== 'string' || registration.reason.trim() === '') problems.push(id + ': registration needs a reason')
      if (registration !== null && typeof registration === 'object' && registration.expiry !== undefined && typeof registration.owner !== 'string') problems.push(id + ': registration with expiry needs an owner')
    }
    if (entry.kind === 'external' && entry.reason === undefined && entry.registration === undefined) problems.push(id + ': external row carries neither reason nor registration')
  }
  return problems
}
