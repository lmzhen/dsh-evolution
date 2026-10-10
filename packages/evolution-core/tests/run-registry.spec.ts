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
    const handle = registry.begin('maintain')
    expect(handle.kind).toBe('maintain')
    expect(handle.signal.aborted).toBe(false)
    expect(registry.inFlight('maintain')?.id).toBe(handle.id)
    expect(registry.lastSettledAt('maintain')).toBeUndefined()
    await registry.settle(handle.id, { state: 'succeeded', resultRef: join(dir, 'reports', 'maintain-x.json') })
    expect(registry.inFlight('maintain')).toBeUndefined()
    expect(registry.find(handle.id)).toMatchObject({ state: 'succeeded', resultRef: join(dir, 'reports', 'maintain-x.json') })
    expect(typeof registry.lastSettledAt('maintain')).toBe('number')
  })

  it('one terminal state: a settle after a cancel cannot flip the answer the operator read', async () => {
    const dir = await home()
    const registry = newRunRegistry({ io: nodeEvolutionIo(), home: dir })
    await registry.load()
    const handle = registry.begin('maintain')
    expect(registry.cancel(handle.id)).toBe(true)
    expect(handle.signal.aborted, 'cancel aborts the work').toBe(true)
    expect(registry.find(handle.id)).toMatchObject({ state: 'cancelled', failure: 'cancelled by operator' })
    // The run owner unwinds AFTER the cancel and reports the failure it saw: the
    // terminal state must not flip (the operator already read "cancelled").
    await registry.settle(handle.id, { state: 'failed', failure: 'This operation was aborted' })
    expect(registry.find(handle.id)?.state).toBe('cancelled')
    expect(registry.cancel(handle.id), 'a settled run is not cancellable').toBe(false)
  })

  it('cancelAll stops every running run and reports how many there were', async () => {
    const dir = await home()
    const registry = newRunRegistry({ io: nodeEvolutionIo(), home: dir })
    await registry.load()
    const first = registry.begin('maintain')
    const second = registry.begin('maintain')
    expect(registry.cancelAll()).toBe(2)
    expect([first.signal.aborted, second.signal.aborted]).toEqual([true, true])
    expect(registry.runs().every(record => record.state === 'cancelled')).toBe(true)
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
    const live = registry.begin('maintain')
    for (let i = 0; i < 4; i++) {
      const handle = registry.begin('maintain')
      await registry.settle(handle.id, { state: 'succeeded' })
    }
    expect(registry.runs().length).toBe(3)
    expect(registry.find(live.id)?.state).toBe('running')
    const persisted = JSON.parse(await readFile(runsFile(dir), 'utf8')) as { runs: Array<{ state: string }> }
    expect(persisted.runs.length).toBe(3)
    expect(persisted.runs.some(record => record.state === 'running'), 'the live run stays in the index').toBe(true)
    expect(DEFAULT_RUN_RECORDS).toBe(50)
  })
})
