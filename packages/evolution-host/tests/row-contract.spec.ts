import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import {
  AGENT_EVOLUTION_ROW_IDS,
  HOST_ROW_IDS,
  HOST_ROW_NAMES,
  MODEL_TOOL_NAMES,
} from '../../test-support/row-contract.ts'

const rows = (loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))) as any[])[0]!.insert as any[]

describe('evolution-host row contract', () => {
  it('exposes exactly the stable host row ids in order', () => {
    expect(rows.map((row: any) => row.id)).toEqual([...HOST_ROW_IDS])
  })

  it('resolves every stable row id to its published package name', () => {
    for (const id of HOST_ROW_IDS) {
      expect(rows.find((row: any) => row.id === id)?.name).toBe(HOST_ROW_NAMES[id])
    }
  })

  it('never registers model-facing tools', () => {
    for (const name of MODEL_TOOL_NAMES) {
      expect(rows.some((row: any) => row.name === name)).toBe(false)
    }
  })

  it('keeps model-tool ids outside the host contract', () => {
    for (const id of AGENT_EVOLUTION_ROW_IDS) {
      expect(rows.some((row: any) => row.id === id)).toBe(false)
    }
  })
})
