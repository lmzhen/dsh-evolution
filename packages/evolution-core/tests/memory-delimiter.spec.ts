import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENTRY_DELIMITER, MemoryStore } from '@deepseek-ai/dsh-evolution-core'

/**
 * F-201: a fact carrying the on-disk entry delimiter (or ending in `\n§`) would
 * split into multiple entries on read-back, and a delimiter-ending fact is
 * PERMANENT drift (`render(entries)!==raw` bricks every later write). Both
 * `add` and `applyBatch` must refuse such facts up front, naming the position,
 * and leave the on-disk bytes untouched.
 */
describe('memory entry-delimiter defense (F-201)', () => {
  it('add refuses a fact ending in a delimiter fragment and leaves the file unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-memory-delim-end-'))
    const store = new MemoryStore({ root })
    expect((await store.add('memory', 'alpha')).ok).toBe(true)
    const before = await readFile(join(root, 'MEMORY.md'), 'utf8')
    const result = await store.add('memory', `x${ENTRY_DELIMITER.trimEnd()}`) // "x\n§"
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Operation 1 (add)')
    expect(result.message).toContain('entry delimiter (§)')
    expect(result.message).toContain('rewrite it as separate facts')
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toBe(before)
    await rm(root, { recursive: true, force: true })
  })

  it('add refuses a fact containing the delimiter mid-body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-memory-delim-mid-'))
    const store = new MemoryStore({ root })
    const result = await store.add('memory', `first${ENTRY_DELIMITER}second`)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Operation 1 (add)')
    expect(result.message).toContain('entry delimiter (§)')
    await rm(root, { recursive: true, force: true })
  })

  it('applyBatch add refuses a delimiter fact, names its position, and keeps the file unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-memory-delim-batch-'))
    const store = new MemoryStore({ root })
    await store.add('memory', 'alpha')
    const before = await readFile(join(root, 'MEMORY.md'), 'utf8')
    const result = await store.applyBatch('memory', [
      { action: 'add', facts: 'ok fact' },
      { action: 'add', facts: `x${ENTRY_DELIMITER}` },
    ])
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Operation 2 (add)')
    expect(result.message).toContain('entry delimiter (§)')
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toBe(before)
    await rm(root, { recursive: true, force: true })
  })

  it('applyBatch replace refuses a delimiter fact and names its position', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-memory-delim-replace-'))
    const store = new MemoryStore({ root })
    await store.add('memory', 'alpha fact')
    const before = await readFile(join(root, 'MEMORY.md'), 'utf8')
    const result = await store.applyBatch('memory', [
      { action: 'replace', old_text: 'alpha', facts: `bad${ENTRY_DELIMITER}value` },
    ])
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Operation 1 (replace)')
    expect(result.message).toContain('entry delimiter (§)')
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toBe(before)
    await rm(root, { recursive: true, force: true })
  })

  it('a delimiting fact never reaches the store, so no entry is created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-memory-delim-nostate-'))
    const store = new MemoryStore({ root })
    await store.add('memory', `a${ENTRY_DELIMITER}b`)
    expect(await store.read('memory')).toEqual([])
    await rm(root, { recursive: true, force: true })
  })
})
