// @tier pre-tag
/**
 * W2/W3/W10/W11 release-evidence schema v2 — behaviour, not a green-tree re-run: the mechanical
 * mutations a stale or dishonest evidence document would ship (missing spike, a blocked spike at
 * the release gate, a missing CI face, an empty gate ledger, a short traceability reading) must
 * each fail loudly, and the dev-build staging shape must keep passing without those planes.
 */
import { describe, expect, it, vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000 })
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  EVIDENCE_SCHEMA_VERSION as EVIDENCE_SCHEMA_VERSION_RAW,
  SPIKE_IDS as SPIKE_IDS_RAW,
  TRACEABILITY_UNIVERSE as TRACEABILITY_UNIVERSE_RAW,
  releaseEvidenceSkeleton as releaseEvidenceSkeletonRaw,
  validateReleaseEvidence as validateReleaseEvidenceRaw,
  validateSpikeEvidence as validateSpikeEvidenceRaw,
} from '../../scripts/lib-release-evidence.mjs'

// The library is a plain .mjs script (no declarations); pin the shapes this spec drives.
const EVIDENCE_SCHEMA_VERSION = EVIDENCE_SCHEMA_VERSION_RAW as number
const SPIKE_IDS = SPIKE_IDS_RAW as Array<'S1' | 'S2' | 'S3' | 'S4'>
const TRACEABILITY_UNIVERSE = TRACEABILITY_UNIVERSE_RAW as { A: number; B: number; C: number }
const releaseEvidenceSkeleton = releaseEvidenceSkeletonRaw as (v1: Record<string, unknown>) => Record<string, unknown>
const validateReleaseEvidence = validateReleaseEvidenceRaw as (doc: unknown, options?: { release?: boolean }) => string[]
const validateSpikeEvidence = validateSpikeEvidenceRaw as (spike: unknown, where?: string) => string[]

const run = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/verify-release-evidence.mjs', import.meta.url))
const assembleScript = fileURLToPath(new URL('../../scripts/assemble-release-evidence.mjs', import.meta.url))
const FAMILY_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
const PLATFORM_LINE = { version: '0.2.2-rc.1', floor: '0.2.2-rc.0', peersRange: '^0.2.2-rc.0', enginesRange: '>=0.2.2-rc.0 <0.2.3-0', upstreamRef: 'dsh-v0.2.2-rc.1' }

function spike(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { spike: id, verdict: 'pass', face: 'headless', hostVersion: '0.2.2-rc.1', familyVersion: FAMILY_VERSION, startedAt: new Date(Date.now() - 3_600_000).toISOString(), readings: { route: 200 }, ...overrides }
}

function staging(): Record<string, unknown> {
  return releaseEvidenceSkeleton({
    familyVersion: FAMILY_VERSION,
    platformLine: PLATFORM_LINE,
    semverVersion: '7.8.5',
    ciFace: null,
    manifests: { count: 36, enginesRange: PLATFORM_LINE.enginesRange, peerRange: PLATFORM_LINE.peersRange },
    gates: [],
    frozenLines: ['0.2.0'],
    generatedAt: new Date().toISOString(),
    evidenceStatus: 'measured',
  })
}

function releasable(): Record<string, unknown> {
  return {
    ...staging(),
    commit: 'a'.repeat(40),
    tag: 'v' + FAMILY_VERSION,
    ciFace: { os: 'linux', workflowRef: 'release.yml@refs/tags/v0.27.0' },
    gates: [{ id: 'gate-01', ok: true, reading: 'passed', criterionEvaluated: true }],
    spikes: SPIKE_IDS.map(id => spike(id)),
    traceability: { universe: TRACEABILITY_UNIVERSE, covered: 52, total: 52, planned: false },
  }
}

interface EvidenceDoc {
  schemaVersion: number
  spikes: unknown[]
  gates: unknown[]
  ciFace?: { workflowRef: string }
  traceability?: { covered: number }
}

interface ExecFailure { code?: number; stdout?: string; stderr?: string }

