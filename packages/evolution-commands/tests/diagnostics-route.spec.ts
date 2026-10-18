// @tier fast
/**
 * G6/W8: the diagnostics Host route is the browser face of the SAME DiagnosticsView the CLI renders.
 * The carrier harness reproduces the platform's exact-route selection; the handler must answer the
 * family envelope, keep schemaVersion 2, and turn a failed input assembly into an all-unknown view
 * (doctor never throws).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DIAGNOSTICS_FACT_KEYS, DIAGNOSTICS_RUNTIME_KEYS, PLATFORM_LINE } from '@deepseek-ai/dsh-evolution-core'
import { HOST_ROUTES } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { mountHostRoutes } from '../../test-support/host-route-harness.ts'
import { makeDiagnosticsRoutes } from '../src/diagnostics-route.ts'
import type { DoctorInputs } from '../src/doctor-view.ts'

function inputs(): DoctorInputs {
  return {
    now: new Date('2026-10-19T00:00:00.000Z'),
    platformLine: { version: PLATFORM_LINE.version, floor: PLATFORM_LINE.floor },
    familyVersion: '0.27.0',
    form: { id: 'M2', evidence: ['profile declares evolution-all'], confidence: 'declared' },
    probes: { agentPresets: true, connection: true },
    channels: {
      review: { kind: 'available', provider: 'spawn' },
      maintenance: { kind: 'available', provider: 'spawn' },
    },
    presets: { reviewer: { registered: true }, maintainer: { registered: true } },
    host: { mounted: true, deploymentAllowsRemote: false },
    runs: { running: 0, orphaned: 0 },
    missingServices: [],
    sessionFoldClassifierPresent: true,
    platformPairing: 'in-window',
  }
}

describe('diagnostics route', () => {
  it('answers the family envelope with schemaVersion 2 and the frozen key sets', async () => {
    const ctx = new Context()
    const host = await mountHostRoutes(ctx, () => makeDiagnosticsRoutes(async () => inputs()))
    const answer = await host.json<{ ok: boolean; data: { schemaVersion: number; facts: Array<{ key: string }>; runtime: Array<{ key: string }> } }>(HOST_ROUTES.diagnostics.view)
    expect(answer.status).toBe(200)
    expect(answer.body.ok).toBe(true)
    expect(answer.body.data.schemaVersion).toBe(2)
    expect(answer.body.data.facts.map(fact => fact.key)).toEqual([...DIAGNOSTICS_FACT_KEYS].sort())
    expect(answer.body.data.runtime.map(entry => entry.key)).toEqual([...DIAGNOSTICS_RUNTIME_KEYS].sort())
  })

  it('turns a failed input assembly into an all-unknown view (doctor never throws)', async () => {
    const ctx = new Context()
    const host = await mountHostRoutes(ctx, () => makeDiagnosticsRoutes(async () => { throw new Error('probe boom') }))
    const answer = await host.json<{ ok: boolean; data: { runtime: Array<{ status: string; detail?: string }> } }>(HOST_ROUTES.diagnostics.view)
    expect(answer.status).toBe(200)
    expect(answer.body.ok).toBe(true)
    expect(answer.body.data.runtime.every(entry => entry.status === 'unknown')).toBe(true)
    expect(answer.body.data.runtime[0]?.detail).toContain('probe boom')
  })

  it('declares GET only: an undeclared method falls through on the platform carrier', async () => {
    const ctx = new Context()
    const host = await mountHostRoutes(ctx, () => makeDiagnosticsRoutes(async () => inputs()))
    const answer = await host.json(HOST_ROUTES.diagnostics.view, { method: 'POST', body: {} })
    expect(answer.status).toBe(404)
  })
})
