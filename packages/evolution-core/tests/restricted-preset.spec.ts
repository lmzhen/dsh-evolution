import { describe, expect, it } from 'vitest'
import {
  composeRestrictedPresetDefinition,
  type PresetDocumentLike,
  type PresetRegistryLike,
} from '../src/composition/restricted-preset.ts'
import { disposeRestrictedPreset, ensureRestrictedPreset, restrictedPresetState } from '../src/composition/ensure.ts'
import { MAINTAINER_PRESET_ID, REVIEWER_PRESET_ID, RESTRICTED_TOOLS_ROW_ID } from '../src/composition/preset-ids.ts'

const PARENT: PresetDocumentLike = {
  agentPreset: 'standard',
  content: [
    "- id: persona",
    "  name: '@deepseek-ai/dsh-persona'",
    "- id: tool-skill",
    "  name: '@deepseek-ai/dsh-tool-skill'",
    "  config:",
    "    catalogDescriptionMaxLength: 60",
    '',
  ].join('\n'),
}

function fakeRegistry() {
  let registers = 0
  let releases = 0
  let failRead = false
  let failRegister = false
  const registry: PresetRegistryLike = {
    async readDocument(id: string) {
      if (failRead) throw new Error('read-boom')
      if (id !== 'standard') throw new Error('not-found')
      return PARENT
    },
    async register() {
      registers += 1
      if (failRegister) throw new Error('register-boom')
      return async () => { releases += 1 }
    },
  }
  return {
    registry,
    stats: () => ({ registers, releases }),
    failRead: (value: boolean) => { failRead = value },
    failRegister: (value: boolean) => { failRegister = value },
  }
}

function fakeCtx(registry: PresetRegistryLike | undefined) {
  const cleanups: Array<() => void> = []
  return {
    ctx: {
      get: (name: string) => (name === 'agentPresets' ? registry : undefined),
      effect: (run: () => () => void) => { const dispose = run(); cleanups.push(dispose); return () => {} },
    },
    cleanups,
  }
}

describe('restricted preset definition (G2-S4)', () => {
  it('clones the parent rows and appends exactly one restrictor row at the END', () => {
    const definition = composeRestrictedPresetDefinition(PARENT, { kind: 'reviewer', parentPresetId: 'standard', allow: [' tool-skill ', 'tool-skill', ''] })
    expect(definition.id).toBe(REVIEWER_PRESET_ID)
    expect(definition.order).toBe(900)
    expect(definition.plugins).toHaveLength(3)
    expect(definition.plugins[0]).toEqual({ id: 'persona', name: '@deepseek-ai/dsh-persona' })
    expect(definition.plugins[1]).toMatchObject({ id: 'tool-skill', config: { catalogDescriptionMaxLength: 60 } })
    expect(definition.plugins[2]).toEqual({ id: RESTRICTED_TOOLS_ROW_ID, name: expect.stringContaining('/dsh-evolution-core/restrictor'), config: { allow: ['tool-skill'], presetId: REVIEWER_PRESET_ID } })
  })

  it('uses the maintainer identity/order for the maintenance channel', () => {
    const definition = composeRestrictedPresetDefinition(PARENT, { kind: 'maintainer', parentPresetId: 'standard', allow: ['tool-skill'] })
    expect(definition.id).toBe(MAINTAINER_PRESET_ID)
    expect(definition.order).toBe(901)
  })

  it('fails loud with E-324 when the allow set is empty', () => {
    expect(() => composeRestrictedPresetDefinition(PARENT, { kind: 'reviewer', parentPresetId: 'standard', allow: ['  '] })).toThrow(/E-324/)
  })
})

describe('ensureRestrictedPreset lifecycle (G2-S5 skeleton)', () => {
  it('registers once, then hits for the same (parent, allow) key', async () => {
    const fake = fakeRegistry()
    const { ctx } = fakeCtx(fake.registry)
    const first = await ensureRestrictedPreset(ctx as never, { kind: 'reviewer', parentPresetId: 'standard', allow: ['tool-skill'] })
    const second = await ensureRestrictedPreset(ctx as never, { kind: 'reviewer', parentPresetId: 'standard', allow: [' tool-skill '] })
    expect(first).toMatchObject({ kind: 'ready', presetId: REVIEWER_PRESET_ID })
    expect(second).toMatchObject({ kind: 'ready' })
    expect(fake.stats()).toEqual({ registers: 1, releases: 0 })
  })

  it('releases the old registration and re-registers when the allow set changes', async () => {
    const fake = fakeRegistry()
    const { ctx } = fakeCtx(fake.registry)
    await ensureRestrictedPreset(ctx as never, { kind: 'reviewer', parentPresetId: 'standard', allow: ['tool-skill'] })
    await ensureRestrictedPreset(ctx as never, { kind: 'reviewer', parentPresetId: 'standard', allow: ['tool-skill', 'evolution_memory'] })
    expect(fake.stats()).toEqual({ registers: 2, releases: 1 })
  })

  it('reports failed E-324 when readDocument or register fails, and stays retryable', async () => {
    const fake = fakeRegistry()
    const { ctx } = fakeCtx(fake.registry)
    fake.failRead(true)
    expect(await ensureRestrictedPreset(ctx as never, { kind: 'reviewer', parentPresetId: 'standard', allow: ['tool-skill'] })).toMatchObject({ kind: 'failed', code: 'E-324' })
    fake.failRead(false)
    fake.failRegister(true)
    expect(await ensureRestrictedPreset(ctx as never, { kind: 'reviewer', parentPresetId: 'standard', allow: ['tool-skill'] })).toMatchObject({ kind: 'failed', code: 'E-324' })
    fake.failRegister(false)
    expect(await ensureRestrictedPreset(ctx as never, { kind: 'reviewer', parentPresetId: 'standard', allow: ['tool-skill'] })).toMatchObject({ kind: 'ready' })
  })

  it('reports E-324 when the agentPresets service is missing', async () => {
    const { ctx } = fakeCtx(undefined)
    expect(await ensureRestrictedPreset(ctx as never, { kind: 'reviewer', parentPresetId: 'standard', allow: ['tool-skill'] })).toMatchObject({ kind: 'failed', code: 'E-324' })
  })

  it('disposes the registration and exposes the current state', async () => {
    const fake = fakeRegistry()
    const { ctx } = fakeCtx(fake.registry)
    await ensureRestrictedPreset(ctx as never, { kind: 'reviewer', parentPresetId: 'standard', allow: ['tool-skill'] })
    expect(restrictedPresetState(ctx as never, 'reviewer')).toMatchObject({ kind: 'ready' })
    await disposeRestrictedPreset(ctx as never, 'reviewer')
    expect(fake.stats().releases).toBe(1)
    expect(restrictedPresetState(ctx as never, 'reviewer')).toBeUndefined()
  })
})
