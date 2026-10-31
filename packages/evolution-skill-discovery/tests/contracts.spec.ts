import { describe, expect, it } from 'vitest'
import { DISCOVERY_STAGES, V0_DISCOVERY_FEATURES, canClassifyAtCreate, mayAdvance, stageIndex } from '../src/index.ts'

describe('feature and stage contracts', () => {
  it('v0 keeps projection/search/create classification off', () => {
    expect(V0_DISCOVERY_FEATURES).toMatchObject({ projectionEnabled: false, searchEnabled: false, createClassificationEnabled: false, discoveryMode: 'off' })
    expect(canClassifyAtCreate(V0_DISCOVERY_FEATURES, true)).toBe(false)
    expect(canClassifyAtCreate({ ...V0_DISCOVERY_FEATURES, createClassificationEnabled: true }, false)).toBe(false)
    expect(canClassifyAtCreate({ ...V0_DISCOVERY_FEATURES, createClassificationEnabled: true }, true)).toBe(true)
  })

  it('stage order only advances one step at a time', () => {
    expect(stageIndex(DISCOVERY_STAGES[0])).toBe(0)
    expect(mayAdvance('G0-projection', 'G1-domain')).toBe(true)
    expect(mayAdvance('G0-projection', 'G2-projection')).toBe(false)
    expect(mayAdvance('G7-migration', 'G8-release')).toBe(true)
  })
})
