import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { HOST_ROW_IDS } from '../../test-support/row-contract.ts'
import { insertedRows, rowId, rowIds, rowName } from '../../test-support/cordis-rows.ts'

const patch = loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
const rows = insertedRows(patch)

describe('evolution-host composition', () => {
  it('is a loader patch containing exactly the host-plane rows', () => {
    expect(rowIds(rows)).toEqual([...HOST_ROW_IDS])
  })

  it('registers no model-facing tools', () => {
    const names = rows.map(rowName)
    expect(names).not.toContain('@deepseek-ai/dsh-tool-memory')
    expect(names).not.toContain('@deepseek-ai/dsh-tool-skill-manage')
    expect(names).not.toContain('@deepseek-ai/dsh-evolution-skill-catalog')
  })

  it('keeps the storage-domain row dormant without a host storage-domain facility', () => {
    const domain = rows.find(row => rowId(row) === 'evolution-state-domain')
    expect(domain?.disabled).toBeDefined()
  })
})
