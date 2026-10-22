// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { journalPath, readJournal, writeJournal } from '../src/domain/commit-journal-store.ts'

function io() {
  const files = new Map<string, string>()
  return {
    files,
    async readText(p: string) { return files.get(p) ?? null },
    async writeText(p: string, c: string) { files.set(p, c) },
    async remove(p: string) { files.delete(p) },
    async list() { return [...files.keys()] },
    async exists(p: string) { return files.has(p) },
    async rename(p: string, q: string) { const c = files.get(p); files.delete(p); if (c !== undefined) files.set(q, c) },
    async copy(p: string, q: string) { const c = files.get(p); if (c !== undefined) files.set(q, c) },
  }
}

it('writes and reads a durable journal under merge/journals', async () => {
  const store = io()
  const journal = { runId: 'run/1', target: 't', create: false, sources: ['s'], phase: 'prepared' as const, updatedAt: 'x' }
  const path = await writeJournal(store, 'H', journal)
  assert.equal(path, journalPath('H', 'run/1'))
  assert.deepEqual(await readJournal(store, 'H', 'run/1'), journal)
})
