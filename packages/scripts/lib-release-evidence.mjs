#!/usr/bin/env node
/**
 * W2/W3/W10 release-evidence schema (version 2): WHAT a staging was validated against.
 *
 * v1 (W2) recorded the platform line, semver, manifests and the gate readings the CI face
 * injects. v2 adds the three acceptance planes the release runbook needs to be complete:
 *   - `spikes[]`: S1-S4 spike evidence (W10 §2: spike/verdict/face/hostVersion/familyVersion/
 *     startedAt/readings/failure) — a `blocked` spike is NEVER a pass;
 *   - `faces`: optional per-face readings (web/headless) recorded by the rehearsal;
 *   - `traceability`: W11's 52-item universe reading (one number per group + coverage).
 *
 * One home for the schema and the validation: prepare-release writes it, the pre-publish guard
 * checks it, and the tests mutate it (a schema with no refusal is not a guard).
 */

export const EVIDENCE_SCHEMA_VERSION = 2

/** The spike identities W10 defines; the release face requires exactly these. */
export const SPIKE_IDS = Object.freeze(['S1', 'S2', 'S3', 'S4'])
/** Spike verdicts; `blocked` is an environment gap, never a pass. */
export const SPIKE_VERDICTS = Object.freeze(['pass', 'fail', 'blocked'])
/** W11 ITEM_UNIVERSE (A-01..A-22 / B-01..B-18 / C-01..C-12). */
export const TRACEABILITY_UNIVERSE = Object.freeze({ A: 22, B: 18, C: 12 })
const TRACEABILITY_TOTAL = TRACEABILITY_UNIVERSE.A + TRACEABILITY_UNIVERSE.B + TRACEABILITY_UNIVERSE.C

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonEmptyString = (value) => typeof value === 'string' && value.trim() !== ''

/**
 * Validate one spike evidence record (W10 §2 shape).
 * @param spike - candidate record.
 * @param where - label used in the problems.
 * @returns problem strings; empty means valid.
 */
export function validateSpikeEvidence(spike, where = 'spike') {
  const problems = []
  if (!isObject(spike)) return [where + ': not an object']
  if (!SPIKE_IDS.includes(spike.spike)) problems.push(where + ': spike must be one of ' + SPIKE_IDS.join('/'))
  if (!SPIKE_VERDICTS.includes(spike.verdict)) problems.push(where + ': verdict must be one of ' + SPIKE_VERDICTS.join('/'))
  if (!['web', 'headless', 'ci'].includes(spike.face)) problems.push(where + ': face must be web/headless/ci')
  if (!nonEmptyString(spike.hostVersion)) problems.push(where + ': hostVersion is required')
  if (!nonEmptyString(spike.familyVersion)) problems.push(where + ': familyVersion is required')
  if (!nonEmptyString(spike.startedAt) || Number.isNaN(Date.parse(spike.startedAt))) problems.push(where + ': startedAt must be an ISO 8601 timestamp')
  if (!isObject(spike.readings) || Object.keys(spike.readings).length === 0) problems.push(where + ': readings must carry at least one reading')
  if (spike.verdict === 'fail' && !nonEmptyString(spike.failure)) problems.push(where + ': a failed spike must name its failure signature')
  if (spike.verdict === 'blocked' && !nonEmptyString(spike.failure)) problems.push(where + ': a blocked spike must name the missing environment item')
  return problems
}

/**
 * Validate a release-evidence document.
 * @param evidence - parsed release-evidence.json.
 * @param options.release - when true, apply the RELEASE gate (all four spikes pass, a CI face,
 *   complete gate readings and a complete 52-item traceability reading). Local/dev builds pass
 *   with those planes empty, which is exactly what the dev-build staging writes.
 * @returns problem strings; empty means the document is acceptable in the requested mode.
 */
