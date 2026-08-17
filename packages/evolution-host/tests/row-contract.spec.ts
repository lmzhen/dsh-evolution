import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import {
  AGENT_EVOLUTION_ROW_IDS,
  HOST_ROW_IDS,
  HOST_ROW_NAMES,
  MODEL_TOOL_NAMES,
} from '../../test-support/row-contract.ts'
import { insertedRows, rowId, rowIds, rowName } from '../../test-support/cordis-rows.ts'

const rows = insertedRows(loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))))

describe('evolution-host row contract', () => {
  it('exposes exactly the stable host row ids in order', () => {
    expect(rowIds(rows)).toEqual([...HOST_ROW_IDS])
  })

  it('resolves every stable row id to its published package name', () => {
    for (const id of HOST_ROW_IDS) {
      expect(rows.find(row => rowId(row) === id)?.name).toBe(HOST_ROW_NAMES[id])
    }
  })

  it('never registers model-facing tools', () => {
    for (const name of MODEL_TOOL_NAMES) {
      expect(rows.some(row => rowName(row) === name)).toBe(false)
    }
  })

  it('keeps model-tool ids outside the host contract', () => {
    for (const id of AGENT_EVOLUTION_ROW_IDS) {
      expect(rows.some(row => rowId(row) === id)).toBe(false)
    }
  })
})
