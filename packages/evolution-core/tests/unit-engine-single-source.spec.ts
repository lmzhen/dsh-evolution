// @tier pre-tag
import { expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

it('keeps the generic unit engine in core and the merge protocol in merge', () => {
  const hits: string[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { visit(full); continue }
      if (!entry.name.endsWith('.ts')) continue
      const text = readFileSync(full, 'utf8')
      const rel = relative(root, full).split('\\').join('/')
      if (/export class (MutationUnit|MergeUnitTransactions)\b/.test(text)) hits.push(rel)
    }
  }
  visit(root)
  expect(hits).toEqual([
    'evolution-core/src/mutation-unit.ts',
    'evolution-merge/src/unit-protocol.ts',
  ])
  const commitExecute = readFileSync(join(root, 'evolution-merge/src/commit-execute.ts'), 'utf8')
  expect(commitExecute).toContain('options.unit ?? port.unit')
  expect(commitExecute).not.toContain('legacyUnitAdapter')
  const store = readFileSync(join(root, 'evolution-core/src/skill-store.ts'), 'utf8')
  const start = store.indexOf('private async applyTreeChange')
  const end = store.indexOf('async restoreFromArchive', start)
  expect(start).toBeGreaterThan(0)
  const body = store.slice(start, end)
  expect(body).toContain('new MutationUnit')
  expect(body).not.toContain('this.io.writeText')
  expect(body).not.toContain('this.io.remove')
})
