// @tier fast
import { expect, it } from 'vitest'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { CatalogCapture } from '../src/catalog-codec.ts'
import { ProjectionJournal, type ProjectionJournalRecord } from '../src/projection-journal.ts'

class Io implements EvolutionIoLike {
  files = new Map<string, string>()
  reads = 0
  async readText(path: string): Promise<string | null> { this.reads += 1; return this.files.get(path) ?? null }
  async writeText(path: string, content: string): Promise<void> { this.files.set(path, content) }
  async remove(path: string): Promise<void> { this.files.delete(path) }
  async list(): Promise<string[]> { return [...this.files.keys()] }
  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async rename(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) { this.files.set(to, value); this.files.delete(from) } }
  async copy(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) this.files.set(to, value) }
}

const base = { text: '', source: {}, entries: [], update: false } as unknown as CatalogCapture
const record = (sessionId: string, viewKey: string, createdAt: number): ProjectionJournalRecord => ({ sessionId, viewKey, projectionDigest: 'd', codecVersion: '1', mapVersion: 'm', policyDigest: 'p', base, createdAt })

it('reads the journal file once and keeps concurrent writes', async () => {
  const io = new Io()
  const journal = new ProjectionJournal(io, 'journal.json')
  await Promise.all([
    journal.put(record('s', 'v1', 1)),
    journal.put(record('s', 'v2', 2)),
  ])
  expect(io.reads).toBe(1)
  expect(await journal.latest('s', 'v2', '1')).toMatchObject({ viewKey: 'v2' })
  expect(await journal.latest('s', 'v1', '1')).toMatchObject({ viewKey: 'v1' })
  expect(io.reads).toBe(1)
})

it('remove deletes only the exact record', async () => {
  const io = new Io()
  const journal = new ProjectionJournal(io, 'journal.json')
  await journal.put(record('s', 'v1', 1))
  await journal.remove('s', 'v1', 'd', '1')
  expect(await journal.get('s', 'v1', 'd', '1')).toBeUndefined()
})
it('removeView deletes every record for one session/view', async () => {
  const io = new Io()
  const journal = new ProjectionJournal(io, 'journal.json')
  await journal.put({ ...record('s', 'v1', 1), projectionDigest: 'one' })
  await journal.put({ ...record('s', 'v1', 2), projectionDigest: 'two' })
  await journal.put(record('s', 'v2', 3))
  await journal.removeView('s', 'v1', '1')
  expect(await journal.latest('s', 'v1', '1')).toBeUndefined()
  expect(await journal.latest('s', 'v2', '1')).toMatchObject({ viewKey: 'v2' })
})
