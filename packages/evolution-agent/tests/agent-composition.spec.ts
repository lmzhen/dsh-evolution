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
const preset = readFileSync(fileURLToPath(new URL('../preset.yml', import.meta.url)), 'utf8')

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
})
