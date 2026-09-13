import { describe, expect, it } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { appendEvolutionEvent, eventsFile, EVENT_LOG_RETAIN_ARCHIVES, evolutionEventPayloadIssue, nodeEvolutionIo, readEvolutionEvents, readEvolutionTimeline, retainEventArchives } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

describe('evolution event log (rc.68)', () => {
  it('appends with monotonic unique seq under concurrent writers', async () => {
    const root = await tempRoot('dsh-evo-events-')
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
  })

  it('a malformed log is never overwritten by an append (rc.65 posture)', async () => {
    const root = await tempRoot('dsh-evo-events-bad-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    await io.writeText(path, '{corrupt log')
    await expect(appendEvolutionEvent(io, path, {
      type: 'feedback', target: 'x', kind: 'skill', rating: 'positive',
    })).rejects.toThrow(/malformed/)
    expect(await io.readText(path)).toBe('{corrupt log')
  })

  it('reads a missing log as empty and flags a malformed one', async () => {
    const root = await tempRoot('dsh-evo-events-read-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    expect(await readEvolutionEvents(io, path)).toEqual({ events: [], malformed: false })
    await io.writeText(path, 'not json')
    const read = await readEvolutionEvents(io, path)
    expect(read.malformed).toBe(true)
    expect(read.events).toEqual([])
  })

  it('a whitespace-only log reads as empty and is rebuilt on append (rc.69)', async () => {
    const root = await tempRoot('dsh-evo-events-empty-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    await io.writeText(path, '')
    expect(await readEvolutionEvents(io, path)).toEqual({ events: [], malformed: false })
    await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })
    const { events, malformed } = await readEvolutionEvents(io, path)
    expect(malformed).toBe(false)
    expect(events).toHaveLength(1)
    expect(events[0]?.seq).toBe(1)
  })

  it('shape-damaged content reads as empty (replaceable) and is rebuilt on append (rc.70 F-1)', async () => {
    const root = await tempRoot('dsh-evo-events-shape-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    await io.writeText(path, JSON.stringify({ version: 1, events: 42 }))
    // Read and append agree on the same boundary: shape damage = empty, not malformed.
    expect(await readEvolutionEvents(io, path)).toEqual({ events: [], malformed: false })
    await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })
    const { events, malformed } = await readEvolutionEvents(io, path)
    expect(malformed).toBe(false)
    expect(events).toHaveLength(1)
  })

  it('a single damaged entry is dropped at append while valid entries survive (rc.70 F-1 self-heal)', async () => {
    const root = await tempRoot('dsh-evo-events-entry-')
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
  })

  it('rotates the older half into an archive at the threshold and continues seqs (rc.71)', async () => {
    const root = await tempRoot('dsh-evo-events-rotate-')
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
  })

  it('the timeline merge dedupes by seq (rotation crash window, rc.71)', async () => {
    const root = await tempRoot('dsh-evo-events-dedupe-')
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
  })

  it('retention keeps the newest archives by NUMERIC seq (rc.71)', async () => {
    const root = await tempRoot('dsh-evo-events-retain-')
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
  })

  it('a deleted active continues seqs FROM THE ARCHIVE ANCHOR, never shadowing history (rc.72 G-1)', async () => {
    const root = await tempRoot('dsh-evo-events-g1-')
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
  })

  it('rotateAt below 2 is a guarded no-op (rc.72 G-1)', async () => {
    const root = await tempRoot('dsh-evo-events-g1b-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    for (let index = 0; index < 2; index += 1) {
      await appendEvolutionEvent(io, path, { type: 'feedback', target: `t${index}`, kind: 'skill', rating: 'positive' }, 1)
    }
    // No rotation happened: no archive, seqs continue 1..2.
    expect((await io.list(join(root, 'evolution'))).filter(name => name.startsWith('events-'))).toEqual([])
    const active = await readEvolutionEvents(io, path)
    expect(active.events.map(event => event.seq)).toEqual([1, 2])
  })

  it('non-numeric user files are neither read into the timeline nor pruned (rc.72 G-2)', async () => {
    const root = await tempRoot('dsh-evo-events-g2-')
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
  })

  it('an unreadable archive (directory at a numeric name) flags but never bricks the boot (rc.72 G-2)', async () => {
    const root = await tempRoot('dsh-evo-events-eisdir-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    const dir = join(root, 'evolution')
    // A DIRECTORY squatting on a numeric archive name: readText would throw EISDIR.
    await mkdir(join(dir, 'events-7.json'), { recursive: true })
    await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })
    const timeline = await readEvolutionTimeline(io, path)
    expect(timeline.malformed).toBe(true)
    expect(timeline.events).toHaveLength(1)
  })

  it('C-05: a non-finite seq (1e400 parses to Infinity) is dropped as a damaged record', async () => {
    const root = await tempRoot('dsh-evo-events-inf-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    // 1e400 is valid JSON but parses to Infinity — the old bare typeof check
    // let it through (a Map key that never dedupes, a comparator that never
    // orders); Number.isFinite closes it. Standard JSON cannot carry NaN, so
    // the overflow literal is the real-world carrier.
    await io.writeText(path, '{"version":1,"events":[{"seq":1,"type":"feedback"},{"seq":1e400,"type":"feedback"}]}')
    const read = await readEvolutionEvents(io, path)
    expect(read.malformed).toBe(false)
    expect(read.events.map(event => event.seq)).toEqual([1])
    // The append continues AFTER the highest finite seq and drops the damaged
    // record on the rewrite (rc.70 F-1 self-heal semantics).
    const assigned = await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })
    expect(assigned).toBe(2)
    const after = await readEvolutionEvents(io, path)
    expect(after.events.map(event => event.seq)).toEqual([1, 2])
  })

  it('I-5 (v18): refuses an unfoldable payload at the durable write boundary', async () => {
    const root = await tempRoot('dsh-evo-events-guard-')
    const io = nodeEvolutionIo()
    const path = eventsFile(root)
    await expect(appendEvolutionEvent(io, path, { type: 'feedback', target: 'x' } as never)).rejects.toThrow(/requires kind/)
    await expect(appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill' } as never)).rejects.toThrow(/requires rating/)
    await expect(appendEvolutionEvent(io, path, { type: 'maintain' } as never)).rejects.toThrow(/requires runId/)
    await expect(appendEvolutionEvent(io, path, { type: 'nope' } as never)).rejects.toThrow(/unknown event type/)
    // A well-formed record still appends; the refusals wrote nothing.
    expect(await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })).toBe(1)
  })
})

