import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AGENT_EVOLUTION_ROW_NAMES } from '../../test-support/row-contract.ts'
import { cordisRows, rowIds } from '../../test-support/cordis-rows.ts'

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}
const rows = cordisRows(loadOverlayPatches('test', fileURLToPath(new URL('../agent.cordis.yml', import.meta.url))))
const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
])

describe('evolution-agent dependency contract', () => {
  it('declares every evolution tool package in the preset manifest', () => {
    for (const name of Object.values(AGENT_EVOLUTION_ROW_NAMES)) {
      expect(declared.has(name)).toBe(true)
    }
  })

  it('does not declare host-plane packages as runtime dependencies', () => {
    for (const name of [
      '@deepseek-ai/dsh-memory',
      '@deepseek-ai/dsh-memory-files',
      '@deepseek-ai/dsh-skill-usage',
      '@deepseek-ai/dsh-evolution-state',
      '@deepseek-ai/dsh-evolution-approval',
    ]) {
      expect(manifest.dependencies?.[name]).toBeUndefined()
    }
  })

  it('keeps every row id unique in the full preset', () => {
    const ids = rowIds(rows)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
