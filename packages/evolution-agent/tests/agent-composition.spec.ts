import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { cordisRows, rowId, rowName } from '../../test-support/cordis-rows.ts'
import { AGENT_EVOLUTION_ROW_NAMES } from '../../test-support/row-contract.ts'

// rc.53: `agent.cordis.yml` is now the DELTA only (the four evolution rows).
// The installed preset = runtime platform `standard` rows + this delta,
// assembled by install-layered.mjs at install time — so the preset follows
// whatever platform version the user has (rc, release, future) instead of
// vendoring one baseline's rows forever. The full assembly (standard rows
// verbatim + delta) is asserted end-to-end by evolution-host's installer.spec.
const rows = cordisRows(loadOverlayPatches('test', fileURLToPath(new URL('../agent.cordis.yml', import.meta.url))))
const preset = readFileSync(fileURLToPath(new URL('../preset.yml', import.meta.url)), 'utf8')
// The PTC variant's display metadata. It is a SECOND metadata file, not a
// second package: the composition (the delta) is base-independent, so only the
// metadata differs between `--base standard` and `--base ptc`
// (AGENT_PRESET_BASES in packages/scripts/install-layered.mjs).
const ptcPreset = readFileSync(fileURLToPath(new URL('../preset.ptc.yml', import.meta.url)), 'utf8')
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  files?: string[]
  exports?: Record<string, string>
}

/** The `key: value` pairs of one preset metadata file (`preset.yml` is flat). */
function metadataFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^([a-z]+):\s*(.+)$/.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) fields[match[1]] = match[2].trim()
  }
  return fields
}

/**
 * The platform's shipped `ptc` metadata, resolved by walking up to
 * `packages/preset/agent-presets/presets` the way the installer resolves it.
 * The family suite runs inside the platform monorepo, so this is the real
 * runtime text the variant must NOT duplicate.
 * @returns the shipped ptc preset metadata, or undefined when no platform preset
 * root is reachable (the family mirror run without the platform tree).
 */
function shippedPtcMetadata(): Record<string, string> | undefined {
  let dir = fileURLToPath(new URL('.', import.meta.url))
  for (;;) {
    const candidate = join(dir, 'packages', 'preset', 'agent-presets', 'presets', 'ptc', 'preset.yml')
    if (existsSync(candidate)) return metadataFields(readFileSync(candidate, 'utf8'))
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

describe('evolution-agent composition', () => {
  it('is an agent entry list, not a patch', () => {
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.some(row => 'insert' in row)).toBe(false)
  })

  it('adds exactly the evolution model tools to the standard preset', () => {
    const ids = rows.map(rowId)
    expect(ids).toEqual([
      'tool-memory',
      'tool-skill-manage',
      'tool-session-query',
      'evolution-skill-catalog',
    ])
    for (const row of rows) {
      expect(Object.values(AGENT_EVOLUTION_ROW_NAMES)).toContain(rowName(row))
    }
  })

  it('does not publish host-plane services from the agent layer', () => {
    const names = rows.map(rowName)
    expect(names).not.toContain('@deepseek-ai/dsh-memory')
    expect(names).not.toContain('@deepseek-ai/dsh-memory-files')
    expect(names).not.toContain('@deepseek-ai/dsh-skill-usage')
    expect(names).not.toContain('@deepseek-ai/dsh-evolution-state')
    expect(names).not.toContain('@deepseek-ai/dsh-evolution-approval')
  })

  it('carries no standard rows of its own', () => {
    // The delta is evolution-only: every row id it declares is an evolution
    // row. A standard row lingering here would be vendored again.
    expect(rows.every(row => Object.values(AGENT_EVOLUTION_ROW_NAMES).includes(rowName(row)))).toBe(true)
  })

  it('ships preset metadata for the roster', () => {
    expect(preset).toContain('name: Evolution')
    expect(preset).toContain('Standard coding agent')
  })

  it('ships PTC variant metadata that names the base it is composed on', () => {
    const variant = metadataFields(ptcPreset)
    expect(variant.name).toBe('Evolution PTC')
    expect(variant.description).toContain('Based on the platform ptc preset')
    expect(variant.description).toContain('family rows')
    expect(variant.order).toBe('11')
  })

  it('publishes variant metadata distinct from both the standard base and the shipped ptc preset', () => {
    const variant = metadataFields(ptcPreset)
    const standard = metadataFields(preset)
    // Distinct from the family's own standard-base metadata: a roster row that
    // repeated it would list two presets a user cannot tell apart.
    expect(variant.name).not.toBe(standard.name)
    expect(variant.description).not.toBe(standard.description)
    // Distinct from the PLATFORM's shipped ptc metadata, which the platform
    // resolves through its own localized copy keys before our file is read:
    // the variant lists after the family preset and never claims its name/order.
    const shipped = shippedPtcMetadata()
    if (shipped !== undefined) {
      expect(variant.name).not.toBe(shipped.name)
      expect(variant.order).not.toBe(shipped.order)
      expect(variant.description).not.toBe(shipped.description)
      expect(Number(variant.order)).toBeGreaterThan(Number(shipped.order))
    }
  })

  it('ships and exports the variant metadata (the installer reads it from this package)', () => {
    // The installer copies the metadata its base table names
    // (AGENT_PRESET_BASES.<base>.metadata) out of THIS package. A file left out
    // of the files/exports lists disappears from the published tarball and a
    // scoped install then has no metadata to write.
    expect(manifest.files).toContain('preset.ptc.yml')
    expect(manifest.files).toContain('preset.yml')
    expect(manifest.exports?.['./preset.ptc.yml']).toBe('./preset.ptc.yml')
  })
})
