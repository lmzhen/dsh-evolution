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

const GIT_SHA = /^[a-f0-9]{7,40}$/
const TRACE_COMMIT_IN_SOURCE = /(?:^|[^0-9a-f])([0-9a-f]{7,40})(?![0-9a-f])/i

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
  if (typeof spike.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(spike.artifactSha256)) problems.push(where + ': artifactSha256 must hash the measured artifact')
  if (typeof spike.commit !== 'string' || !GIT_SHA.test(spike.commit)) problems.push(where + ': commit must be the git sha the spike was measured on')
  if (typeof spike.inputsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(spike.inputsSha256)) problems.push(where + ': inputsSha256 must hash the measured inputs')
  if (!isObject(spike.readings) || Object.keys(spike.readings).length === 0) problems.push(where + ': readings must carry at least one reading')
  if (spike.verdict === 'fail' && !nonEmptyString(spike.failure)) problems.push(where + ': a failed spike must name its failure signature')
  if (spike.verdict === 'blocked' && !nonEmptyString(spike.failure)) problems.push(where + ': a blocked spike must name the missing environment item')
  return problems
}

/**
 * Validate the per-cohort runtime readings. A version listed in the envelope
 * without a clean-install/boot/row-survival reading is not evidence that this
 * artifact supports it.
 *
 * @param cohort - the evidence cohort block.
 * @param line - the platformLine the evidence was produced against.
 * @param release - require a complete reading for every cohort member.
 * @returns problem strings; empty means valid.
 */
