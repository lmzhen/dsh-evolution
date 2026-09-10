import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import {
  AGENT_EVOLUTION_ROW_IDS,
  AGENT_EVOLUTION_ROW_NAMES,
  HOST_ROW_IDS,
} from '../../test-support/row-contract.ts'
import { cordisRows, pinnedRowIds, rowId, rowIds } from '../../test-support/cordis-rows.ts'

const rows = cordisRows(loadOverlayPatches('test', fileURLToPath(new URL('../agent.cordis.yml', import.meta.url))))

describe('evolution-agent row contract', () => {
  it('adds exactly the stable model-tool rows to the standard preset', () => {
    // v21 (T-2): pin the delta's TOTAL row-id list (pinnedRowIds also fails
    // on an id-less row) instead of filtering BY the expected names — the old
    // form could only see rows it already knew, so a newly added 5th family
    // row passed "exactly" unnoticed. A deliberate delta-row addition updates
    // AGENT_EVOLUTION_ROW_IDS (the compatibility contract) in the same diff.
    expect(pinnedRowIds(rows)).toEqual([...AGENT_EVOLUTION_ROW_IDS])
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
