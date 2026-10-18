// @tier pre-tag
import { Context } from '@deepseek-ai/cordis'
import {
  DIAGNOSTICS_FACT_KEYS,
  DIAGNOSTICS_RUNTIME_KEYS,
  DIAGNOSTICS_VIEW_SCHEMA_VERSION,
  MAINTAINER_PRESET_ID,
  PLATFORM_LINE,
  REVIEWER_PRESET_ID,
} from '@deepseek-ai/dsh-evolution-core'
import type { ChannelState } from '@deepseek-ai/dsh-evolution-core'
import { describe, expect, it } from 'vitest'
import { assembleDoctorInputs, buildDoctorView, unavailableDoctorView, type DoctorInputs } from '../src/doctor-view.ts'

const AVAILABLE: ChannelState = { kind: 'available', provider: 'spawn' }
const UNAVAILABLE: ChannelState = { kind: 'unavailable', code: 'E-323', reason: 'agentPresets not mounted' }

/** The golden input: every probe healthy and declared (the "all ok" baseline). */
function inputs(overrides: Partial<DoctorInputs> = {}): DoctorInputs {
  return {
    now: new Date('2026-10-19T00:00:00.000Z'),
    platformLine: { version: PLATFORM_LINE.version, floor: PLATFORM_LINE.floor },
    familyVersion: '0.27.0',
    hostVersion: PLATFORM_LINE.version,
    form: { id: 'M2', evidence: ['profile declares evolution-all'], confidence: 'declared' },
    probes: { agentPresets: true, connection: true },
    channels: { review: AVAILABLE, maintenance: AVAILABLE },
    presets: {
      reviewer: { id: REVIEWER_PRESET_ID, registered: true },
      maintainer: { id: MAINTAINER_PRESET_ID, registered: true },
    },
    host: { mounted: true, deploymentAllowsRemote: false },
    runs: { running: 0, orphaned: 0 },
    missingServices: [],
    sessionFoldClassifierPresent: true,
    platformPairing: 'in-window',
    hostRouteCount: { mounted: 12, total: 12 },
    ...overrides,
  }
}

function row(view: ReturnType<typeof buildDoctorView>, key: string) {
  const found = view.runtime.find(candidate => candidate.key === key)
  if (found === undefined) throw new Error('missing runtime row ' + key)
  return found
}

describe('buildDoctorView: the frozen 7+8 shape', () => {
  it('answers schemaVersion 2 with exactly the frozen key sets, sorted', () => {
    const view = buildDoctorView(inputs())
    expect(view.schemaVersion).toBe(DIAGNOSTICS_VIEW_SCHEMA_VERSION)
    expect(view.generatedAt).toBe('2026-10-19T00:00:00.000Z')
    const expectedFacts = [...DIAGNOSTICS_FACT_KEYS].sort()
    const expectedRuntime = [...DIAGNOSTICS_RUNTIME_KEYS].sort()
    expect(view.facts.map(fact => fact.key)).toEqual(expectedFacts)
    expect(view.runtime.map(entry => entry.key)).toEqual(expectedRuntime)
    // Every fact names a home (the family-facts single-source rule) and a non-empty value.
    for (const fact of view.facts) {
      expect(fact.home).not.toBe('')
      expect(fact.value).not.toBe('')
    }
  })

  it('reports the declared platform line and family version, never a literal', () => {
    const view = buildDoctorView(inputs())
    const platform = view.facts.find(fact => fact.key === 'platform-line')
    expect(platform?.value).toContain(PLATFORM_LINE.version)
    expect(platform?.value).toContain(PLATFORM_LINE.floor)
    expect(view.facts.find(fact => fact.key === 'family-version')?.value).toBe('0.27.0')
    expect(view.facts.find(fact => fact.key === 'preset-ids')?.value).toContain(REVIEWER_PRESET_ID)
  })

  it('renders a healthy host as all-ok runtime rows', () => {
    const view = buildDoctorView(inputs())
    for (const entry of view.runtime) expect(entry.status, entry.key).toBe('ok')
    expect(row(view, 'host-surface').detail).toContain('12/12')
  })
})

