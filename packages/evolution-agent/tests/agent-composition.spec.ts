import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
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

// 0.2.x (G6): the four `preset*.yml` metadata files are GONE. A declarative
// preset row carries its own display copy — the platform looks a non-shipped id
// up in no dictionary and renders the row's literal `name`/`description`
// (`packages/preset/agent-preset-registry/src/display.ts`) — so the family keeps
// one table for id, display copy and precondition instead of four files:
// `bases.json`, the SAME table install-layered.mjs and /evolution preset install read.
const table = JSON.parse(readFileSync(fileURLToPath(new URL('../bases.json', import.meta.url)), 'utf8')) as {
  default?: string
  bases?: Array<{
    name?: string
    id?: string
    display?: { name?: string; description?: string; order?: number }
    requires?: { service?: string }
    metadata?: unknown
  }>
  metadata?: unknown
}
const bases = table.bases ?? []
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  files?: string[]
  exports?: Record<string, string>
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

  it('carries one display copy per base, and no metadata file behind it', () => {
    expect(table.default).toBe('standard')
    expect(bases.length).toBeGreaterThan(0)
    // The four `preset*.yml` files are gone (0.2.x reads the row, not a file):
    // a `metadata` field reappearing here means a second source of truth is back.
    expect(table.metadata).toBeUndefined()
    for (const base of bases) {
      expect(base.metadata).toBeUndefined()
      expect(typeof base.name).toBe('string')
      expect(typeof base.id).toBe('string')
      expect(base.id?.startsWith('evolution')).toBe(true)
      expect(typeof base.display?.name).toBe('string')
      expect(typeof base.display?.description).toBe('string')
      expect(typeof base.display?.order).toBe('number')
    }
    // Ids and display names are what the picker lists: duplicates would render
    // two presets a user cannot tell apart, or two rows claiming one id.
    for (const key of ['id', 'name'] as const) {
      const values = bases.map(base => (key === 'id' ? base.id : base.display?.name))
      expect(new Set(values).size).toBe(values.length)
    }
    const orders = bases.map(base => base.display?.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('names the ptc variant after the platform base it is composed on', () => {
    const ptc = bases.find(base => base.name === 'ptc')
    expect(ptc?.display?.name).toBe('Evolution PTC')
    expect(ptc?.display?.description).toContain('Based on the platform ptc preset')
    expect(ptc?.display?.description).toContain('family rows')
    // The variant lists after the family's default preset and after the
    // platform's own shipped presets, never claiming their names.
    const standard = bases.find(base => base.name === 'standard')
    expect(Number(ptc?.display?.order)).toBeGreaterThan(Number(standard?.display?.order))
    expect(ptc?.display?.name).not.toBe(standard?.display?.name)
  })

  it('publishes bases.json and no preset*.yml from the package', () => {
    // The installer reads the table out of THIS package; a file left out of the
    // files/exports lists disappears from the published tarball, and a scoped
    // install then has no base table to compose from.
    expect(manifest.files).toContain('bases.json')
    expect(manifest.exports?.['./bases.json']).toBe('./bases.json')
    const deadFiles = (manifest.files ?? []).filter(file => /^preset.*\.ya?ml$/.test(file))
    expect(deadFiles).toEqual([])
    const deadExports = Object.keys(manifest.exports ?? {}).filter(key => /preset.*\.ya?ml$/.test(key))
    expect(deadExports).toEqual([])
  })
})
