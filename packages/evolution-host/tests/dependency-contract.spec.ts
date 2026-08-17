import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { insertedRows, rowName } from '../../test-support/cordis-rows.ts'

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}
const rows = insertedRows(loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))))
const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
])

describe('evolution-host dependency contract', () => {
  it('declares every row package in the bundle manifest', () => {
    for (const row of rows) {
      const name = rowName(row)
      if (name.startsWith('@deepseek-ai/')) expect(declared.has(name)).toBe(true)
    }
  })

  it('declares the bundle patch entry for profile resolution', () => {
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })
})
