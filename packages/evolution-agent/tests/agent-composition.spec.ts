import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const rows = loadOverlayPatches('test', fileURLToPath(new URL('../agent.cordis.yml', import.meta.url))) as any[]
const upstream = loadOverlayPatches('test', fileURLToPath(new URL('../../../../apps/cli/config/agent-presets/standard/agent.cordis.yml', import.meta.url))) as any[]
const preset = readFileSync(fileURLToPath(new URL('../preset.yml', import.meta.url)), 'utf8')

describe('evolution-agent composition', () => {
  it('is an agent entry list, not a patch', () => {
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.some((row: any) => 'insert' in row)).toBe(false)
  })

  it('adds exactly the evolution model tools to the standard preset', () => {
    const evolution = rows.filter((row: any) => [
      '@deepseek-ai/dsh-tool-memory',
      '@deepseek-ai/dsh-tool-skill-manage',
      '@deepseek-ai/dsh-evolution-skill-catalog',
    ].includes(row.name))
    expect(evolution.map((row: any) => row.id)).toEqual([
      'tool-memory',
      'tool-skill-manage',
      'evolution-skill-catalog',
    ])
  })

  it('does not publish host-plane services from the agent layer', () => {
    const names = rows.map((row: any) => row.name)
    expect(names).not.toContain('@deepseek-ai/dsh-memory')
    expect(names).not.toContain('@deepseek-ai/dsh-memory-files')
    expect(names).not.toContain('@deepseek-ai/dsh-skill-usage')
    expect(names).not.toContain('@deepseek-ai/dsh-evolution-state')
    expect(names).not.toContain('@deepseek-ai/dsh-evolution-approval')
  })

  it('keeps every upstream standard row byte-for-byte', () => {
    const upstreamById = new Map(upstream.map((row: any) => [row.id, JSON.stringify(row)]))
    const evolutionNames = new Set([
      '@deepseek-ai/dsh-tool-memory',
      '@deepseek-ai/dsh-tool-skill-manage',
      '@deepseek-ai/dsh-evolution-skill-catalog',
    ])
    const standardRows = rows.filter((row: any) => !evolutionNames.has(row.name))
    expect(standardRows).toHaveLength(upstream.length)
    for (const row of standardRows) {
      expect(upstreamById.get(row.id)).toBe(JSON.stringify(row))
    }
  })

  it('ships preset metadata for the roster', () => {
    expect(preset).toContain('name: Evolution')
    expect(preset).toContain('Standard coding agent')
  })
})
