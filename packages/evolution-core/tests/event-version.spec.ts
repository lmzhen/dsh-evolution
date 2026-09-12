import { describe, expect, it } from 'vitest'
import { appendEvolutionEvent, eventsFile, nodeEvolutionIo, parseEvolutionEvents, readEvolutionEvents } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

/**
 * F-338: the event-log reader is v1-ONLY. A future-format body (`version !==
 * EVENT_LOG_VERSION`) must not be silently shaped as v1 by the reader NOR
 * rewritten back down to v1 by the append path. This guards a future v2 log
 * from being mis-parsed and overwritten by a v1 writer.
 */
describe('event log version guard (F-338)', () => {
  const v1Events = [
    { seq: 1, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: 'a', kind: 'skill', rating: 'positive' },
    { seq: 2, at: '2026-01-01T00:00:01.000Z', type: 'feedback', target: 'b', kind: 'skill', rating: 'negative' },
  ]

  it('parseEvolutionEvents reads a v1 body normally', () => {
    const raw = JSON.stringify({ version: 1, events: v1Events })
    const events = parseEvolutionEvents(raw)
    expect(events).toHaveLength(2)
    expect(events[0]?.seq).toBe(1)
  })

  it('parseEvolutionEvents reads a missing/undefined version as legacy v1', () => {
    const raw = JSON.stringify({ events: v1Events })
    const events = parseEvolutionEvents(raw)
    expect(events).toHaveLength(2)
  })

  it('parseEvolutionEvents returns [] for a future-version body (F-338)', () => {
    const raw = JSON.stringify({ version: 999, events: v1Events })
    expect(parseEvolutionEvents(raw)).toEqual([])
  })

  it('readEvolutionEvents treats a future-version body as empty, not malformed (F-338)', async () => {
    const root = await tempRoot('dsh-evo-events-ver-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    await io.writeText(path, JSON.stringify({ version: 999, events: v1Events }, null, 2))
    const read = await readEvolutionEvents(io, path)
    expect(read).toEqual({ events: [], malformed: false })
  })

  it('appendEvolutionEvent rejects a future-version body and preserves the bytes (F-338)', async () => {
    const root = await tempRoot('dsh-evo-events-ver-append-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    const future = JSON.stringify({ version: 999, events: v1Events }, null, 2)
    await io.writeText(path, future)
    await expect(appendEvolutionEvent(io, path, {
      type: 'feedback', target: 'x', kind: 'skill', rating: 'positive',
    })).rejects.toThrow(/version mismatch/)
    // The v2 bytes are untouched — never rewritten down to v1.
    expect(await io.readText(path)).toBe(future)
  })

  it('reports the version TYPE so a string body does not read as a numeric match (V4-48)', async () => {
    const root = await tempRoot('dsh-evo-events-ver-str-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    // The SAME digit as a string is refused (v1-only guard compares the number);
    // the message must name the type instead of saying "found 1, expected 1".
    const body = JSON.stringify({ version: '1', events: v1Events }, null, 2)
    await io.writeText(path, body)
    await expect(appendEvolutionEvent(io, path, {
      type: 'feedback', target: 'x', kind: 'skill', rating: 'positive',
    })).rejects.toThrow(/got "1" \(string\)/)
    // The bytes are untouched — never rewritten down to v1.
    expect(await io.readText(path)).toBe(body)
  })

  it('a v1 body still appends normally (F-338 does not break the happy path)', async () => {
    const root = await tempRoot('dsh-evo-events-ver-happy-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    const seq = await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })
    expect(seq).toBe(1)
    const { events, malformed } = await readEvolutionEvents(io, path)
    expect(malformed).toBe(false)
    expect(events).toHaveLength(1)
    expect(events[0]?.seq).toBe(seq)
  })
})
