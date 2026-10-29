// @tier fast
import { describe, expect, it } from 'vitest'
import { sep } from 'node:path'
import { readUnitJournal, unitJournalPort, unitSnapshotPort, type EvolutionIoLike, type MutationJournalRecord, type MutationSnapshot } from '@deepseek-ai/dsh-evolution-core'

class MemoryIo implements EvolutionIoLike {
  readonly files = new Map<string, string>()
  async readText(path: string): Promise<string | null> { return this.files.get(path) ?? null }
  async writeText(path: string, content: string): Promise<void> { this.files.set(path, content) }
  async remove(path: string): Promise<void> { this.files.delete(path) }
  async list(path: string): Promise<string[]> {
    const prefix = path.endsWith(sep) ? path : path + sep
    return [...this.files.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length))
  }
  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async rename(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) { this.files.delete(from); this.files.set(to, value) } }
  async copy(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) this.files.set(to, value) }
}

const HOME = 'D:/home'
const SNAP: MutationSnapshot = {
  unitId: 'u-1',
  state: 'committed',
  createdAt: 1,
  ops: [
    { target: 'D:/skills/source/SKILL.md', before: 'old', after: 'new', skill: 'source' },
    { target: 'D:/skills/source/references/a.md', before: null, after: 'a', skill: 'source' },
  ],
}

describe('unit storage adapters', () => {
  it('round-trips a tree-change snapshot through UnitSnapshot', async () => {
    const io = new MemoryIo()
    const port = unitSnapshotPort(io, HOME)
    await port.write(SNAP)
    const read = await port.read('u-1')
    expect(read).toEqual(SNAP)
  })

  it('persists undone state', async () => {
    const io = new MemoryIo()
    const port = unitSnapshotPort(io, HOME)
    await port.write({ ...SNAP, state: 'undone' })
    expect((await port.read('u-1'))?.state).toBe('undone')
  })

  it('lists only prepared tree-change snapshots for boot recovery', async () => {
    const io = new MemoryIo()
    const port = unitSnapshotPort(io, HOME)
    await port.write({ ...SNAP, unitId: 'prepared', state: 'prepared' })
    await port.write({ ...SNAP, unitId: 'committed', state: 'committed' })
    const prepared = await port.listPrepared?.() ?? []
    expect(prepared.map(item => item.unitId)).toEqual(['prepared'])
  })

  it('writes the shared unit journal, not a second store', async () => {
    const io = new MemoryIo()
    const port = unitJournalPort(io, HOME)
    const record: MutationJournalRecord = { unitId: 'u-1', phase: 'committed', changed: ['D:/skills/source/SKILL.md'] }
    await port.write(record)
    const journal = await readUnitJournal(io, HOME, 'u-1')
    expect(journal?.unitId).toBe('u-1')
    expect(journal?.phase).toBe('committed')
  })

  it('maps undone to the journal rolled-back phase', async () => {
    const io = new MemoryIo()
    const port = unitJournalPort(io, HOME)
    await port.write({ unitId: 'u-2', phase: 'undone', changed: [] })
    expect((await readUnitJournal(io, HOME, 'u-2'))?.phase).toBe('rolled-back')
  })
})