it('v31 EVENTS-01: a rotation whose archive name collides MERGES both seq bands instead of overwriting', async () => {
  const root = await tempRoot('dsh-evo-events-collide-')
  const io = nodeEvolutionIo()
  const path = eventsFile(root)
  const dir = join(root, 'evolution')
  // The post-rollback state: the ACTIVE was rolled back to seq 1..4 (rotateAt
  // 4), while the name this rotation computes — events-2.json (anchor =
  // tail[0].seq 3 - 1) — already holds a DIFFERENT band (11..12). The fixtures
  // live BESIDE the active log: the first version of this test wrote them to
  // the temp root, so no rotation ran and the merge path stayed untested.
  const event = (seq: number) => ({ seq, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: `t${seq}`, kind: 'skill', rating: 'positive' })
  await io.writeText(join(dir, 'events-2.json'), JSON.stringify({ version: 1, events: [event(11), event(12)] }, null, 2))
  await io.writeText(path, JSON.stringify({ version: 1, events: [event(1), event(2), event(3), event(4)] }, null, 2))
  expect(await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' }, 4)).toBe(5)

  const archive = JSON.parse(await io.readText(join(dir, 'events-2.json')) ?? '{}') as { version: number; events: Array<{ seq: number }> }
  // Both bands survive the collision (merged, not overwritten) ...
  expect(archive.version).toBe(1)
  expect(archive.events.map(entry => entry.seq)).toEqual([1, 2, 11, 12])
  // ... and the rotated head band is still in the logical timeline.
  const timeline = await readEvolutionTimeline(io, path)
  expect(timeline.events.map(entry => entry.seq)).toEqual([1, 2, 3, 4, 5, 11, 12])
})

it('P2-11 (v37): a rotation colliding with a FUTURE-format archive is refused, never downgraded', async () => {
  const root = await tempRoot('dsh-evo-events-collide-v2-')
  const io = nodeEvolutionIo()
  const path = eventsFile(root)
  const dir = join(root, 'evolution')
  const event = (seq: number) => ({ seq, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: `t${seq}`, kind: 'skill', rating: 'positive' })
  const active = JSON.stringify({ version: 1, events: [event(1), event(2), event(3), event(4)] }, null, 2)
  // A version-2 archive squatting the name this rotation computes: the merge
  // used to rewrite it as version 1 and drop every v2-only field.
  const v2 = JSON.stringify({ version: 2, events: [event(11), event(12)], v2Only: { compacted: true } }, null, 2)
  await io.writeText(join(dir, 'events-2.json'), v2)
  await io.writeText(path, active)
  await expect(appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' }, 4)).rejects.toThrow(/collision/)

  // Both files keep their bytes, no band left the timeline, and no shift-aside
  // artifact was minted.
  expect(await io.readText(join(dir, 'events-2.json'))).toBe(v2)
  expect(await io.readText(path)).toBe(active)
  expect((await io.list(dir)).filter(name => name.endsWith('.collide'))).toEqual([])
})

it('P2-11 (v37): a collision with an archive whose "events" container is gone is refused, not emptied', async () => {
  const root = await tempRoot('dsh-evo-events-collide-records-')
  const io = nodeEvolutionIo()
  const path = eventsFile(root)
  const dir = join(root, 'evolution')
  const event = (seq: number) => ({ seq, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: `t${seq}`, kind: 'skill', rating: 'positive' })
  await io.writeText(path, JSON.stringify({ version: 1, events: [event(1), event(2), event(3), event(4)] }, null, 2))
  // v2 renamed the container AND a current-version body lost its array: both
  // used to merge with prior=[] and REPLACE the archive with just the head band.
  for (const body of [
    JSON.stringify({ version: 2, records: [event(11), event(12)] }, null, 2),
    JSON.stringify({ version: 1, records: [event(11), event(12)] }, null, 2),
  ]) {
    await io.writeText(join(dir, 'events-2.json'), body)
    await expect(appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' }, 4)).rejects.toThrow(/collision/)
    expect(await io.readText(join(dir, 'events-2.json'))).toBe(body)
  }
})

it('P2-10 (v37): a feedback event without a NON-EMPTY target is refused at the durable boundary', async () => {
  const root = await tempRoot('dsh-evo-events-target-')
  const io = nodeEvolutionIo()
  const path = eventsFile(root)
  // The only folder (evolution-feedback applyFeedbackEvent) returns silently on
  // an undefined target, and `target: ''` folds a phantom '' key — neither may
  // reach the log.
  expect(evolutionEventPayloadIssue({ type: 'feedback', kind: 'skill', rating: 'positive' })).toMatch(/non-empty target/)
  expect(evolutionEventPayloadIssue({ type: 'feedback', target: '', kind: 'skill', rating: 'positive' })).toMatch(/non-empty target/)
  expect(evolutionEventPayloadIssue({ type: 'feedback', target: '   ', kind: 'skill', rating: 'positive' })).toMatch(/non-empty target/)
  expect(evolutionEventPayloadIssue({ type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })).toBeNull()
  await expect(appendEvolutionEvent(io, path, { type: 'feedback', kind: 'skill', rating: 'positive' } as never)).rejects.toThrow(/non-empty target/)
  await expect(appendEvolutionEvent(io, path, { type: 'feedback', target: '', kind: 'skill', rating: 'positive' } as never)).rejects.toThrow(/non-empty target/)
  // Nothing was persisted and no phantom record was minted ...
  expect(await io.readText(path)).toBeNull()
  // ... while a well-formed feedback still appends.
  expect(await appendEvolutionEvent(io, path, { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })).toBe(1)
})
