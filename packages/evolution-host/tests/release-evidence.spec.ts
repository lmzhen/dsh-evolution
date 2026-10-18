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
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  EVIDENCE_SCHEMA_VERSION,
  SPIKE_IDS,
  TRACEABILITY_UNIVERSE,
  releaseEvidenceSkeleton,
  validateReleaseEvidence,
  validateSpikeEvidence,
} from '../../scripts/lib-release-evidence.mjs'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/verify-release-evidence.mjs', import.meta.url))
const PLATFORM_LINE = { version: '0.2.1-rc.2', floor: '0.2.1-rc.1', peersRange: '^0.2.1-rc.1', enginesRange: '>=0.2.1-rc.1 <0.2.2-0', upstreamRef: 'dsh-v0.2.1-rc.2' }

function spike(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { spike: id, verdict: 'pass', face: 'headless', hostVersion: '0.2.1-rc.2', familyVersion: '0.27.0', startedAt: '2026-10-19T00:00:00.000Z', readings: { route: 200 }, ...overrides }
}

function staging(): Record<string, unknown> {
  return releaseEvidenceSkeleton({
    familyVersion: '0.27.0',
    platformLine: PLATFORM_LINE,
    semverVersion: '7.8.5',
    ciFace: null,
    manifests: { count: 32, enginesRange: PLATFORM_LINE.enginesRange, peerRange: PLATFORM_LINE.peersRange },
    gates: [],
    frozenLines: ['0.2.0'],
    generatedAt: '2026-10-19T00:00:00.000Z',
  })
}

function releasable(): Record<string, unknown> {
  return {
    ...staging(),
    ciFace: { os: 'linux', workflowRef: 'release.yml@refs/tags/v0.27.0' },
    gates: [{ id: 'gate-01', ok: true, reading: 'passed' }],
    spikes: SPIKE_IDS.map(id => spike(id)),
    traceability: { universe: TRACEABILITY_UNIVERSE, covered: 52, total: 52 },
  }
}

async function runGuard(doc: unknown): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'release-evidence-'))
  const file = join(dir, 'release-evidence.json')
  await writeFile(file, JSON.stringify(doc), 'utf8')
  try {
    return await run(process.execPath, [script, file, '--release'], { encoding: 'utf8' })
      .then(out => ({ code: 0, stdout: out.stdout, stderr: out.stderr }))
      .catch(error => ({ code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }))
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
      ['missing spike', doc => { (doc.spikes as unknown[]).pop() }],
      ['blocked spike', doc => { (doc.spikes as Array<Record<string, unknown>>)[1]!.verdict = 'blocked' }],
      ['failed spike without signature', doc => { (doc.spikes as Array<Record<string, unknown>>)[2]!.verdict = 'fail' }],
      ['missing ci face', doc => { doc.ciFace = null }],
      ['empty gate ledger', doc => { doc.gates = [] }],
      ['short traceability', doc => { (doc.traceability as Record<string, unknown>).covered = 51 }],
      ['wrong universe', doc => { (doc.traceability as Record<string, unknown>).universe = { A: 22, B: 18, C: 11 } }],
    ]
    for (const [label, mutate] of cases) {
      const doc = releasable()
      mutate(doc)
      expect(validateReleaseEvidence(doc, { release: true }), label).not.toEqual([])
    }
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
      .then(() => ({ code: 0 })).catch(error => ({ code: error.code ?? 1 }))
    expect(missing.code).toBe(2)
  })
})
