import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
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
})
