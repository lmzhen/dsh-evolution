import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cordisRows, rowId, rowName } from '../../test-support/cordis-rows.ts'

const rows = cordisRows(loadOverlayPatches('test', fileURLToPath(new URL('../agent.cordis.yml', import.meta.url))))
const upstream = cordisRows(loadOverlayPatches('test', fileURLToPath(new URL('../../../../apps/cli/config/agent-presets/standard/agent.cordis.yml', import.meta.url))))
const preset = readFileSync(fileURLToPath(new URL('../preset.yml', import.meta.url)), 'utf8')

describe('evolution-agent composition', () => {
  it('is an agent entry list, not a patch', () => {
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.some(row => 'insert' in row)).toBe(false)
  })

  it('adds exactly the evolution model tools to the standard preset', () => {
    const evolution = rows.filter(row => [
      '@deepseek-ai/dsh-tool-memory',
      '@deepseek-ai/dsh-tool-skill-manage',
      '@deepseek-ai/dsh-evolution-skill-catalog',
    ].includes(rowName(row)))
    expect(evolution.map(rowId)).toEqual([
      'tool-memory',
      'tool-skill-manage',
      'evolution-skill-catalog',
    ])
  })

  it('does not publish host-plane services from the agent layer', () => {
    const names = rows.map(rowName)
    expect(names).not.toContain('@deepseek-ai/dsh-memory')
    expect(names).not.toContain('@deepseek-ai/dsh-memory-files')
    expect(names).not.toContain('@deepseek-ai/dsh-skill-usage')
    expect(names).not.toContain('@deepseek-ai/dsh-evolution-state')
    expect(names).not.toContain('@deepseek-ai/dsh-evolution-approval')
  })

  it('keeps every upstream standard row byte-for-byte', () => {
    const upstreamById = new Map(upstream.map(row => [rowId(row), JSON.stringify(row)]))
    const evolutionNames = new Set([
      '@deepseek-ai/dsh-tool-memory',
      '@deepseek-ai/dsh-tool-skill-manage',
      '@deepseek-ai/dsh-evolution-skill-catalog',
    ])
    const standardRows = rows.filter(row => !evolutionNames.has(rowName(row)))
    expect(standardRows).toHaveLength(upstream.length)
    for (const row of standardRows) {
      expect(upstreamById.get(rowId(row))).toBe(JSON.stringify(row))
    }
  })

  it('ships preset metadata for the roster', () => {
    expect(preset).toContain('name: Evolution')
    expect(preset).toContain('Standard coding agent')
  })
})