export function validateCohortEvidence(cohort, line, release = false) {
  const problems = []
  const where = 'cohort'
  const versions = Array.isArray(line?.cohort) ? line.cohort : []
  if (!isObject(cohort)) return [where + ': readings must be an object carrying versions/readings']
  if (!Array.isArray(cohort.versions) || cohort.versions.length === 0) problems.push(where + '.versions must be a nonempty array')
  else if (versions.length > 0 && JSON.stringify(cohort.versions) !== JSON.stringify(versions)) problems.push(where + '.versions must equal platformLine.cohort')
  if (!Array.isArray(cohort.readings)) return [...problems, where + '.readings must be an array']
  const seen = new Set()
  for (const [index, reading] of cohort.readings.entries()) {
    const at = where + '.readings[' + String(index) + ']'
    if (!isObject(reading)) { problems.push(at + ': not an object'); continue }
    if (!nonEmptyString(reading.version)) problems.push(at + '.version is required')
    else if (seen.has(reading.version)) problems.push(at + ': duplicate version ' + reading.version)
    else seen.add(reading.version)
    if (reading.install !== 'clean') problems.push(at + '.install must be "clean"')
    if (reading.boot !== 200) problems.push(at + '.boot must be HTTP 200')
    if (!Number.isInteger(reading.activeRows) || !Number.isInteger(reading.expectedActiveRows) || reading.activeRows !== reading.expectedActiveRows) problems.push(at + ': activeRows must equal expectedActiveRows')
    if (!Array.isArray(reading.disabledRows)) problems.push(at + '.disabledRows must be an array')
    if (reading.doctor !== 'ok') problems.push(at + '.doctor must be "ok"')
    if (reading.smoke !== 'pass') problems.push(at + '.smoke must be "pass"')
    if (!['ci', 'local', 'rehearsal'].includes(reading.source)) problems.push(at + '.source must be ci/local/rehearsal')
    else if (release && reading.source !== 'ci') problems.push(at + ': release requires a CI-measured reading, not ' + reading.source)
  }
  if (release) {
    if (versions.length === 0) problems.push('release: platformLine.cohort is missing; cannot prove per-version support')
    for (const version of versions) {
      if (!seen.has(version)) problems.push('release: cohort member ' + version + ' has no clean-install/boot/row-survival reading')
    }
  }
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
  if (nonEmptyString(options.expectedFamilyVersion) && evidence.familyVersion !== options.expectedFamilyVersion) problems.push('release: familyVersion ' + String(evidence.familyVersion) + ' does not match the current tree ' + options.expectedFamilyVersion)
  if (release && (!nonEmptyString(evidence.generatedAt) || Number.isNaN(Date.parse(evidence.generatedAt)))) problems.push('release: generatedAt must be an ISO 8601 timestamp')
  if (release && evidence.evidenceStatus !== 'measured') problems.push('release: evidenceStatus must be measured (a rehearsal/inherited label is not release evidence)')
  if (release && (typeof evidence.commit !== 'string' || !GIT_SHA.test(evidence.commit))) problems.push('release: commit must be the git sha the evidence was measured on')
  if (release && (typeof evidence.tag !== 'string' || !evidence.tag.startsWith('v'))) problems.push('release: tag must start with v')
  if (release && nonEmptyString(options.expectedCommit) && evidence.commit !== options.expectedCommit) problems.push('release: commit ' + String(evidence.commit) + ' does not match the current checkout ' + options.expectedCommit)
  if (release && nonEmptyString(options.expectedTag) && evidence.tag !== options.expectedTag) problems.push('release: tag ' + String(evidence.tag) + ' does not match the release tag ' + options.expectedTag)
  if (release && nonEmptyString(evidence.generatedAt) && Number.isInteger(options.maxAgeMs) && Date.now() - Date.parse(evidence.generatedAt) > options.maxAgeMs) problems.push('release: generatedAt is older than ' + String(options.maxAgeMs) + 'ms — regenerate the evidence for this build')
  const line = evidence.platformLine
  // A missing/non-object platformLine must RETURN: the fields below dereference it, and a TypeError
  // is not the declared cannot-decide report (P0-8).
  if (!isObject(line)) return [...problems, 'platformLine must be an object carrying version/peersRange/enginesRange']
  if (!nonEmptyString(line.version) || !nonEmptyString(line.peersRange) || !nonEmptyString(line.enginesRange)) problems.push('platformLine must carry version/peersRange/enginesRange')
  if (release) problems.push(...validateCohortEvidence(evidence.cohort, line, true))
  if (!isObject(evidence.manifests) || !Number.isInteger(evidence.manifests.count) || evidence.manifests.count <= 0) problems.push('manifests.count must be a positive integer')
  else {
    if (evidence.manifests.enginesRange !== line.enginesRange) problems.push('manifests.enginesRange must equal platformLine.enginesRange')
    if (evidence.manifests.peerRange !== line.peersRange) problems.push('manifests.peerRange must equal platformLine.peersRange')
  }
  if (!Array.isArray(evidence.frozenLines) || evidence.frozenLines.length === 0) problems.push('frozenLines must name the frozen line(s)')
  if (!Array.isArray(evidence.spikes)) problems.push('spikes must be an array')
  else evidence.spikes.forEach((spike, index) => {
    const at = 'spikes[' + String(index) + ']'
    problems.push(...validateSpikeEvidence(spike, at))
    if (release && nonEmptyString(spike?.startedAt) && Number.isInteger(options.maxAgeMs)) {
      const started = Date.parse(spike.startedAt)
      const generated = Date.parse(evidence.generatedAt)
      if (Number.isFinite(started) && Number.isFinite(generated) && started > generated) problems.push('release: ' + at + '.startedAt is later than generatedAt')
      if (Number.isFinite(started) && Date.now() - started > options.maxAgeMs) problems.push('release: ' + at + '.startedAt is older than ' + String(options.maxAgeMs) + 'ms — re-run the rehearsal for this build')
    }
  })
  if (evidence.traceability !== undefined && evidence.traceability !== null) {
    const trace = evidence.traceability
    if (!isObject(trace) || !isObject(trace.universe)) problems.push('traceability.universe must carry A/B/C counts')
    else {
      for (const [group, count] of Object.entries(TRACEABILITY_UNIVERSE)) {
        if (trace.universe[group] !== count) problems.push('traceability.universe.' + group + ' must be ' + String(count))
      }
      if (!Number.isInteger(trace.covered) || trace.covered <= 0) problems.push('traceability.covered must report the covered item count')
      if (!Number.isInteger(trace.total) || trace.total !== TRACEABILITY_TOTAL) problems.push('traceability.total must be ' + String(TRACEABILITY_TOTAL))
      if (trace.planned !== false) problems.push('traceability reading must declare planned:false (strict mode)')
      if (release) {
        const declared = typeof trace.measuredCommit === 'string' && GIT_SHA.test(trace.measuredCommit)
          ? trace.measuredCommit
          : typeof trace.source === 'string' ? TRACE_COMMIT_IN_SOURCE.exec(trace.source)?.[1] : undefined
        const measured = typeof evidence.measuredCommit === 'string' ? evidence.measuredCommit : undefined
        if (declared === undefined) problems.push('release: traceability must name the measured commit (traceability.measuredCommit or a sha in traceability.source)')
        else if (measured === undefined || declared !== measured) problems.push('release: traceability was measured on commit ' + declared + ', not the measured family commit ' + String(measured))
      }
    }
  }
  if (release) {
    if (!isObject(evidence.ciFace) || !nonEmptyString(evidence.ciFace.workflowRef)) problems.push('release: ciFace.workflowRef is required')
    if (!Array.isArray(evidence.gates) || evidence.gates.length === 0) problems.push('release: gate readings are required')
    else for (const gate of evidence.gates) {
      if (!isObject(gate) || !nonEmptyString(gate.id) || typeof gate.ok !== 'boolean') problems.push('release: every gate reading needs an id and a boolean ok')
      else {
        if (gate.ok !== true) problems.push('release: gate ' + gate.id + ' is not a pass')
        else if (gate.criterionEvaluated !== true) problems.push('release: gate ' + gate.id + ' passes without criterionEvaluated=true')
        if (gate.synthetic === true) problems.push('release: gate ' + gate.id + ' is a synthetic manifest reading; pass --gates-report with the run-gates ledger')
      }
    }
    const measuredCommit = evidence.measuredCommit
    if (!nonEmptyString(measuredCommit) || !GIT_SHA.test(measuredCommit)) problems.push('release: measuredCommit must be the git sha the family tree was measured on')
    const byId = new Map((evidence.spikes ?? []).map((spike) => [spike?.spike, spike]))
    for (const id of SPIKE_IDS) {
      const spike = byId.get(id)
      if (spike === undefined) problems.push('release: missing spike ' + id)
      else if (spike.verdict !== 'pass') problems.push('release: spike ' + id + ' is ' + String(spike.verdict) + ' (blocked/fail are not passes)')
      if (spike !== undefined && spike.familyVersion !== evidence.familyVersion) problems.push('release: spike ' + id + ' was measured on ' + String(spike.familyVersion) + ', not ' + String(evidence.familyVersion))
      if (spike !== undefined && spike.commit !== measuredCommit) problems.push('release: spike ' + id + ' was measured on commit ' + String(spike.commit) + ', not the measured family commit ' + String(measuredCommit))
    }
    const artifacts = evidence.artifacts
    const measuredHashes = new Set()
    if (!isObject(artifacts) || !Array.isArray(artifacts.files) || artifacts.files.length === 0) {
      problems.push('release: artifacts must list the measured dist tarballs')
    } else {
      if (artifacts.count !== artifacts.files.length) problems.push('release: artifacts.count must equal artifacts.files.length')
      for (const [index, file] of artifacts.files.entries()) {
        if (!isObject(file) || !nonEmptyString(file.name) || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
          problems.push('release: artifacts.files[' + String(index) + '] must carry a name and sha256')
          continue
        }
        measuredHashes.add(file.sha256)
      }
      if (measuredHashes.size === 0) problems.push('release: artifacts carries no usable sha256')
    }
    for (const spike of Array.isArray(evidence.spikes) ? evidence.spikes : []) {
      if (isObject(spike) && nonEmptyString(spike.spike) && measuredHashes.size > 0 && !measuredHashes.has(spike.artifactSha256)) {
        problems.push('release: spike ' + spike.spike + ' artifactSha256 is not one of the measured dist artifacts')
      }
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
    cohort: v1.cohort ?? null,
    spikes: [],
    faces: null,
    traceability: null,
  }
}
