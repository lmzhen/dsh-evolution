import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import {
  AGENT_EVOLUTION_ROW_IDS,
  AGENT_EVOLUTION_ROW_NAMES,
  HOST_ROW_IDS,
} from '../../test-support/row-contract.ts'

const rows = loadOverlayPatches('test', fileURLToPath(new URL('../agent.cordis.yml', import.meta.url))) as any[]

describe('evolution-agent row contract', () => {
  it('adds exactly the stable model-tool rows to the standard preset', () => {
    const evolution = rows.filter((row: any) => Object.values(AGENT_EVOLUTION_ROW_NAMES).includes(row.name))
    expect(evolution.map((row: any) => row.id)).toEqual([...AGENT_EVOLUTION_ROW_IDS])
  })

  it('maps stable model-tool ids to their published names', () => {
    for (const id of AGENT_EVOLUTION_ROW_IDS) {
      expect(rows.find((row: any) => row.id === id)?.name).toBe(AGENT_EVOLUTION_ROW_NAMES[id])
    }
  })

  it('owns no host service rows', () => {
    const ids = new Set(rows.map((row: any) => row.id))
    for (const id of HOST_ROW_IDS) expect(ids.has(id)).toBe(false)
  })
})
