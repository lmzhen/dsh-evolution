import { describe, expect, it } from 'vitest'
import {
  EVOLUTION_PRESET_IDS,
  MAINTAINER_PRESET_ID,
  RESTRICTED_PRESET_DISPLAY,
  RESTRICTED_TOOLS_ROW_ID,
  REVIEWER_PRESET_ID,
} from '../src/composition/index.ts'
import { createSubagentChannel, subagentChannelState } from '../src/subagent/index.ts'
import { EVOLUTION_ERRORS, errorText } from '../src/errors.ts'
import * as coreRoot from '../src/index.ts'
import {
  DIAGNOSTICS_FACT_KEYS,
  DIAGNOSTICS_RUNTIME_KEYS,
  DIAGNOSTICS_VIEW_SCHEMA_VERSION,
} from '../src/diagnostics.ts'
import { HOST_ROUTES, MAX_REQUEST_BODY_BYTES, hostSurface, json, methodNotAllowed } from '../src/http-routes.ts'

describe('G0 frozen contracts', () => {
  it('freezes the user preset ids and the restricted preset ids', () => {
    expect(EVOLUTION_PRESET_IDS).toEqual(['evolution', 'evolution-ptc', 'evolution-cordis', 'evolution-minimal'])
    expect(REVIEWER_PRESET_ID).toBe('evolution-reviewer-readonly')
    expect(MAINTAINER_PRESET_ID).toBe('evolution-maintainer-readonly')
    expect(RESTRICTED_TOOLS_ROW_ID).toBe('evolution-restricted-tools')
    expect(RESTRICTED_PRESET_DISPLAY.reviewer.order).toBe(900)
    expect(RESTRICTED_PRESET_DISPLAY.maintainer.order).toBe(901)
  })

  it('freezes the host route table at 4 surfaces / 12 endpoints under the /api prefix', () => {
    const surfaces = Object.values(HOST_ROUTES)
    expect(surfaces).toHaveLength(4)
    const paths = surfaces.flatMap(surface => Object.values(surface))
    expect(paths).toHaveLength(12)
    for (const path of paths) expect(path.startsWith('/api/dsh-evolution/')).toBe(true)
    expect(MAX_REQUEST_BODY_BYTES).toBe(64 * 1024)
  })

  it('exposes the host surface as unavailable without a connection service (E-325)', () => {
    const fakeCtx = { get: () => undefined }
    expect(hostSurface(fakeCtx as never)).toEqual({ available: false, code: 'E-325', reason: 'connection-missing' })
  })

  it('reports the subagent channel contract as unavailable until G3 implements the lifecycle', () => {
    const fakeCtx = { get: () => undefined }
    expect(createSubagentChannel(fakeCtx as never).state).toMatchObject({ kind: 'unavailable', code: 'E-323' })
    expect(subagentChannelState(fakeCtx as never, 'reviewer')).toMatchObject({ kind: 'unavailable', code: 'E-323' })
  })

  it('keeps the composer off the package root (single source is /composition)', () => {
    expect('composePresetEntry' in coreRoot).toBe(false)
  })

  it('freezes the diagnostics view key set (7 facts + 8 runtime rows, schemaVersion 2)', () => {
    expect(DIAGNOSTICS_VIEW_SCHEMA_VERSION).toBe(2)
    expect(DIAGNOSTICS_FACT_KEYS).toHaveLength(7)
    expect(DIAGNOSTICS_RUNTIME_KEYS).toHaveLength(8)
    expect(new Set(DIAGNOSTICS_FACT_KEYS).size).toBe(7)
    expect(new Set(DIAGNOSTICS_RUNTIME_KEYS).size).toBe(8)
  })

  it('freezes the channel and host-plane error codes with repair guidance', () => {
    expect(EVOLUTION_ERRORS['e-323-subagent-channel-unavailable']).toMatch(/^E-323: /)
    expect(EVOLUTION_ERRORS['e-324-restricted-preset-unavailable']).toMatch(/^E-324: /)
    expect(EVOLUTION_ERRORS['e-325-host-data-plane-unavailable']).toMatch(/^E-325: /)
    expect(errorText('e-324-restricted-preset-unavailable', { a1: 'restrictor-mount-failed' })).toContain('restrictor-mount-failed')
  })

  it('provides the shared JSON response helpers', () => {
    expect(json(200, { ok: true }).status).toBe(200)
    expect(methodNotAllowed(['GET']).status).toBe(405)
  })
})
