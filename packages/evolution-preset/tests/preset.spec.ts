import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'

const patch = loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))) as any[]
const standalone = loadOverlayPatches('test', fileURLToPath(new URL('../cordis.yml', import.meta.url))) as any[]

describe('evolution-preset composition boundary', () => {
  it('uses the loader patch vocabulary for bundle patches', () => {
    expect(patch).toHaveLength(1)
    expect(Array.isArray(patch[0]!.insert)).toBe(true)
    for (const row of patch[0]!.insert) {
      expect(typeof row.id).toBe('string')
      expect(typeof row.name).toBe('string')
    }
  })

  it('keeps the standalone root config as an entry list', () => {
    expect(Array.isArray(standalone)).toBe(true)
    expect(standalone.some((row: any) => 'insert' in row)).toBe(false)
    for (const row of standalone) {
      expect(typeof row.id).toBe('string')
      expect(typeof row.name).toBe('string')
    }
  })

  it('has unique row ids in both forms', () => {
    const patchIds = patch[0]!.insert.map((row: any) => row.id)
    const standaloneIds = standalone.map((row: any) => row.id)
    expect(new Set(patchIds).size).toBe(patchIds.length)
    expect(new Set(standaloneIds).size).toBe(standaloneIds.length)
  })

  it('keeps the storage-domain row dormant when the host has no storage-domain facility', () => {
    const domain = patch[0]!.insert.find((row: any) => row.id === 'evolution-state-domain')
    expect(domain?.disabled).toBeDefined()
  })
})