export function validateReleaseEvidence(evidence, options = {}) {
  const release = options.release === true
  const problems = []
  if (!isObject(evidence)) return ['release-evidence: not an object']
  if (evidence.schemaVersion !== EVIDENCE_SCHEMA_VERSION) problems.push('schemaVersion must be ' + String(EVIDENCE_SCHEMA_VERSION))
  if (!nonEmptyString(evidence.familyVersion)) problems.push('familyVersion is required')
  const line = evidence.platformLine
  if (!isObject(line) || !nonEmptyString(line.version) || !nonEmptyString(line.peersRange) || !nonEmptyString(line.enginesRange)) problems.push('platformLine must carry version/peersRange/enginesRange')
  if (!isObject(evidence.manifests) || !Number.isInteger(evidence.manifests.count) || evidence.manifests.count <= 0) problems.push('manifests.count must be a positive integer')
  else {
    if (evidence.manifests.enginesRange !== line.enginesRange) problems.push('manifests.enginesRange must equal platformLine.enginesRange')
    if (evidence.manifests.peerRange !== line.peersRange) problems.push('manifests.peerRange must equal platformLine.peersRange')
  }
  if (!Array.isArray(evidence.frozenLines) || evidence.frozenLines.length === 0) problems.push('frozenLines must name the frozen line(s)')
  if (!Array.isArray(evidence.spikes)) problems.push('spikes must be an array')
  else evidence.spikes.forEach((spike, index) => problems.push(...validateSpikeEvidence(spike, 'spikes[' + String(index) + ']')))
  if (evidence.traceability !== undefined && evidence.traceability !== null) {
    const trace = evidence.traceability
    if (!isObject(trace) || !isObject(trace.universe)) problems.push('traceability.universe must carry A/B/C counts')
    else {
      for (const [group, count] of Object.entries(TRACEABILITY_UNIVERSE)) {
        if (trace.universe[group] !== count) problems.push('traceability.universe.' + group + ' must be ' + String(count))
      }
      if (!Number.isInteger(trace.covered) || trace.covered <= 0) problems.push('traceability.covered must report the covered item count')
      if (!Number.isInteger(trace.total) || trace.total !== TRACEABILITY_TOTAL) problems.push('traceability.total must be ' + String(TRACEABILITY_TOTAL))
    }
  }
  if (release) {
    if (!isObject(evidence.ciFace) || !nonEmptyString(evidence.ciFace.workflowRef)) problems.push('release: ciFace.workflowRef is required')
    if (!Array.isArray(evidence.gates) || evidence.gates.length === 0) problems.push('release: gate readings are required')
    else for (const gate of evidence.gates) {
      if (!isObject(gate) || !nonEmptyString(gate.id) || typeof gate.ok !== 'boolean') problems.push('release: every gate reading needs an id and a boolean ok')
    }
    const byId = new Map((evidence.spikes ?? []).map((spike) => [spike?.spike, spike]))
    for (const id of SPIKE_IDS) {
      const spike = byId.get(id)
      if (spike === undefined) problems.push('release: missing spike ' + id)
      else if (spike.verdict !== 'pass') problems.push('release: spike ' + id + ' is ' + String(spike.verdict) + ' (blocked/fail are not passes)')
    }
    if (evidence.traceability === undefined || evidence.traceability === null) problems.push('release: traceability reading is required')
    else if (evidence.traceability.covered !== TRACEABILITY_TOTAL) problems.push('release: traceability must cover all ' + String(TRACEABILITY_TOTAL) + ' items')
  }
  return problems
}

/**
 * The v2 skeleton prepare-release writes into the staging.
 * @param v1 - the v1 fields (familyVersion/platformLine/semverVersion/manifests/frozenLines/ciFace/gates).
 * @returns the schemaVersion 2 document (the acceptance planes await the rehearsal/CI).
 */
export function releaseEvidenceSkeleton(v1) {
  return {
    ...v1,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    spikes: [],
    faces: null,
    traceability: null,
  }
}
