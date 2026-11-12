// @tier pre-tag
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

it('registers guidance and snapshot with interpolate:false', () => {
  const source = readFileSync(fileURLToPath(new URL('../../src/tools/index.ts', import.meta.url)), 'utf8')
  expect(source).toContain('text: () => snapshotText,\n      interpolate: false,')
  expect(source).toContain('text: MEMORY_GUIDANCE,\n      interpolate: false,')
})