describe('buildDoctorView: unreadable providers become named rows, never silence', () => {
  it('warns when either subagent channel is unavailable and names the code', () => {
    const view = buildDoctorView(inputs({ channels: { review: AVAILABLE, maintenance: UNAVAILABLE } }))
    const entry = row(view, 'subagent-channel')
    expect(entry.status).toBe('warn')
    expect(entry.detail).toContain('E-323')
    expect(entry.remedy).not.toBe('')
  })

  it('fails the restricted-preset row on E-324 and names the broken reason', () => {
    const view = buildDoctorView(inputs({ presets: { reviewer: { id: REVIEWER_PRESET_ID, registered: false, broken: 'compose failed' } } }))
    const entry = row(view, 'restricted-preset')
    expect(entry.status).toBe('fail')
    expect(entry.detail).toContain('E-324')
    expect(entry.detail).toContain('compose failed')
  })

  it('keeps the E-325 host row actionable with the command fallback', () => {
    const view = buildDoctorView(inputs({ host: { mounted: false, reason: 'connection-missing' } }))
    const entry = row(view, 'host-surface')
    expect(entry.status).toBe('warn')
    expect(entry.detail).toContain('E-325')
    expect(entry.remedy).toContain('/evolution')
  })

  it('names the missing platform services instead of claiming health', () => {
    const view = buildDoctorView(inputs({ missingServices: ['connection', 'agentPresets'] }))
    const entry = row(view, 'platform-services')
    expect(entry.status).toBe('warn')
    expect(entry.detail).toContain('connection')
    expect(entry.detail).toContain('agentPresets')
  })

  it('warns on orphaned runs and never hides the counters', () => {
    const view = buildDoctorView(inputs({ runs: { running: 2, orphaned: 1 } }))
    const entry = row(view, 'runs')
    expect(entry.status).toBe('warn')
    expect(entry.detail).toContain('orphaned=1')
  })

  it('maps the platform pairing window to ok/warn/fail/unknown', () => {
    const inWindow = buildDoctorView(inputs({ platformPairing: 'in-window' }))
    expect(row(inWindow, 'platform-pairing').status).toBe('ok')
    const newer = buildDoctorView(inputs({ platformPairing: 'host-newer' }))
    expect(row(newer, 'platform-pairing').status).toBe('warn')
    const outside = buildDoctorView(inputs({ platformPairing: 'out-of-window' }))
    expect(row(outside, 'platform-pairing').status).toBe('fail')
    const unknown = buildDoctorView(inputs({ platformPairing: 'unknown', hostVersion: undefined }))
    expect(row(unknown, 'platform-pairing').status).toBe('unknown')
  })

  it('marks an inferred install form as a warn with its evidence', () => {
    const view = buildDoctorView(inputs({ form: { id: 'M3', evidence: ['no bundle surface'], confidence: 'inferred' } }))
    const entry = row(view, 'install-form-detected')
    expect(entry.status).toBe('warn')
    expect(entry.detail).toContain('no bundle surface')
  })

  it('fails the session-fold row when the frozen classifier is absent', () => {
    const view = buildDoctorView(inputs({ sessionFoldClassifierPresent: false }))
    expect(row(view, 'session-fold').status).toBe('fail')
  })
})

describe('unavailableDoctorView: the safe all-unknown answer', () => {
  it('names the failure on every row and keeps the frozen shape', () => {
    const view = unavailableDoctorView(new Date('2026-10-19T00:00:00.000Z'), 'probe boom')
    expect(view.schemaVersion).toBe(2)
    expect(view.facts.map(fact => fact.key)).toEqual([...DIAGNOSTICS_FACT_KEYS].sort())
    expect(view.runtime.map(entry => entry.key)).toEqual([...DIAGNOSTICS_RUNTIME_KEYS].sort())
    for (const entry of view.runtime) {
      expect(entry.status).toBe('unknown')
      expect(entry.detail).toContain('probe boom')
    }
    expect(view.facts.every(fact => fact.value === 'unknown')).toBe(true)
  })
})

describe('assembleDoctorInputs: the live soft probes (measured on the isolated 0.2.1 face)', () => {
  it('awaits the agentPresets list (a promise) and derives the installed bundle form', async () => {
    const ctx = new Context()
    ctx.provide('agentPresets', {
      list: async () => [{ id: REVIEWER_PRESET_ID }, { id: MAINTAINER_PRESET_ID }],
      composedPreset: () => 'standard',
    })
    ctx.provide('subagents', { getProvider: () => undefined })
    ctx.provide('commands', {})
    ctx.provide('settings', {})
    ctx.provide('connection', { allowsRemoteAuthorities: false, fetch: { register: async () => async () => {} } })
    ctx.provide('pluginManager', { listBundles: async () => [{ name: '@deepseek-ai/dsh-evolution-all' }] })
    const assembled = await assembleDoctorInputs(ctx, { now: new Date('2026-10-19T00:00:00.000Z'), runs: { running: 0, orphaned: 0 } })
    // The preset probe: a NOT-awaited promise used to leave this row permanently unknown.
    expect(assembled.presets.reviewer).toMatchObject({ id: REVIEWER_PRESET_ID, registered: true })
    expect(assembled.form).toMatchObject({ id: 'M1', confidence: 'declared' })
    expect(assembled.probes.agentPresets).toBe(true)
    expect(assembled.host.mounted).toBe(true)
    // The host version is a soft probe: when the platform manifest resolves it must agree with the line.
    if (assembled.hostVersion !== undefined) {
      expect(assembled.platformPairing).toBe(assembled.hostVersion === PLATFORM_LINE.version ? 'in-window' : 'host-newer')
    } else {
      expect(assembled.platformPairing).toBe('unknown')
    }
  })

  it('detects M4 when the host bundle plus the family agent preset are installed', async () => {
    const ctx = new Context()
    ctx.provide('agentPresets', {
      list: async () => [{ id: 'evolution' }, { id: REVIEWER_PRESET_ID }],
      composedPreset: () => 'standard',
    })
    ctx.provide('subagents', {})
    ctx.provide('pluginManager', { listBundles: async () => [{ name: '@deepseek-ai/dsh-evolution-host' }] })
    const assembled = await assembleDoctorInputs(ctx, { now: new Date('2026-10-19T00:00:00.000Z') })
    expect(assembled.form).toMatchObject({ id: 'M4', confidence: 'declared' })
  })

  it('stays a named view when nothing is mounted (no throw, no invented health)', async () => {
    const ctx = new Context()
    const assembled = await assembleDoctorInputs(ctx)
    expect(assembled.host.mounted).toBe(false)
    expect(assembled.missingServices.length).toBeGreaterThan(0)
    expect(assembled.form.confidence).toBe('inferred')
    const view = buildDoctorView(assembled)
    expect(view.runtime.find(row => row.key === 'host-surface')?.status).toBe('warn')
  })
})
