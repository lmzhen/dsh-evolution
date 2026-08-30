import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendEvolutionEvent, eventsFile, nodeEvolutionIo, readEvolutionEvents } from '@deepseek-ai/dsh-evolution-core'

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
})
