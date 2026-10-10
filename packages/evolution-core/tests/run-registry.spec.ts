import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_RUN_RECORDS, RUNS_SCHEMA_VERSION, newRunRegistry, nodeEvolutionIo, runsFile } from '../src/index.ts'

const roots: string[] = []
async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-run-registry-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
})

describe('core run registry (S2)', () => {
  it('tracks a run from begin to settle, and the handle signal is the one it aborts', async () => {
    const dir = await home()
    const registry = newRunRegistry({ io: nodeEvolutionIo(), home: dir })
    await registry.load()
    const handle = await registry.begin('maintain')
    expect(handle.kind).toBe('maintain')
    expect(handle.startedAt).toBeGreaterThan(0)
    expect(handle.signal.aborted).toBe(false)
    expect(registry.inFlight()?.id).toBe(handle.id)
    expect(registry.lastSettledAt()).toBeUndefined()
    await registry.settle(handle.id, { state: 'succeeded', resultRef: join(dir, 'reports', 'maintain-x.json') })
    expect(registry.inFlight()).toBeUndefined()
    expect(registry.find(handle.id)).toMatchObject({ state: 'succeeded', resultRef: join(dir, 'reports', 'maintain-x.json') })
    expect(typeof registry.lastSettledAt()).toBe('number')
  })

  it('one terminal state: a settle after a cancel cannot flip the answer the operator read', async () => {
    const dir = await home()
    const registry = newRunRegistry({ io: nodeEvolutionIo(), home: dir })
    await registry.load()
    const handle = await registry.begin('maintain')
    expect(registry.cancel(handle.id)).toBe(true)
    expect(handle.signal.aborted, 'cancel aborts the work').toBe(true)
    expect(registry.find(handle.id)).toMatchObject({ state: 'cancelled', failure: 'cancelled by operator' })
    // The run owner unwinds AFTER the cancel and reports the failure it saw: the
    // terminal state must not flip (the operator already read "cancelled").
    await registry.settle(handle.id, { state: 'failed', failure: 'This operation was aborted' })
    expect(registry.find(handle.id)?.state).toBe('cancelled')
    expect(registry.cancel(handle.id), 'a settled run is not cancellable').toBe(false)
  })

  it('cancelAll stops every run THIS process owns and reports how many', async () => {
    const dir = await home()
    const registry = newRunRegistry({ io: nodeEvolutionIo(), home: dir })
    await registry.load()
    const first = await registry.begin('maintain')
    const second = await registry.begin('maintain')
    expect(registry.cancelAll()).toBe(2)
    expect([first.signal.aborted, second.signal.aborted]).toEqual([true, true])
    expect(registry.runs().every(record => record.state === 'cancelled')).toBe(true)
    expect(registry.cancelAll()).toBe(0)
  })

  it('refuses to cancel a run it does not own (no fabricated terminal state for a foreign run)', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: RUNS_SCHEMA_VERSION,
      runs: [{ id: 'foreign', kind: 'maintain', state: 'running', startedAt: 1 }],
    }), 'utf8')
    const registry = newRunRegistry({ io, home: dir })
    await registry.load()
    // load() already converged it: a previous process life cannot be running.
    expect(registry.find('foreign')?.state).toBe('failed')
    // And an id this process never began is not cancellable, whatever it says.
    expect(registry.cancel('foreign')).toBe(false)
    expect(registry.cancelAll()).toBe(0)
  })

  it('load() converges a running record from a previous process life into failed(orphan) — read time, no timer', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: RUNS_SCHEMA_VERSION,
      runs: [{ id: 'run-orphan', kind: 'maintain', state: 'running', startedAt: 1 }],
    }), 'utf8')
    const registry = newRunRegistry({ io, home: dir })
    const loaded = await registry.load()
    expect(loaded.ok).toBe(true)
    expect(loaded.note).toContain('failed(orphan)')
    expect(registry.find('run-orphan')).toMatchObject({ state: 'failed' })
    expect(registry.find('run-orphan')?.failure).toContain('orphan')
    // The convergence is durable: the next process reads a terminal record, not a
    // stale "running" one.
    const persisted = JSON.parse(await readFile(runsFile(dir), 'utf8')) as { runs: Array<{ state: string }> }
    expect(persisted.runs[0].state).toBe('failed')
  })

  it('an unreadable or unparsable index answers UNKNOWN instead of an empty history', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    await writeFile(runsFile(dir), 'not json', 'utf8')
    const broken = newRunRegistry({ io, home: dir })
    expect(await broken.load()).toMatchObject({ ok: false })
    const throwing = newRunRegistry({
      io: { ...io, readText: async () => { throw new Error('EACCES') } },
      home: dir,
    })
    const failed = await throwing.load()
    expect(failed.ok).toBe(false)
    expect(failed.note).toContain('EACCES')
    // A missing index is a clean first run, not a failure.
    expect(await newRunRegistry({ io, home: await home() }).load()).toEqual({ ok: true })
  })

  it('caps retained history at maxRecords while never dropping a running record', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    const registry = newRunRegistry({ io, home: dir, maxRecords: 2 })
    await registry.load()
    const live = await registry.begin('maintain')
    for (let i = 0; i < 4; i++) {
      const handle = await registry.begin('maintain')
      await registry.settle(handle.id, { state: 'succeeded' })
    }
    expect(registry.runs().length).toBe(3)
    expect(registry.find(live.id)?.state).toBe('running')
    const persisted = JSON.parse(await readFile(runsFile(dir), 'utf8')) as { runs: Array<{ state: string }> }
    expect(persisted.runs.length).toBe(3)
    expect(persisted.runs.some(record => record.state === 'running'), 'the live run stays in the index').toBe(true)
    expect(DEFAULT_RUN_RECORDS).toBe(50)
  })

  it('merges the index across hosts instead of overwriting it (the planes share one home)', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    const first = newRunRegistry({ io, home: dir })
    await first.load()
    const mine = await first.begin('maintain')
    await first.settle(mine.id, { state: 'succeeded' })
    // A second host over the SAME home has its own record; its write must keep mine.
    const second = newRunRegistry({ io, home: dir })
    await second.load()
    const theirs = await second.begin('maintain')
    await second.settle(theirs.id, { state: 'failed', failure: 'elsewhere' })
    const persisted = JSON.parse(await readFile(runsFile(dir), 'utf8')) as { runs: Array<{ id: string }> }
    const ids = persisted.runs.map(record => record.id)
    expect(ids).toContain(mine.id)
    expect(ids).toContain(theirs.id)
  })

  it('keeps a run another process is still running, and converges only a dead owner (review P1-1)', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    // A live owner (this very process stands in for the other plane): the run is
    // genuinely in flight, so it must NOT be rewritten as failed(orphan) — and it is
    // the ONE in-flight scan of this home, which is what makes the guard cross-plane.
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: RUNS_SCHEMA_VERSION,
      runs: [{ id: 'live-elsewhere', kind: 'maintain', state: 'running', startedAt: 5, pid: process.pid }],
    }), 'utf8')
    const registry = newRunRegistry({ io, home: dir })
    const loaded = await registry.load()
    expect(loaded.ok).toBe(true)
    expect(loaded.note, 'the other plane in flight is reported').toContain('in flight in another process')
    expect(registry.find('live-elsewhere')?.state).toBe('running')
    expect(registry.inFlight()?.id).toBe('live-elsewhere')
    expect(registry.cancel('live-elsewhere'), 'this process does not own it').toBe(false)
    // A second load is idempotent — the merge must not duplicate records.
    await registry.load()
    expect(registry.runs().filter(record => record.id === 'live-elsewhere')).toHaveLength(1)
    // A dead owner is an orphan: converged, with the reason spelled out.
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: RUNS_SCHEMA_VERSION,
      runs: [{ id: 'dead-elsewhere', kind: 'maintain', state: 'running', startedAt: 6, pid: 999_999 }],
    }), 'utf8')
    const other = newRunRegistry({ io, home: dir })
    const second = await other.load()
    expect(second.note).toContain('failed(orphan)')
    expect(other.find('dead-elsewhere')?.state).toBe('failed')
    expect(other.find('dead-elsewhere')?.failure).toContain('no live owner')
  })

  it('preserves records this build does not understand instead of erasing them (review P2-5)', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: 99,
      runs: [
        { id: 'from-the-future', kind: 'maintain', state: 'quantum', startedAt: 7, extra: 'keep me' },
        { id: 'normal', kind: 'maintain', state: 'succeeded', startedAt: 8, endedAt: 9 },
      ],
    }), 'utf8')
    const registry = newRunRegistry({ io, home: dir })
    const loaded = await registry.load()
    expect(loaded.ok).toBe(true)
    expect(loaded.note, 'a newer index schema is said out loud').toContain('schemaVersion 99')
    // This process's own write must not drop the row it cannot judge.
    const handle = await registry.begin('maintain')
    await registry.settle(handle.id, { state: 'succeeded' })
    const persisted = JSON.parse(await readFile(runsFile(dir), 'utf8')) as { runs: Array<{ id: string }> }
    const ids = persisted.runs.map(record => record.id)
    expect(ids).toContain('from-the-future')
    expect(ids).toContain('normal')
    expect(ids).toContain(handle.id)
  })

  it('re-reads a foreign run whose owner settled it after we adopted it (review P1-2)', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    // The other plane is in flight (its pid is alive — this process stands in for it):
    // adopting the row is what makes the guard and `status` cross-plane.
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: RUNS_SCHEMA_VERSION,
      runs: [{ id: 'other-plane', kind: 'maintain', state: 'running', startedAt: 11, pid: process.pid }],
    }), 'utf8')
    const registry = newRunRegistry({ io, home: dir })
    await registry.load()
    expect(registry.inFlight()?.id).toBe('other-plane')
    // A reader that held the record across the load must see the SAME object heal (the
    // adoption is in place, not a replacement).
    const held = registry.find('other-plane')
    // Its OWNER then settles it in the shared index — a record this process never owned.
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: RUNS_SCHEMA_VERSION,
      runs: [{ id: 'other-plane', kind: 'maintain', state: 'cancelled', startedAt: 11, pid: process.pid, endedAt: 12, failure: 'cancelled by operator' }],
    }), 'utf8')
    const reloaded = await registry.load()
    expect(reloaded.note, 'the adoption is reported, not silent').toContain('settled by their owner')
    expect(registry.find('other-plane')).toMatchObject({ state: 'cancelled', failure: 'cancelled by operator' })
    expect(held, 'the held reference healed with it').toMatchObject({ state: 'cancelled' })
    // The guard and the cooldown read this same in-memory record: a run that already
    // settled must not refuse the next scan here.
    expect(registry.inFlight()).toBeUndefined()
    expect(registry.lastSettledAt()).toBe(12)
    // …and this process's own later write must not resurrect it as running.
    const mine = await registry.begin('maintain')
    await registry.settle(mine.id, { state: 'succeeded' })
    const persisted = JSON.parse(await readFile(runsFile(dir), 'utf8')) as { runs: Array<{ id: string; state: string }> }
    expect(persisted.runs.find(record => record.id === 'other-plane')?.state).toBe('cancelled')
  })

  it('has the row in the shared index before begin() resolves (review P2)', async () => {
    const dir = await home()
    const registry = newRunRegistry({ io: nodeEvolutionIo(), home: dir })
    await registry.load()
    const handle = await registry.begin('maintain')
    // No sleep and no polling: the promise resolving IS the proof that another plane
    // reading this home right now finds the run (this write used to be fire-and-forget).
    const persisted = JSON.parse(await readFile(runsFile(dir), 'utf8')) as { runs: Array<{ id: string; state: string }> }
    expect(persisted.runs.find(record => record.id === handle.id)).toMatchObject({ state: 'running' })
  })

  it('converges a foreign run we adopted once its owner dies (the same read-time rule as for new rows)', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: RUNS_SCHEMA_VERSION,
      runs: [{ id: 'owner-died', kind: 'maintain', state: 'running', startedAt: 13, pid: process.pid }],
    }), 'utf8')
    const registry = newRunRegistry({ io, home: dir })
    await registry.load()
    expect(registry.inFlight()?.id).toBe('owner-died')
    // The owner is gone now and the index still says running: without the same
    // convergence the new-row path uses, this record would hold the guard forever.
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: RUNS_SCHEMA_VERSION,
      runs: [{ id: 'owner-died', kind: 'maintain', state: 'running', startedAt: 13, pid: 999_999 }],
    }), 'utf8')
    const again = await registry.load()
    expect(again.note).toContain('failed(orphan)')
    expect(registry.find('owner-died')?.state).toBe('failed')
    expect(registry.find('owner-died')?.failure).toContain('no live owner')
    expect(registry.inFlight(), 'a dead owner cannot hold the guard').toBeUndefined()
  })

  it('never writes a foreign run back to running over the terminal row its owner wrote (review H1)', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: RUNS_SCHEMA_VERSION,
      runs: [{ id: 'foreign-h1', kind: 'maintain', state: 'running', startedAt: 21, pid: process.pid }],
    }), 'utf8')
    const registry = newRunRegistry({ io, home: dir })
    await registry.load()
    expect(registry.inFlight()?.id).toBe('foreign-h1')
    // Its owner settles it, and THEN this process writes for its own reasons without a
    // read in between (begin()/settle() do not load): the settled row must survive.
    await writeFile(runsFile(dir), JSON.stringify({
      schemaVersion: RUNS_SCHEMA_VERSION,
      runs: [{ id: 'foreign-h1', kind: 'maintain', state: 'succeeded', startedAt: 21, pid: process.pid, endedAt: 22, resultRef: join(dir, 'reports', 'maintain-foreign-h1.json') }],
    }), 'utf8')
    const mine = await registry.begin('maintain')
    await registry.settle(mine.id, { state: 'succeeded' })
    const persisted = JSON.parse(await readFile(runsFile(dir), 'utf8')) as { runs: Array<{ id: string; state: string; resultRef?: string }> }
    const row = persisted.runs.find(record => record.id === 'foreign-h1')
    expect(row, 'the foreign row is still in the index').toBeDefined()
    expect(row?.state, 'a settled foreign run is not resurrected as running').toBe('succeeded')
    expect(row?.resultRef).toBe(join(dir, 'reports', 'maintain-foreign-h1.json'))
  })
})
