import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import {
  AGENT_EVOLUTION_ROW_IDS,
  AGENT_EVOLUTION_ROW_NAMES,
  HOST_ROW_IDS,
} from '../../test-support/row-contract.ts'
import { cordisRows, rowId, rowIds, rowName } from '../../test-support/cordis-rows.ts'

const rows = cordisRows(loadOverlayPatches('test', fileURLToPath(new URL('../agent.cordis.yml', import.meta.url))))

describe('evolution-agent row contract', () => {
  it('adds exactly the stable model-tool rows to the standard preset', () => {
    const evolutionNames = new Set<string>(Object.values(AGENT_EVOLUTION_ROW_NAMES))
    const evolution = rows.filter(row => evolutionNames.has(rowName(row)))
    expect(evolution.map(rowId)).toEqual([...AGENT_EVOLUTION_ROW_IDS])
  })

  it('maps stable model-tool ids to their published names', () => {
    for (const id of AGENT_EVOLUTION_ROW_IDS) {
      expect(rows.find(row => rowId(row) === id)?.name).toBe(AGENT_EVOLUTION_ROW_NAMES[id])
    }
  })

  it('owns no host service rows', () => {
    const ids = new Set(rowIds(rows))
    for (const id of HOST_ROW_IDS) expect(ids.has(id)).toBe(false)
  })
})
