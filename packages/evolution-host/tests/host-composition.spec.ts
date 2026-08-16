import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'

const patch = loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))) as any[]

const HOST_ROWS = [
  'evolution-policy',
  'evolution-io',
  'evolution-io-node',
  'evolution-state-storage',
  'evolution-state-domain',
  'evolution-state-json',
  'evolution-state',
  'memory',
  'memory-files',
  'skill-usage',
  'evolution-approval',
  'evolution-threat',
  'evolution-review',
  'evolution-curator',
  'evolution-commands',
  'evolution-activity',
  'evolution-feedback',
  'evolution-learning-graph',
  'evolution-replay',
]

describe('evolution-host composition', () => {
  it('is a loader patch containing exactly the host-plane rows', () => {
    expect(patch).toHaveLength(1)
    const rows = patch[0]!.insert as any[]
    expect(rows.map((row: any) => row.id)).toEqual(HOST_ROWS)
  })

  it('registers no model-facing tools', () => {
    const names = (patch[0]!.insert as any[]).map((row: any) => row.name)
    expect(names).not.toContain('@deepseek-ai/dsh-tool-memory')
    expect(names).not.toContain('@deepseek-ai/dsh-tool-skill-manage')
    expect(names).not.toContain('@deepseek-ai/dsh-evolution-skill-catalog')
  })

  it('keeps the storage-domain row dormant without a host storage-domain facility', () => {
    const domain = (patch[0]!.insert as any[]).find((row: any) => row.id === 'evolution-state-domain')
    expect(domain?.disabled).toBeDefined()
  })
})
