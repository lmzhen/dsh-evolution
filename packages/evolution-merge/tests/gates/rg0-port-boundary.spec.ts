// @tier pre-tag
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const src = root + '/src'

it('RG0 adapters may use only their declared raw methods', () => {
  const files = readdirSync(src, { recursive: true }).map(String).filter(name => name.endsWith('.ts'))
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/')
    const source = readFileSync(src + '/' + file, 'utf8')
    if (normalized === 'adapters/library.ts') {
      expect(source, file).not.toContain('skills.commitMerge')
      expect(source, file).not.toContain('applyTreeChange(')
      expect(source, file).not.toContain('skills.archive(')
      expect(source, file).not.toContain('restoreFromArchive(')
      expect(source, file).not.toContain('skills.update(')
      expect(source, file).not.toContain('skills.writeSupportFile(')
      expect(source, file).not.toContain('skills.removeSupportFile(')
      continue
    }
    if (normalized === 'adapters/undo.ts') {
      expect(source, file).toContain('skills.archive(')
      expect(source, file).toContain('restoreFromArchive(')
      expect(source, file).toContain('skills.update(')
      expect(source, file).toContain('skills.writeSupportFile(')
      expect(source, file).toContain('skills.removeSupportFile(')
      expect(source, file).not.toContain('skills.commitMerge')
      expect(source, file).not.toContain('applyTreeChange(')
      continue
    }
    expect(source, file).not.toContain('applyTreeChange(')
    expect(source, file).not.toContain('skills.archive(')
    expect(source, file).not.toContain('restoreFromArchive(')
    expect(source, file).not.toContain('skills.update(')
    expect(source, file).not.toContain('skills.writeSupportFile(')
    expect(source, file).not.toContain('skills.removeSupportFile(')
    expect(source, file).not.toContain('skills.commitMerge')
  }
})

it('RG0 core UnitBackend is the only commitMerge adapter', () => {
  const source = readFileSync(root + '/../evolution-core/src/unit-backend.ts', 'utf8')
  expect(source).toContain('skills.commitMerge')
})

it('RG0 core owner modules exist', () => {
  for (const path of ['../evolution-core/src/run-registry.ts', '../evolution-core/src/tree-lock.ts', '../evolution-core/src/skill-store.ts']) {
    expect(existsSync(root + '/' + path), path).toBe(true)
  }
})
