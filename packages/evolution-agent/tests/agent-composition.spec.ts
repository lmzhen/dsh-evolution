import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const rows = loadOverlayPatches('test', fileURLToPath(new URL('../agent.cordis.yml', import.meta.url))) as any[]
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

  it('ships preset metadata for the roster', () => {
    expect(preset).toContain('name: Evolution')
    expect(preset).toContain('Standard coding agent')
  })
})