/** execFile rejects with the error object; pin its shape instead of flowing `any` through the spec. */
function execFailure(error: unknown): ExecFailure { return error as ExecFailure }

async function runGuard(doc: unknown): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'release-evidence-'))
  const file = join(dir, 'release-evidence.json')
  await writeFile(file, JSON.stringify(doc), 'utf8')
  try {
    return await run(process.execPath, [script, file, '--release', '--version', FAMILY_VERSION], { encoding: 'utf8' })
      .then(out => ({ code: 0, stdout: out.stdout, stderr: out.stderr }))
      .catch((error: unknown) => { const failure = execFailure(error); return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' } })
  } finally { await rm(dir, { recursive: true, force: true }) }
}

describe('release-evidence schema v2', () => {
  it('the dev-build staging shape validates locally but NOT at the release gate', () => {
    expect(EVIDENCE_SCHEMA_VERSION).toBe(2)
    const stagingDoc = staging()
    expect(stagingDoc.schemaVersion).toBe(2)
    expect(stagingDoc.spikes).toEqual([])
    expect(validateReleaseEvidence(stagingDoc)).toEqual([])
    expect(validateReleaseEvidence(stagingDoc, { release: true }).length).toBeGreaterThan(0)
  })

  it('the complete release shape passes, and every acceptance plane can refuse', () => {
    expect(validateReleaseEvidence(releasable(), { release: true })).toEqual([])
    const cases: Array<[string, (doc: Record<string, unknown>) => void]> = [
      ['missing spike', (doc) => { (doc.spikes as unknown[]).pop() }],
      ['blocked spike', (doc) => { (doc.spikes as Array<Record<string, unknown>>)[1]!.verdict = 'blocked' }],
      ['failed spike without signature', (doc) => { (doc.spikes as Array<Record<string, unknown>>)[2]!.verdict = 'fail' }],
      ['missing ci face', (doc) => { doc.ciFace = null }],
      ['empty gate ledger', (doc) => { doc.gates = [] }],
      ['failed gate', (doc) => { (doc.gates as Array<Record<string, unknown>>)[0]!.ok = false }],
      ['synthetic gate', (doc) => { (doc.gates as Array<Record<string, unknown>>)[0]!.synthetic = true }],
      ['unevaluated pass', (doc) => { delete (doc.gates as Array<Record<string, unknown>>)[0]!.criterionEvaluated }],
      ['short traceability', (doc) => { (doc.traceability as Record<string, unknown>).covered = 51 }],
      ['wrong universe', (doc) => { (doc.traceability as Record<string, unknown>).universe = { A: 22, B: 18, C: 11 } }],
      ['rehearsal status', (doc) => { doc.evidenceStatus = 'rehearsal' }],
    ]
    for (const [label, mutate] of cases) {
      const doc = releasable()
      mutate(doc)
      expect(validateReleaseEvidence(doc, { release: true }), label).not.toEqual([])
    }
  })

  it('P1-13: release evidence binds commit/tag and rejects stale spikes', () => {
    const opts = { release: true, maxAgeMs: 7 * 24 * 60 * 60 * 1000 }
    expect(validateReleaseEvidence(releasable(), opts)).toEqual([])
    const cases: Array<[string, (doc: Record<string, unknown>) => void, Record<string, unknown>?]> = [
      ['missing commit', (doc) => { delete doc.commit }],
      ['missing tag', (doc) => { delete doc.tag }],
      ['stale spike', (doc) => { (doc.spikes as Array<Record<string, unknown>>)[0]!.startedAt = new Date(Date.now() - 30 * 86_400_000).toISOString() }],
      ['future spike', (doc) => { (doc.spikes as Array<Record<string, unknown>>)[0]!.startedAt = new Date(Date.now() + 86_400_000).toISOString() }],
      ['commit mismatch', (doc) => { doc.commit = 'b'.repeat(40) }, { expectedCommit: 'a'.repeat(40) }],
      ['tag mismatch', (doc) => { doc.tag = 'v9.9.9' }, { expectedTag: 'v' + FAMILY_VERSION }],
    ]
    for (const [label, mutate, extra] of cases) {
      const doc = releasable()
      mutate(doc)
      expect(validateReleaseEvidence(doc, { ...opts, ...(extra ?? {}) }), label).not.toEqual([])
    }
  })

  it('P1-13: the release gate refuses a stale family snapshot', async () => {
    const stale = releasable()
    stale.familyVersion = '0.27.0'
    stale.spikes = SPIKE_IDS.map(id => spike(id, { familyVersion: '0.27.0' }))
    const result = await runGuard(stale)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('does not match the current tree')
  })

  it('one spike record: a blocked/failed verdict must name what stopped it', () => {
    expect(validateSpikeEvidence(spike('S1'))).toEqual([])
    expect(validateSpikeEvidence(spike('S1', { verdict: 'blocked' }))).not.toEqual([])
    expect(validateSpikeEvidence(spike('S1', { verdict: 'fail', failure: 'HTTP 404' }))).toEqual([])
    expect(validateSpikeEvidence(spike('S9'))).not.toEqual([])
    expect(validateSpikeEvidence(spike('S1', { startedAt: 'yesterday' }))).not.toEqual([])
    expect(validateSpikeEvidence(spike('S1', { readings: {} }))).not.toEqual([])
  })

  it('the CLI guard refuses a broken document and cannot decide a missing one', async () => {
    expect((await runGuard(releasable())).code).toBe(0)
    const broken = releasable()
    ;(broken.spikes as unknown[]).pop()
    const refused = await runGuard(broken)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('missing spike S4')
    const missing = await run(process.execPath, [script, join(tmpdir(), 'does-not-exist-release-evidence.json')], { encoding: 'utf8' })
      .then(() => ({ code: 0 })).catch((error: unknown) => ({ code: execFailure(error).code ?? 1 }))
    expect(missing.code).toBe(2)
  })

  it('refuses a rehearsal whose spikes were not measured on the release version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assemble-inherited-'))
    const evidencePath = join(dir, 'release-evidence.json')
    await writeFile(evidencePath, JSON.stringify(staging()), 'utf8')
    try {
      const result = await run(process.execPath, [assembleScript, evidencePath,
        '--rehearsal', fileURLToPath(new URL('../../scripts/release-evidence-rehearsal.json', import.meta.url)),
        '--ci-face', 'release.yml@refs/tags/v' + FAMILY_VERSION, '--os', 'linux',
        '--commit', 'a'.repeat(40), '--tag', 'v' + FAMILY_VERSION,
        '--version', FAMILY_VERSION, '--release'], { encoding: 'utf8' })
        .then(out => ({ code: 0, stderr: out.stderr }))
        .catch((error: unknown) => { const failure = execFailure(error); return { code: failure.code ?? 1, stderr: failure.stderr ?? '' } })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('was measured on')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})

async function runAssemble(
  staging: unknown,
  inputs: unknown,
  extra: string[] = [],
): Promise<{ code: number; stdout: string; stderr: string; doc: EvidenceDoc }> {
  const dir = await mkdtemp(join(tmpdir(), 'assemble-evidence-'))
  const evidencePath = join(dir, 'release-evidence.json')
  const inputsPath = join(dir, 'rehearsal.json')
  await writeFile(evidencePath, JSON.stringify(staging), 'utf8')
  await writeFile(inputsPath, JSON.stringify(inputs), 'utf8')
  try {
    const result = await run(process.execPath, [assembleScript, evidencePath, '--rehearsal', inputsPath, ...extra], { encoding: 'utf8' })
      .then(out => ({ code: 0, stdout: out.stdout, stderr: out.stderr }))
      .catch((error: unknown) => {
        const failure = execFailure(error)
        return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
      })
    const doc = JSON.parse(await readFile(evidencePath, 'utf8')) as EvidenceDoc
    return { ...result, doc }
  } finally { await rm(dir, { recursive: true, force: true }) }
}

describe('release-evidence assembly (W3 injection)', () => {
  const rehearsalInputs = () => ({
    spikes: SPIKE_IDS.map(id => spike(id)),
    traceability: { universe: TRACEABILITY_UNIVERSE, covered: 52, total: 52, planned: false },
  })
  it('merges the rehearsal planes, the CI face and the manifest gate ledger', async () => {
    const result = await runAssemble(staging(), rehearsalInputs(), ['--gates-from-manifest', 'ci', '--ci-face', 'release.yml@refs/tags/v0.27.0', '--os', 'linux', '--commit', 'a'.repeat(40), '--tag', 'v' + FAMILY_VERSION])
    expect(result.code).toBe(0)
    expect(result.doc.spikes).toHaveLength(4)
    expect(result.doc.gates.length).toBeGreaterThan(0)
    expect(result.doc.ciFace).toEqual({ os: 'linux', workflowRef: 'release.yml@refs/tags/v0.27.0' })
    expect(result.doc.traceability.covered).toBe(52)
    expect(validateReleaseEvidence(result.doc, { release: true }).some(problem => problem.includes('synthetic manifest reading'))).toBe(true)
  })
  it('accepts a real run-gates ledger instead of the synthetic manifest rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assemble-gates-report-'))
    const report = join(dir, 'gates.json')
    await writeFile(report, JSON.stringify({ gates: [{ id: 'gate-01', verdict: 'pass', reading: 'run-gates local', criterionEvaluated: true }] }), 'utf8')
    try {
      const result = await runAssemble(staging(), rehearsalInputs(), ['--gates-report', report, '--ci-face', 'release.yml@refs/tags/v' + FAMILY_VERSION, '--os', 'linux', '--commit', 'a'.repeat(40), '--tag', 'v' + FAMILY_VERSION])
      expect(result.code).toBe(0)
      expect(result.doc.gates).toEqual([{ id: 'gate-01', ok: true, reading: 'run-gates local', criterionEvaluated: true }])
      expect(validateReleaseEvidence(result.doc, { release: true })).toEqual([])
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('P2-39: flags-first invocation still finds the evidence file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assemble-evidence-order-'))
    const evidencePath = join(dir, 'release-evidence.json')
    const inputsPath = join(dir, 'rehearsal.json')
    await writeFile(evidencePath, JSON.stringify(staging()), 'utf8')
    await writeFile(inputsPath, JSON.stringify(rehearsalInputs()), 'utf8')
    const result = await run(process.execPath, [assembleScript, '--gates-from-manifest', 'ci', '--rehearsal', inputsPath, '--ci-face', 'release.yml@refs/tags/v0.27.0', '--os', 'linux', evidencePath], { encoding: 'utf8' })
      .then(out => ({ code: 0, stdout: out.stdout, stderr: out.stderr }))
      .catch((error: unknown) => { const failure = execFailure(error); return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' } })
    expect(result.code).toBe(0)
    const doc = JSON.parse(await readFile(evidencePath, 'utf8')) as EvidenceDoc
    expect(doc.spikes).toHaveLength(4)
    expect(doc.ciFace).toEqual({ os: 'linux', workflowRef: 'release.yml@refs/tags/v0.27.0' })
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses a rehearsal snapshot that is not release-complete', async () => {
    const inputs = rehearsalInputs()
    inputs.spikes.pop()
    const result = await runAssemble(staging(), inputs, ['--gates-from-manifest', 'ci', '--ci-face', 'release.yml@refs/tags/v0.27.0', '--os', 'linux', '--release'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('missing spike S4')
  })
  it('cannot decide without the rehearsal inputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assemble-missing-'))
    try {
      const evidencePath = join(dir, 'release-evidence.json')
      await writeFile(evidencePath, JSON.stringify(staging()), 'utf8')
      const result = await run(process.execPath, [assembleScript, evidencePath, '--rehearsal', join(dir, 'absent.json')], { encoding: 'utf8' })
        .then(() => ({ code: 0 })).catch((error: unknown) => ({ code: execFailure(error).code ?? 1 }))
      expect(result.code).toBe(2)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
