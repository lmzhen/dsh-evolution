// @tier pre-tag
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/0.30.15/fixture-manifest.json', import.meta.url)), 'utf8'))

it('declares the 0.30.15 fixture categories used by RG1', () => {
  expect(manifest.version).toBe('0.30.15')
  expect(manifest.files.length).toBeGreaterThanOrEqual(20)
  for (const prefix of ['state/', 'runs/', 'receipts/', 'journals/', 'unit-history/', 'staging/', 'corrupt/', 'sentinel/', 'real/']) {
    expect(manifest.files.some(file => file.path.startsWith(prefix)), prefix).toBe(true)
  }
  expect(manifest.realSample).toBe(true)
  expect(manifest.sampleKind).toBe('published-writer-output')
  for (const file of manifest.files) expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/)
})
