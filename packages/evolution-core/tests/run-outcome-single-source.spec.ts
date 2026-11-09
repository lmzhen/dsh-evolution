// @tier pre-tag
import { expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

it('declares RunOutcome only in the contract', () => {
  const hits: string[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { visit(full); continue }
      if (!entry.name.endsWith('.ts')) continue
      const text = readFileSync(full, 'utf8')
      if (/(?:export\s+)?(?:interface|type)\s+RunOutcome\b/.test(text)) hits.push(relative(root, full).split('\\').join('/'))
    }
  }
  visit(root)
  expect(hits).toEqual(['evolution-contract/src/index.ts'])
})
