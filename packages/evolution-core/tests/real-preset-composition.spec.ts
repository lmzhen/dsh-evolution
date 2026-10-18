// A-level spike regression: the parent document is REAL content captured from the installed
// @deepseek-ai/dsh@0.2.1-rc.2 app via `agentPresets.readDocument('standard')` (isolated home,
// probe boot on 19399). The fixture pins the exact YAML dialect the platform serves, so a
// platform change to readDocument's shape/dialect fails this spec instead of the runtime.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RESTRICTED_TOOLS_ROW_ID, RESTRICTOR_MODULE, restrictedPresetId } from '../src/composition/preset-ids.ts'
import { composeRestrictedPresetDefinition, parsePresetRows } from '../src/composition/restricted-preset.ts'

const content = readFileSync(new URL('./fixtures/agent-preset-standard.0.2.1-rc.2.yml', import.meta.url), 'utf8')

describe('real 0.2.1 parent preset composition (S1 spike, A-level fixture)', () => {
  it('parses the platform-served parent document as a top-level entry list', () => {
    const rows = parsePresetRows(content)
    expect(rows.length).toBeGreaterThan(0)
    const last = rows[rows.length - 1] as Record<string, unknown>
    expect(typeof last).toBe('object')
  })

  it('clones every parent row and appends the restrictor row LAST', () => {
    const rows = parsePresetRows(content)
    const definition = composeRestrictedPresetDefinition(
      { agentPreset: 'standard', content },
      { kind: 'reviewer', parentPresetId: 'standard', allow: ['skill'] },
    )
    expect(definition.id).toBe(restrictedPresetId('reviewer'))
    expect(definition.plugins).toHaveLength(rows.length + 1)
    expect(definition.plugins.slice(0, -1)).toEqual(rows)
    const last = definition.plugins[definition.plugins.length - 1] as Record<string, unknown>
    expect(last['id']).toBe(RESTRICTED_TOOLS_ROW_ID)
    expect(last['name']).toBe(RESTRICTOR_MODULE)
    expect(last['config']).toEqual({ allow: ['skill'], presetId: restrictedPresetId('reviewer') })
  })

  it('refuses an empty allow set (E-324) instead of composing an unrestricted clone', () => {
    expect(() => composeRestrictedPresetDefinition(
      { agentPreset: 'standard', content },
      { kind: 'reviewer', parentPresetId: 'standard', allow: [] },
    )).toThrow(/E-324/)
  })
})
