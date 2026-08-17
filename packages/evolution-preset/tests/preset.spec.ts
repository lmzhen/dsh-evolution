import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { COMPAT_CONTAINS_ROW_IDS } from '../../test-support/row-contract.ts'
import { cordisRows, insertedRows, rowId, rowIds } from '../../test-support/cordis-rows.ts'

const patch = cordisRows(loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))))
const standalone = cordisRows(loadOverlayPatches('test', fileURLToPath(new URL('../cordis.yml', import.meta.url))))
const insert = insertedRows(patch)

describe('evolution-preset composition boundary', () => {
  it('uses the loader patch vocabulary for bundle patches', () => {
    expect(patch).toHaveLength(1)
    expect(patch[0]?.insert).toBeDefined()
    for (const row of insert) {
      expect(typeof row.id).toBe('string')
      expect(typeof row.name).toBe('string')
    }
  })

  it('keeps the standalone root config as an entry list', () => {
    expect(Array.isArray(standalone)).toBe(true)
    expect(standalone.some(row => 'insert' in row)).toBe(false)
    for (const row of standalone) {
      expect(typeof row.id).toBe('string')
      expect(typeof row.name).toBe('string')
    }
  })

  it('has unique row ids in both forms', () => {
    const patchIds = rowIds(insert)
    const standaloneIds = rowIds(standalone)
    expect(new Set(patchIds).size).toBe(patchIds.length)
    expect(new Set(standaloneIds).size).toBe(standaloneIds.length)
  })

  it('keeps the storage-domain row dormant when the host has no storage-domain facility', () => {
    const domain = insert.find(row => rowId(row) === 'evolution-state-domain')
    expect(domain?.disabled).toBeDefined()
  })

  it('stays synchronized with the host and agent layer split', () => {
    const presetIds = new Set(rowIds(insert))
    for (const id of COMPAT_CONTAINS_ROW_IDS) expect(presetIds.has(id)).toBe(true)
  })
})
