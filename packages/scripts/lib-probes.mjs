/**
 * G7-S1: the probe registry reader. probes.json is the ONE hand-authored source;
 * gen-gate-manifest merges it into gate-manifest.probes (the runtime registry consumers read).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const PROBE_KINDS = Object.freeze(['decl', 'beh'])
export const PROBE_EVIDENCE = Object.freeze(['A', 'B'])

export function probesPath(root) { return join(root, 'scripts', 'probes.json') }

export function readProbes(root) {
  const file = probesPath(root)
  if (!existsSync(file)) throw new Error('probe registry: missing ' + file)
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed.probes) || parsed.probes.length === 0) {
    throw new Error('probe registry: probes.json must declare a non-empty probes[] (an empty registry is a silent gate)')
  }
  return parsed.probes
}

/** Structural validation; returns the problem list (empty = OK). */
export function probeProblems(root, probes) {
  const problems = []
  const seen = new Set()
  for (const probe of probes) {
    const where = 'probe ' + String(probe && probe.id)
    if (typeof probe.id !== 'string' || probe.id === '') { problems.push(where + ': id must be a non-empty string'); continue }
    if (seen.has(probe.id)) problems.push(where + ': duplicate id')
    seen.add(probe.id)
    if (!PROBE_KINDS.includes(probe.kind)) problems.push(where + ': kind must be one of ' + PROBE_KINDS.join('/'))
    if (!PROBE_EVIDENCE.includes(probe.evidence)) problems.push(where + ': evidence must be A or B')
    if (typeof probe.owner !== 'string' || probe.owner === '') problems.push(where + ': owner is required')
    if (typeof probe.note !== 'string' || probe.note === '') problems.push(where + ': note is required')
    // The registry is written ROOT-relative in the mirror (`packages/<pkg>/...`) and copied verbatim
    // into the CI overlay, where the same file lives at `packages/evolution/<pkg>/...`. Resolve
    // against the tree the script was pointed at first, then against the mirror-style root the
    // caller may have passed (`<root>/../<file>`); both layouts must judge the SAME registry.
    const layoutCandidates = (file) => [join(root, file.replace(/^packages\//, '')), join(root, '..', file)]
    const existsInLayout = (file) => layoutCandidates(file).some((candidate) => existsSync(candidate))
    if (!Array.isArray(probe.files) || probe.files.length === 0) problems.push(where + ': files[] is required (the specs/scripts that prove the claim)')
    else for (const file of probe.files) if (!existsInLayout(file)) problems.push(where + ': missing ' + file)
    if (typeof probe.mutation !== 'string' || probe.mutation === '') problems.push(where + ': mutation fixture is required (a probe without a red direction is not a probe)')
    else if (!existsInLayout(probe.mutation)) problems.push(where + ': missing mutation fixture ' + probe.mutation)
  }
  return problems
}

/** Test-title convention: each probe id is the spec title prefix the verification runner greps. */
export function probeTitle(probe) { return '[' + probe.id + ']' }
