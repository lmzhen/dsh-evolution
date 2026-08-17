import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { cordisRows, insertedRows, rowId } from '../../test-support/cordis-rows.ts'

const hostPatch = loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
const hostRows = insertedRows(hostPatch)

describe('profile override composition', () => {
  it('applies user overrides after the host bundle without mutating it', () => {
    const rows = cordisRows(composeEntries([
      hostPatch,
      [
        { id: 'evolution-review', disabled: true },
        { id: 'evolution-approval', config: { enabled: true, stageForeground: false } },
        { id: 'memory-files', config: { root: '/srv/agent-data/memories' } },
      ],
    ]))
    expect(rows.find(row => rowId(row) === 'evolution-review')?.disabled).toBe(true)
    expect(rows.find(row => rowId(row) === 'evolution-approval')?.config).toMatchObject({ enabled: true, stageForeground: false })
    expect(rows.find(row => rowId(row) === 'memory-files')?.config).toMatchObject({ root: '/srv/agent-data/memories' })
    expect(hostRows.find(row => rowId(row) === 'evolution-review')?.disabled).toBeUndefined()
  })
})
