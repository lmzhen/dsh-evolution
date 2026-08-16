import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'

const hostPatch = loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))) as any[]

describe('profile override composition', () => {
  it('applies user overrides after the host bundle without mutating it', () => {
    const rows = composeEntries([
      hostPatch,
      [
        { id: 'evolution-review', disabled: true },
        { id: 'evolution-approval', config: { enabled: true, stageForeground: false } },
        { id: 'memory-files', config: { root: '/srv/agent-data/memories' } },
      ],
    ])
    expect(rows.find((row: any) => row.id === 'evolution-review')?.disabled).toBe(true)
    expect(rows.find((row: any) => row.id === 'evolution-approval')?.config).toMatchObject({ enabled: true, stageForeground: false })
    expect(rows.find((row: any) => row.id === 'memory-files')?.config).toMatchObject({ root: '/srv/agent-data/memories' })
    // The source patch object is not mutated by composition.
    expect((hostPatch[0]!.insert as any[]).find((row: any) => row.id === 'evolution-review')?.disabled).toBeUndefined()
  })
})
