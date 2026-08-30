import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendEvolutionEvent, eventsFile, EVENT_LOG_RETAIN_ARCHIVES, nodeEvolutionIo, readEvolutionEvents, readEvolutionTimeline, retainEventArchives } from '@deepseek-ai/dsh-evolution-core'

describe('evolution event log (rc.68)', () => {
  it('appends with monotonic unique seq under concurrent writers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    await Promise.all(Array.from({ length: 8 }, (_, index) => appendEvolutionEvent(io, path, {
      type: 'feedback', target: `skill-${index % 2}`, kind: 'skill', rating: 'positive',
    })))
    const { events, malformed } = await readEvolutionEvents(io, path)
    expect(malformed).toBe(false)
    expect(events).toHaveLength(8)
    expect(new Set(events.map(event => event.seq))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(events.filter(event => event.type === 'feedback')).toHaveLength(8)
    await rm(root, { recursive: true, force: true })
  })

  it('a malformed log is never overwritten by an append (rc.65 posture)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-bad-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    await io.writeText(path, '{corrupt log')
    await expect(appendEvolutionEvent(io, path, {
      type: 'feedback', target: 'x', kind: 'skill', rating: 'positive',
    })).rejects.toThrow(/malformed/)
    expect(await io.readText(path)).toBe('{corrupt log')
    await rm(root, { recursive: true, force: true })
  })

  it('reads a missing log as empty and flags a malformed one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-read-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    expect(await readEvolutionEvents(io, path)).toEqual({ events: [], malformed: false })
    await io.writeText(path, 'not json')
    const read = await readEvolutionEvents(io, path)
    expect(read.malformed).toBe(true)
    expect(read.events).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('a whitespace-only log reads as empty and is rebuilt on append (rc.69)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-empty-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    await io.writeText(path, '')
    expect(await readEvolutionEvents(io, path)).toEqual({ events: [], malformed: false })
    await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })
    const { events, malformed } = await readEvolutionEvents(io, path)
    expect(malformed).toBe(false)
    expect(events).toHaveLength(1)
    expect(events[0]?.seq).toBe(1)
    await rm(root, { recursive: true, force: true })
  })

  it('shape-damaged content reads as empty (replaceable) and is rebuilt on append (rc.70 F-1)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-shape-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    await io.writeText(path, JSON.stringify({ version: 1, events: 42 }))
    // Read and append agree on the same boundary: shape damage = empty, not malformed.
    expect(await readEvolutionEvents(io, path)).toEqual({ events: [], malformed: false })
    await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })
    const { events, malformed } = await readEvolutionEvents(io, path)
    expect(malformed).toBe(false)
    expect(events).toHaveLength(1)
    await rm(root, { recursive: true, force: true })
  })

  it('a single damaged entry is dropped at append while valid entries survive (rc.70 F-1 self-heal)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-entry-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    await io.writeText(path, JSON.stringify({
      version: 1,
      events: [
        { seq: 1, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: 'good', kind: 'skill', rating: 'positive' },
        { broken: true },
      ],
    }))
    await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'negative' })
    const { events, malformed } = await readEvolutionEvents(io, path)
    expect(malformed).toBe(false)
    expect(events).toHaveLength(2)
    expect(events[0]?.target).toBe('good')
    expect(events[1]?.target).toBe('x')
    await rm(root, { recursive: true, force: true })
  })

  it('rotates the older half into an archive at the threshold and continues seqs (rc.71)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-rotate-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    for (let index = 0; index < 5; index += 1) {
      await appendEvolutionEvent(io, path, { type: 'feedback', target: `t${index}`, kind: 'skill', rating: 'positive' }, 3)
    }
    // Third append crossed the threshold: archive holds seq 1-2, active 3-5.
    const archiveRaw = await io.readText(join(root, 'evolution', 'events-2.json'))
    expect(archiveRaw).not.toBeNull()
    const archive = JSON.parse(archiveRaw ?? '{}') as { events: Array<{ seq: number }> }
    expect(archive.events.map(event => event.seq)).toEqual([1, 2])
    const active = await readEvolutionEvents(io, path)
    expect(active.events.map(event => event.seq)).toEqual([3, 4, 5])
    const timeline = await readEvolutionTimeline(io, path)
    expect(timeline.events.map(event => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(timeline.malformed).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('the timeline merge dedupes by seq (rotation crash window, rc.71)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-dedupe-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    // Crash window: the archive copy landed but the active rewrite did not —
    // both files carry seq 1-2 (archived head) while the active also has 3-4.
    await io.writeText(join(root, 'evolution', 'events-2.json'), JSON.stringify({ version: 1, events: [
      { seq: 1, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: 'a', kind: 'skill', rating: 'positive' },
      { seq: 2, at: '2026-01-01T00:00:01.000Z', type: 'feedback', target: 'b', kind: 'skill', rating: 'negative' },
    ] }, null, 2))
    await io.writeText(path, JSON.stringify({ version: 1, events: [
      { seq: 1, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: 'a', kind: 'skill', rating: 'positive' },
      { seq: 2, at: '2026-01-01T00:00:01.000Z', type: 'feedback', target: 'b', kind: 'skill', rating: 'negative' },
      { seq: 3, at: '2026-01-01T00:00:02.000Z', type: 'feedback', target: 'c', kind: 'skill', rating: 'positive' },
      { seq: 4, at: '2026-01-01T00:00:03.000Z', type: 'feedback', target: 'd', kind: 'skill', rating: 'positive' },
    ] }, null, 2))
    const timeline = await readEvolutionTimeline(io, path)
    expect(timeline.events.map(event => event.seq)).toEqual([1, 2, 3, 4])
    await rm(root, { recursive: true, force: true })
  })

  it('retention keeps the newest archives by NUMERIC seq (rc.71)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-retain-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    const dir = join(root, 'evolution')
    for (let index = 1; index <= EVENT_LOG_RETAIN_ARCHIVES + 2; index += 1) {
      await io.writeText(join(dir, `events-${index}.json`), JSON.stringify({ version: 1, events: [] }, null, 2))
    }
    await retainEventArchives(io, path)
    const stays = (await io.list(dir)).filter(name => name.startsWith('events-') && name.endsWith('.json'))
    expect(stays).toContain('events-3.json')
    expect(stays).toContain(`events-${EVENT_LOG_RETAIN_ARCHIVES + 2}.json`)
    expect(stays).not.toContain('events-1.json')
    expect(stays).not.toContain('events-2.json')
    await rm(root, { recursive: true, force: true })
  })

  it('a deleted active continues seqs FROM THE ARCHIVE ANCHOR, never shadowing history (rc.72 G-1)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-g1-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    const dir = join(root, 'evolution')
    // Archived history: seq 1. The active is GONE (deleted / whitespace residue).
    await io.writeText(join(dir, 'events-1.json'), JSON.stringify({ version: 1, events: [
      { seq: 1, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: 'old', kind: 'skill', rating: 'positive' },
    ] }, null, 2))
    await appendEvolutionEvent(io, path, { type: 'feedback', target: 'fresh', kind: 'skill', rating: 'negative' })
    const active = await readEvolutionEvents(io, path)
    expect(active.events.map(event => event.seq)).toEqual([2])
    const timeline = await readEvolutionTimeline(io, path)
    expect(timeline.events.map(event => event.seq)).toEqual([1, 2])
    expect(timeline.events[0]?.target).toBe('old')
    expect(timeline.events[1]?.target).toBe('fresh')
    await rm(root, { recursive: true, force: true })
  })

  it('rotateAt below 2 is a guarded no-op (rc.72 G-1)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-g1b-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    for (let index = 0; index < 2; index += 1) {
      await appendEvolutionEvent(io, path, { type: 'feedback', target: `t${index}`, kind: 'skill', rating: 'positive' }, 1)
    }
    // No rotation happened: no archive, seqs continue 1..2.
    expect((await io.list(join(root, 'evolution'))).filter(name => name.startsWith('events-'))).toEqual([])
    const active = await readEvolutionEvents(io, path)
    expect(active.events.map(event => event.seq)).toEqual([1, 2])
    await rm(root, { recursive: true, force: true })
  })

  it('non-numeric user files are neither read into the timeline nor pruned (rc.72 G-2)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-g2-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    const dir = join(root, 'evolution')
    // A user file under the same directory with a NON-numeric name.
    await io.writeText(join(dir, 'events-backup.json'), JSON.stringify({ version: 1, events: [
      { seq: 999, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: 'user-file', kind: 'skill', rating: 'positive' },
    ] }, null, 2))
    for (let index = 1; index <= EVENT_LOG_RETAIN_ARCHIVES + 2; index += 1) {
      await io.writeText(join(dir, `events-${index}.json`), JSON.stringify({ version: 1, events: [] }, null, 2))
    }
    await retainEventArchives(io, path)
    const stays = (await io.list(dir)).filter(name => name.startsWith('events-') && name.endsWith('.json'))
    expect(stays).not.toContain('events-1.json')
    expect(stays).not.toContain('events-2.json')
    expect(stays).toContain('events-backup.json')
    const timeline = await readEvolutionTimeline(io, path)
    expect(timeline.events.map(event => event.seq)).not.toContain(999)
    await rm(root, { recursive: true, force: true })
  })

  it('an unreadable archive (directory at a numeric name) flags but never bricks the boot (rc.72 G-2)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-events-eisdir-'))
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    const dir = join(root, 'evolution')
    // A DIRECTORY squatting on a numeric archive name: readText would throw EISDIR.
    await mkdir(join(dir, 'events-7.json'), { recursive: true })
    await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })
    const timeline = await readEvolutionTimeline(io, path)
    expect(timeline.malformed).toBe(true)
    expect(timeline.events).toHaveLength(1)
    await rm(root, { recursive: true, force: true })
  })
})
