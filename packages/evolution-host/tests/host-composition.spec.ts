import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { HOST_ROW_IDS, MODEL_TOOL_NAMES } from '../../test-support/row-contract.ts'
import { insertedRows, rowId, rowIds, rowName } from '../../test-support/cordis-rows.ts'

const patch = loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
const rows = insertedRows(patch)

describe('evolution-host composition', () => {
  it('is a loader patch containing exactly the host-plane rows', () => {
    expect(rowIds(rows)).toEqual([...HOST_ROW_IDS])
  })

  it('registers no model-facing tools', () => {
    const names = new Set(rows.map(rowName))
    for (const name of MODEL_TOOL_NAMES) expect(names.has(name)).toBe(false)
  })

  it('keeps the storage-domain row dormant without a host storage-domain facility', () => {
    const domain = rows.find(row => rowId(row) === 'evolution-state-domain')
    expect(domain?.disabled).toBeDefined()
  })
})
