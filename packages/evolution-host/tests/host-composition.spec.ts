// @tier ci-only
import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { HOST_ROW_IDS, MODEL_TOOL_NAMES } from '../../test-support/row-contract.ts'
import { insertedRows, pinnedRowIds, rowId, rowName } from '../../test-support/cordis-rows.ts'

const patch = loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
const rows = insertedRows(patch)

describe('evolution-host composition', () => {
  it('is a loader patch containing exactly the host-plane rows', () => {
    // v21 (T-3): pinnedRowIds surfaces an id-less row as '<no-id>' — the old
    // rowIds() silently dropped it, so an "exactly" pin could not see the
    // addition (nor a malformed row).
    expect(pinnedRowIds(rows)).toEqual([...HOST_ROW_IDS])
  })

  it('registers no model-facing tools', () => {
    const names = new Set(rows.map(rowName))
    for (const name of MODEL_TOOL_NAMES) expect(names.has(name)).toBe(false)
    // v21 (T-2 sibling): the host bundle's one DECLARED model-facing surface
    // is the maintenance_probe row — pin it to exactly one mount so a second
    // diagnostic (or a copy) cannot ride in unnoticed.
    const maintenanceRows = rows.filter(row => rowId(row) === 'evolution-maintenance-tools')
    expect(maintenanceRows).toHaveLength(1)
  })

  it('ships the storage-domain provider enabled, pinned on the state row (G8-B2)', () => {
    const domain = rows.find(row => rowId(row) === 'evolution-state-domain')
    expect(domain?.disabled).toBeUndefined()
    const state = rows.find(row => rowId(row) === 'evolution-state')
    expect(JSON.stringify(state?.config)).toContain('domain')
  })
})
